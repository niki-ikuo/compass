import { createRequire } from 'module'
import { dirname, join } from 'path'
import { existsSync, readFileSync } from 'fs'
import { readFile, stat } from 'fs/promises'
import initSqlJs, { type Database, type SqlJsStatic } from 'sql.js'
import { assertSelectOnlySql } from '../../src/utils/data-sql-guard'
import {
  parseDataTableRows,
  tableNameFromPath,
  type DataCell,
  type DataTableRows
} from '../../src/utils/data-rows'
import { buildDataProfile, formatDataProfile } from '../../src/utils/data-profile'
import { normalizeAgentRelativePath } from './agent-paths'
import { resolveInsideWorkspace } from './filesystem'

const require = createRequire(__filename)

const MAX_IMPORT_BYTES = 8 * 1024 * 1024
const MAX_QUERY_ROWS = 200
const MAX_RESULT_CHARS = 24_000
const WASM_FILE = 'sql-wasm.wasm'

let sqlJsPromise: Promise<SqlJsStatic> | null = null

/**
 * Resolve sql-wasm.wasm for both dev (node_modules) and packaged Electron
 * (app.asar and app.asar.unpacked). Prefer reading bytes via wasmBinary so
 * locateFile path quirks inside asar do not break init.
 */
export function resolveSqlJsWasmPath(): string {
  const distDir = dirname(require.resolve('sql.js'))
  const primary = join(distDir, WASM_FILE)
  const candidates: string[] = []

  // Packaged builds: prefer asarUnpack copy when electron-builder extracted it
  if (primary.includes(`${'app.asar'}`) && !primary.includes('app.asar.unpacked')) {
    candidates.push(primary.replace('app.asar', 'app.asar.unpacked'))
  }
  candidates.push(primary)

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate
  }
  return primary
}

function loadSqlJs(): Promise<SqlJsStatic> {
  if (!sqlJsPromise) {
    sqlJsPromise = (async () => {
      const wasmPath = resolveSqlJsWasmPath()
      let wasmBinary: ArrayBuffer
      try {
        const buf = readFileSync(wasmPath)
        wasmBinary = buf.buffer.slice(
          buf.byteOffset,
          buf.byteOffset + buf.byteLength
        ) as ArrayBuffer
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        throw new Error(`Failed to load sql.js WASM at ${wasmPath}: ${message}`)
      }
      return initSqlJs({
        wasmBinary,
        // Fallback if a future sql.js build ignores wasmBinary
        locateFile: (file) => join(dirname(wasmPath), file)
      })
    })()
  }
  return sqlJsPromise
}

function sqlTypeAffinity(values: DataCell[]): 'INTEGER' | 'REAL' | 'TEXT' {
  let sawInt = false
  let sawReal = false
  let sawText = false
  for (const value of values.slice(0, 40)) {
    if (value === null) continue
    if (typeof value === 'boolean') {
      sawInt = true
      continue
    }
    if (typeof value === 'number') {
      if (Number.isInteger(value)) sawInt = true
      else sawReal = true
      continue
    }
    sawText = true
  }
  if (sawText) return 'TEXT'
  if (sawReal) return 'REAL'
  if (sawInt) return 'INTEGER'
  return 'TEXT'
}

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`
}

type CachedTable = {
  relativePath: string
  tableName: string
  mtimeMs: number
  size: number
}

export type AgentDataSandbox = {
  db: Database
  tables: Map<string, CachedTable>
}

export async function createAgentDataSandbox(): Promise<AgentDataSandbox> {
  const SQL = await loadSqlJs()
  return {
    db: new SQL.Database(),
    tables: new Map()
  }
}

export function disposeAgentDataSandbox(sandbox: AgentDataSandbox | null | undefined): void {
  if (!sandbox) return
  try {
    sandbox.db.close()
  } catch {
    // ignore
  }
  sandbox.tables.clear()
}

async function readWorkspaceDataFile(
  workspaceRoot: string,
  relativePath: string
): Promise<{ content: string; mtimeMs: number; size: number } | { error: string }> {
  let absolutePath: string
  try {
    absolutePath = resolveInsideWorkspace(workspaceRoot, relativePath)
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) }
  }

  try {
    const info = await stat(absolutePath)
    if (!info.isFile()) return { error: 'Not a file' }
    if (info.size > MAX_IMPORT_BYTES) {
      return {
        error: `File too large for data sandbox (${info.size} bytes; max ${MAX_IMPORT_BYTES})`
      }
    }
    const content = await readFile(absolutePath, 'utf-8')
    return { content, mtimeMs: info.mtimeMs, size: info.size }
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) }
  }
}

function dropTableIfExists(db: Database, tableName: string): void {
  db.run(`DROP TABLE IF EXISTS ${quoteIdent(tableName)}`)
}

function toSqlValue(cell: DataCell): string | number | null | Uint8Array {
  if (cell === null) return null
  if (typeof cell === 'boolean') return cell ? 1 : 0
  return cell
}

function importTable(db: Database, table: DataTableRows): void {
  dropTableIfExists(db, table.tableName)
  const colDefs = table.columns
    .map((col, i) => {
      const affinity = sqlTypeAffinity(table.rows.map((row) => row[i] ?? null))
      return `${quoteIdent(col)} ${affinity}`
    })
    .join(', ')
  db.run(`CREATE TABLE ${quoteIdent(table.tableName)} (${colDefs})`)

  if (table.rows.length === 0) return

  const placeholders = table.columns.map(() => '?').join(', ')
  const insert = db.prepare(
    `INSERT INTO ${quoteIdent(table.tableName)} VALUES (${placeholders})`
  )
  try {
    for (const row of table.rows) {
      insert.run(row.map(toSqlValue))
    }
  } finally {
    insert.free()
  }
}

function ensureAliasT(db: Database, primaryTable: string): void {
  try {
    db.run(`DROP VIEW IF EXISTS ${quoteIdent('t')}`)
  } catch {
    // ignore
  }
  if (primaryTable === 't') return
  db.run(`CREATE TEMP VIEW ${quoteIdent('t')} AS SELECT * FROM ${quoteIdent(primaryTable)}`)
}

async function ensureImported(
  sandbox: AgentDataSandbox,
  workspaceRoot: string,
  relativePath: string
): Promise<{ tableName: string } | { error: string }> {
  const normalized = relativePath.replace(/\\/g, '/')
  const existing = sandbox.tables.get(normalized)
  const file = await readWorkspaceDataFile(workspaceRoot, normalized)
  if ('error' in file) return file

  if (
    existing &&
    existing.mtimeMs === file.mtimeMs &&
    existing.size === file.size
  ) {
    return { tableName: existing.tableName }
  }

  const parsed = parseDataTableRows(normalized, file.content)
  if ('error' in parsed) return parsed

  // Avoid colliding with another path that mapped to the same basename
  let tableName = parsed.tableName
  for (const cached of sandbox.tables.values()) {
    if (cached.relativePath !== normalized && cached.tableName === tableName) {
      tableName = `${tableName}_${sandbox.tables.size + 1}`
      break
    }
  }
  const table = { ...parsed, tableName }
  importTable(sandbox.db, table)
  sandbox.tables.set(normalized, {
    relativePath: normalized,
    tableName,
    mtimeMs: file.mtimeMs,
    size: file.size
  })
  return { tableName }
}

function formatQueryResult(
  columns: string[],
  values: unknown[][],
  truncated: boolean
): string {
  const lines: string[] = [`columns: ${columns.join(', ')}`, `rows: ${values.length}${truncated ? '+' : ''}`, '---']
  for (const row of values) {
    const cells = row.map((cell) => {
      if (cell === null || cell === undefined) return 'null'
      if (typeof cell === 'string') return JSON.stringify(cell)
      return String(cell)
    })
    lines.push(cells.join('\t'))
  }
  if (truncated) lines.push('...(additional rows omitted)')
  let text = lines.join('\n')
  if (text.length > MAX_RESULT_CHARS) {
    text = `${text.slice(0, MAX_RESULT_CHARS)}\n...(truncated)`
  }
  return text
}

export async function profileDataFile(
  sandbox: AgentDataSandbox,
  workspaceRoot: string,
  pathArg: string
): Promise<{ ok: boolean; summary: string; content: string }> {
  const relativePath = normalizeAgentRelativePath(workspaceRoot, pathArg, {
    defaultToRoot: false
  })
  if (!relativePath || relativePath === '.') {
    return { ok: false, summary: 'path required', content: 'Error: profileData requires a file path' }
  }

  const file = await readWorkspaceDataFile(workspaceRoot, relativePath)
  if ('error' in file) {
    return { ok: false, summary: 'read failed', content: `Error: ${file.error}` }
  }

  const parsed = parseDataTableRows(relativePath, file.content)
  if ('error' in parsed) {
    return { ok: false, summary: 'parse failed', content: `Error: ${parsed.error}` }
  }

  // Keep sandbox in sync so follow-up queryData hits cache
  const ensured = await ensureImported(sandbox, workspaceRoot, relativePath)
  if ('error' in ensured) {
    return { ok: false, summary: 'import failed', content: `Error: ${ensured.error}` }
  }
  ensureAliasT(sandbox.db, ensured.tableName)

  const profile = buildDataProfile({ ...parsed, tableName: ensured.tableName })
  const content = formatDataProfile(profile)
  return {
    ok: true,
    summary: `${profile.tableName}: ${profile.rowCount} rows × ${profile.columnCount} cols`,
    content
  }
}

export async function queryDataFiles(
  sandbox: AgentDataSandbox,
  workspaceRoot: string,
  args: { path?: unknown; paths?: unknown; sql?: unknown }
): Promise<{ ok: boolean; summary: string; content: string }> {
  const guarded = assertSelectOnlySql(typeof args.sql === 'string' ? args.sql : '')
  if (!guarded.ok) {
    return { ok: false, summary: 'invalid sql', content: `Error: ${guarded.error}` }
  }

  const pathList: string[] = []
  if (typeof args.path === 'string' && args.path.trim()) {
    pathList.push(args.path.trim())
  }
  if (Array.isArray(args.paths)) {
    for (const item of args.paths) {
      if (typeof item === 'string' && item.trim()) pathList.push(item.trim())
    }
  }

  if (pathList.length === 0) {
    return {
      ok: false,
      summary: 'path required',
      content: 'Error: queryData requires path or paths to import before SELECT'
    }
  }

  const tableNames: string[] = []
  for (const raw of pathList) {
    const relativePath = normalizeAgentRelativePath(workspaceRoot, raw, {
      defaultToRoot: false
    })
    if (!relativePath || relativePath === '.') {
      return { ok: false, summary: 'bad path', content: `Error: invalid path "${raw}"` }
    }
    const ensured = await ensureImported(sandbox, workspaceRoot, relativePath)
    if ('error' in ensured) {
      return { ok: false, summary: 'import failed', content: `Error: ${relativePath}: ${ensured.error}` }
    }
    tableNames.push(ensured.tableName)
  }

  ensureAliasT(sandbox.db, tableNames[0])

  // Also expose basename aliases already stored; document available tables
  const available = [...sandbox.tables.values()]
    .map((t) => `${t.tableName} ← ${t.relativePath}`)
    .join(', ')

  let result: { columns: string[]; values: unknown[][] }
  try {
    const raw = sandbox.db.exec(guarded.sql)
    if (raw.length === 0) {
      return {
        ok: true,
        summary: '0 rows',
        content: `tables: ${available}\nalias t → ${tableNames[0]}\ncolumns: (none)\nrows: 0`
      }
    }
    result = { columns: raw[0].columns, values: raw[0].values }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return {
      ok: false,
      summary: 'query failed',
      content: `Error: ${message}\nAvailable tables: ${available}\nAlias: t → ${tableNames[0]}`
    }
  }

  const truncated = result.values.length > MAX_QUERY_ROWS
  const values = result.values.slice(0, MAX_QUERY_ROWS)
  const body = formatQueryResult(result.columns, values, truncated)
  return {
    ok: true,
    summary: `${values.length}${truncated ? '+' : ''} row(s)`,
    content: `tables: ${available}\nalias t → ${tableNames[0]}\n${body}`
  }
}

/** Invalidate sandbox rows for paths that changed on disk (after apply). */
export function invalidateDataSandboxPaths(
  sandbox: AgentDataSandbox | null | undefined,
  paths: string[]
): void {
  if (!sandbox || paths.length === 0) return
  for (const raw of paths) {
    const normalized = raw.replace(/\\/g, '/')
    const cached = sandbox.tables.get(normalized)
    if (!cached) {
      // Also try basename table matches
      const want = tableNameFromPath(normalized)
      for (const [key, value] of sandbox.tables) {
        if (value.tableName === want) {
          dropTableIfExists(sandbox.db, value.tableName)
          sandbox.tables.delete(key)
        }
      }
      continue
    }
    dropTableIfExists(sandbox.db, cached.tableName)
    sandbox.tables.delete(normalized)
  }
  try {
    sandbox.db.run(`DROP VIEW IF EXISTS ${quoteIdent('t')}`)
  } catch {
    // ignore
  }
}
