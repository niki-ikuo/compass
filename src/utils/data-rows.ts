import { isDataIndexPath } from './data-outline'

export type DataCell = string | number | boolean | null

export interface DataTableRows {
  kind: 'csv' | 'json' | 'yaml'
  /** SQL-safe identifier derived from the file basename */
  tableName: string
  columns: string[]
  rows: DataCell[][]
  sourcePath: string
}

function splitCsvLine(line: string, delimiter: string): string[] {
  const cols: string[] = []
  let current = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      inQuotes = !inQuotes
      current += ch
      continue
    }
    if (ch === delimiter && !inQuotes) {
      cols.push(current)
      current = ''
      continue
    }
    current += ch
  }
  cols.push(current)
  return cols
}

function stripCsvQuotes(value: string): string {
  const trimmed = value.trim()
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1).replace(/""/g, '"')
  }
  return trimmed
}

function coerceCell(raw: string): DataCell {
  const trimmed = raw.trim()
  if (trimmed === '') return null
  if (/^(true|false)$/i.test(trimmed)) return trimmed.toLowerCase() === 'true'
  if (/^-?\d+$/.test(trimmed)) {
    const n = Number(trimmed)
    if (Number.isSafeInteger(n)) return n
  }
  if (/^-?\d+\.\d+$/.test(trimmed)) {
    const n = Number(trimmed)
    if (Number.isFinite(n)) return n
  }
  return stripCsvQuotes(raw)
}

/** Derive a stable SQL table name from a workspace-relative path. */
export function tableNameFromPath(relativePath: string): string {
  const base = relativePath.replace(/\\/g, '/').split('/').pop() ?? 'data'
  const withoutExt = base.replace(/\.[^.]+$/, '') || 'data'
  let name = withoutExt.replace(/[^A-Za-z0-9_]/g, '_').replace(/^_+/, '')
  if (!name || /^\d/.test(name)) name = `t_${name || 'data'}`
  return name.slice(0, 64)
}

function uniqueColumns(raw: string[]): string[] {
  const seen = new Map<string, number>()
  return raw.map((col, index) => {
    let name = col.trim() || `col_${index + 1}`
    name = name.replace(/[^A-Za-z0-9_]/g, '_')
    if (!name || /^\d/.test(name)) name = `c_${name || index + 1}`
    const count = seen.get(name) ?? 0
    seen.set(name, count + 1)
    return count === 0 ? name : `${name}_${count + 1}`
  })
}

function parseCsvRows(
  content: string,
  sourcePath: string,
  delimiter: string
): DataTableRows | { error: string } {
  const lines = content.split(/\r?\n/).filter((line) => line.trim() !== '')
  if (lines.length === 0) return { error: 'CSV is empty' }

  const header = splitCsvLine(lines[0], delimiter).map(stripCsvQuotes)
  if (header.every((h) => !h.trim())) return { error: 'CSV header has no columns' }

  const columns = uniqueColumns(header)
  const rows: DataCell[][] = []
  for (let i = 1; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i], delimiter).map(coerceCell)
    while (cells.length < columns.length) cells.push(null)
    rows.push(cells.slice(0, columns.length))
  }

  return {
    kind: 'csv',
    tableName: tableNameFromPath(sourcePath),
    columns,
    rows,
    sourcePath
  }
}

function cellFromJson(value: unknown): DataCell {
  if (value === null || value === undefined) return null
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value
  }
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function parseJsonRows(
  content: string,
  sourcePath: string
): DataTableRows | { error: string } {
  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch (err) {
    return { error: `Invalid JSON: ${err instanceof Error ? err.message : String(err)}` }
  }

  if (!Array.isArray(parsed)) {
    return { error: 'JSON must be an array of objects for tabular query/profile' }
  }

  const objects = parsed.filter(
    (item): item is Record<string, unknown> =>
      Boolean(item) && typeof item === 'object' && !Array.isArray(item)
  )
  if (objects.length === 0) {
    return { error: 'JSON array has no object rows' }
  }

  const keyOrder: string[] = []
  const seen = new Set<string>()
  for (const obj of objects) {
    for (const key of Object.keys(obj)) {
      if (!seen.has(key)) {
        seen.add(key)
        keyOrder.push(key)
      }
    }
  }

  const columns = uniqueColumns(keyOrder)
  const rows = objects.map((obj) =>
    keyOrder.map((key) => (key in obj ? cellFromJson(obj[key]) : null))
  )

  return {
    kind: 'json',
    tableName: tableNameFromPath(sourcePath),
    columns,
    rows,
    sourcePath
  }
}

/**
 * Parse a workspace data file into columnar rows.
 * CSV / TSV / object-array JSON only (YAML is profile-only via outline today).
 */
export function parseDataTableRows(
  relativePath: string,
  content: string
): DataTableRows | { error: string } {
  const normalized = relativePath.replace(/\\/g, '/')
  if (!isDataIndexPath(normalized)) {
    return { error: 'Not a supported data file (csv / tsv / data json)' }
  }
  const lower = normalized.toLowerCase()
  if (lower.endsWith('.csv')) return parseCsvRows(content, normalized, ',')
  if (lower.endsWith('.tsv')) return parseCsvRows(content, normalized, '\t')
  if (lower.endsWith('.json')) return parseJsonRows(content, normalized)
  if (lower.endsWith('.yaml') || lower.endsWith('.yml')) {
    return { error: 'YAML tabular query is not supported; use profileData / readFile instead' }
  }
  return { error: 'Unsupported data format' }
}

export function isTabularDataPath(relativePath: string): boolean {
  const lower = relativePath.replace(/\\/g, '/').toLowerCase()
  return (
    lower.endsWith('.csv') ||
    lower.endsWith('.tsv') ||
    (lower.endsWith('.json') && isDataIndexPath(relativePath))
  )
}
