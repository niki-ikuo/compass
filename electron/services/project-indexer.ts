import { mkdir, readdir, readFile, stat, writeFile } from 'fs/promises'
import { dirname, extname, join, relative } from 'path'
import { t } from '../../src/i18n/runtime'
import type { IndexBuildResult, ProjectIndexContext, UseCasePreset } from '../../src/types'
import {
  extractDataSchema,
  formatDataSchemaBrief,
  isDataIndexPath,
  type DataSchema
} from '../../src/utils/data-outline'
import {
  extractMarkdownSummary,
  parseMarkdownHeadings,
  type MarkdownHeading
} from '../../src/utils/markdown-outline'

const INDEX_VERSION = 4
const COMPASS_DIR = '.compass'
const IGNORED_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'out',
  'release',
  '.next',
  '.compass'
])

const SOURCE_EXTENSIONS = new Set([
  'ts',
  'tsx',
  'js',
  'jsx',
  'py',
  'go',
  'rs',
  'java',
  'cs',
  'cpp',
  'c',
  'h',
  'json',
  'md',
  'markdown',
  'css',
  'scss',
  'html',
  'yaml',
  'yml',
  'csv',
  'tsv'
])

interface IndexedSymbol {
  name: string
  kind: string
  line: number
}

interface IndexedFile {
  path: string
  language: string
  lines: number
  imports: string[]
  exports: string[]
  symbols: IndexedSymbol[]
  /** Markdown のみ */
  headings?: MarkdownHeading[]
  /** Markdown のみ — 先頭段落の短い要約 */
  summary?: string
  /** CSV / JSON / YAML のデータスキーマ要約 */
  dataSchema?: DataSchema
}

interface GraphEdge {
  from: string
  to: string
  type: 'import'
}

function getLanguage(ext: string): string {
  const map: Record<string, string> = {
    ts: 'typescript',
    tsx: 'typescript',
    js: 'javascript',
    jsx: 'javascript',
    py: 'python',
    md: 'markdown',
    markdown: 'markdown',
    json: 'json',
    css: 'css',
    html: 'html',
    yaml: 'yaml',
    yml: 'yaml',
    csv: 'csv',
    tsv: 'tsv'
  }
  return map[ext] ?? (ext || 'text')
}

function extractImports(content: string, language: string): string[] {
  const imports = new Set<string>()

  if (language === 'typescript' || language === 'javascript') {
    const patterns = [
      /import\s+(?:type\s+)?(?:[\w*{}\s,]+)\s+from\s+['"]([^'"]+)['"]/g,
      /import\s+['"]([^'"]+)['"]/g,
      /require\(\s*['"]([^'"]+)['"]\s*\)/g,
      /export\s+(?:\*|{[^}]*})\s+from\s+['"]([^'"]+)['"]/g
    ]
    for (const pattern of patterns) {
      let match: RegExpExecArray | null
      while ((match = pattern.exec(content)) !== null) {
        imports.add(match[1])
      }
    }
  }

  if (language === 'python') {
    const patterns = [
      /^import\s+([\w.]+)/gm,
      /^from\s+([\w.]+)\s+import/gm
    ]
    for (const pattern of patterns) {
      let match: RegExpExecArray | null
      while ((match = pattern.exec(content)) !== null) {
        imports.add(match[1])
      }
    }
  }

  return [...imports]
}

function extractExports(content: string, language: string): string[] {
  const exports = new Set<string>()

  if (language === 'typescript' || language === 'javascript') {
    const patterns = [
      /export\s+(?:default\s+)?(?:async\s+)?function\s+(\w+)/g,
      /export\s+(?:default\s+)?class\s+(\w+)/g,
      /export\s+(?:type|interface)\s+(\w+)/g,
      /export\s+const\s+(\w+)/g,
      /export\s+{\s*([^}]+)\s*}/g
    ]
    for (const pattern of patterns) {
      let match: RegExpExecArray | null
      while ((match = pattern.exec(content)) !== null) {
        if (match[1].includes(',')) {
          match[1].split(',').forEach((name) => {
            const cleaned = name.trim().split(/\s+as\s+/)[0].trim()
            if (cleaned) exports.add(cleaned)
          })
        } else {
          exports.add(match[1])
        }
      }
    }
  }

  if (language === 'python') {
    const patterns = [/^def\s+(\w+)/gm, /^class\s+(\w+)/gm]
    for (const pattern of patterns) {
      let match: RegExpExecArray | null
      while ((match = pattern.exec(content)) !== null) {
        exports.add(match[1])
      }
    }
  }

  return [...exports].slice(0, 30)
}

function extractSymbols(content: string, language: string): IndexedSymbol[] {
  const symbols: IndexedSymbol[] = []
  const lines = content.split('\n')

  lines.forEach((line, index) => {
    const lineNo = index + 1
    let match: RegExpMatchArray | null

    if (language === 'typescript' || language === 'javascript') {
      if ((match = line.match(/(?:export\s+)?(?:async\s+)?function\s+(\w+)/))) {
        symbols.push({ name: match[1], kind: 'function', line: lineNo })
      } else if ((match = line.match(/(?:export\s+)?class\s+(\w+)/))) {
        symbols.push({ name: match[1], kind: 'class', line: lineNo })
      } else if ((match = line.match(/(?:export\s+)?interface\s+(\w+)/))) {
        symbols.push({ name: match[1], kind: 'interface', line: lineNo })
      } else if ((match = line.match(/(?:export\s+)?type\s+(\w+)/))) {
        symbols.push({ name: match[1], kind: 'type', line: lineNo })
      } else if ((match = line.match(/(?:export\s+)?const\s+(\w+)/))) {
        symbols.push({ name: match[1], kind: 'const', line: lineNo })
      }
    }

    if (language === 'python') {
      if ((match = line.match(/^def\s+(\w+)/))) {
        symbols.push({ name: match[1], kind: 'function', line: lineNo })
      } else if ((match = line.match(/^class\s+(\w+)/))) {
        symbols.push({ name: match[1], kind: 'class', line: lineNo })
      }
    }
  })

  return symbols.slice(0, 40)
}

async function listSourceFiles(dirPath: string): Promise<string[]> {
  const result: string[] = []
  const entries = await readdir(dirPath, { withFileTypes: true })

  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name)) continue
      const sub = await listSourceFiles(join(dirPath, entry.name))
      result.push(...sub)
    } else {
      const ext = extname(entry.name).slice(1).toLowerCase()
      if (SOURCE_EXTENSIONS.has(ext)) {
        result.push(join(dirPath, entry.name))
      }
    }
  }

  return result
}

function resolveImportPath(fromFile: string, importPath: string, allFiles: Set<string>): string | null {
  if (importPath.startsWith('.')) {
    const fromDir = dirname(fromFile)
    const candidates = [
      join(fromDir, importPath),
      join(fromDir, importPath + '.ts'),
      join(fromDir, importPath + '.tsx'),
      join(fromDir, importPath + '.js'),
      join(fromDir, importPath + '.jsx'),
      join(fromDir, importPath, 'index.ts'),
      join(fromDir, importPath, 'index.tsx')
    ]
    for (const candidate of candidates) {
      const normalized = candidate.replace(/\\/g, '/')
      if (allFiles.has(normalized)) return normalized
    }
  }
  return null
}

/** Score path names that usually mark app / package entry points. */
function entryPointScore(path: string): number {
  const lower = path.toLowerCase()
  const base = lower.split('/').pop() ?? lower
  let score = 0

  if (
    /^(main|index|app|server|cli|electron)\.(tsx?|jsx?|mjs|cjs)$/.test(base)
  ) {
    score += 40
  }
  if (/(^|\/)(src|electron|app|apps?|packages\/[^/]+)\/(main|index|app)\./.test(lower)) {
    score += 25
  }
  if (/(^|\/)(main|preload)\.(tsx?|jsx?)$/.test(lower)) score += 20
  if (base === 'package.json' || base === 'pyproject.toml' || base === 'cargo.toml') {
    score += 50
  }
  if (base === 'readme.md') score += 15
  if (/\/routes?\//.test(lower) || /\/pages?\//.test(lower)) score += 8
  return score
}

function inboundImportCounts(edges: GraphEdge[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const edge of edges) {
    counts.set(edge.to, (counts.get(edge.to) ?? 0) + 1)
  }
  return counts
}

function formatSymbolBrief(file: IndexedFile, max = 8): string {
  const parts: string[] = []
  // Prefer exports when present — they are the public surface.
  if (file.exports.length > 0) {
    parts.push(`exports: ${file.exports.slice(0, max).join(', ')}`)
  }
  const exportSet = new Set(file.exports)
  const extras = file.symbols
    .filter((s) => !exportSet.has(s.name))
    .slice(0, Math.max(0, max - Math.min(file.exports.length, max)))
    .map((s) => `${s.name}(${s.kind}@L${s.line})`)
  if (extras.length > 0) {
    parts.push(`symbols: ${extras.join(', ')}`)
  } else if (file.exports.length === 0 && file.symbols.length > 0) {
    parts.push(
      `symbols: ${file.symbols
        .slice(0, max)
        .map((s) => `${s.name}(${s.kind}@L${s.line})`)
        .join(', ')}`
    )
  }
  return parts.join(' | ')
}

function formatDocumentBrief(file: IndexedFile, maxHeadings = 8): string {
  const parts: string[] = []
  if (file.headings && file.headings.length > 0) {
    const outline = file.headings
      .slice(0, maxHeadings)
      .map((h) => `${'#'.repeat(h.level)} ${h.text}`)
      .join(' > ')
    parts.push(`headings: ${outline}`)
  }
  if (file.summary) {
    parts.push(`summary: ${file.summary}`)
  }
  return parts.join(' | ')
}

function formatDataBrief(file: IndexedFile, maxFields = 12): string {
  if (!file.dataSchema) return ''
  return formatDataSchemaBrief(file.dataSchema, maxFields)
}

function formatFileBrief(file: IndexedFile, max = 8): string {
  if (file.language === 'markdown') return formatDocumentBrief(file, max)
  if (file.dataSchema) return formatDataBrief(file, max)
  return formatSymbolBrief(file, max)
}

function documentScore(file: IndexedFile): number {
  if (file.language !== 'markdown') return 0
  return (file.headings?.length ?? 0) * 2 + (file.summary ? 5 : 0) + entryPointScore(file.path)
}

function dataScore(file: IndexedFile): number {
  if (!file.dataSchema || !isDataIndexPath(file.path)) return 0
  const fields = file.dataSchema.fields.length
  const rows = file.dataSchema.rowCount ?? 0
  return fields * 3 + Math.min(rows, 50) + (file.dataSchema.sample ? 2 : 0)
}

function pickEntryPoints(files: IndexedFile[], edges: GraphEdge[]): IndexedFile[] {
  const inbound = inboundImportCounts(edges)
  const ranked = files
    .map((file) => {
      const nameScore = entryPointScore(file.path)
      const fanIn = inbound.get(file.path) ?? 0
      const exportBonus = Math.min(file.exports.length, 10)
      return { file, score: nameScore + fanIn * 3 + exportBonus }
    })
    .filter((row) => row.score >= 15)
    .sort((a, b) => b.score - a.score || a.file.path.localeCompare(b.file.path))

  const picked: IndexedFile[] = []
  const seen = new Set<string>()
  for (const row of ranked) {
    if (seen.has(row.file.path)) continue
    seen.add(row.file.path)
    picked.push(row.file)
    if (picked.length >= 16) break
  }
  return picked
}

/** Exported for unit tests — builds the human/AI-facing summary.txt body. */
export function buildSummary(files: IndexedFile[], edges: GraphEdge[]): string {
  const inbound = inboundImportCounts(edges)
  const lines: string[] = [
    '# Compass Project Index',
    '',
    `Files: ${files.length}`,
    `Relations: ${edges.length}`,
    ''
  ]

  const entryPoints = pickEntryPoints(files, edges)
  if (entryPoints.length > 0) {
    lines.push('## Entry points')
    for (const file of entryPoints) {
      const brief = formatFileBrief(file, 6)
      const fanIn = inbound.get(file.path) ?? 0
      const fanInLabel = fanIn > 0 ? `, importedBy:${fanIn}` : ''
      lines.push(
        `- ${file.path} (${file.language}, ${t('ai.indexLines', { count: file.lines })}${fanInLabel})` +
          (brief ? ` | ${brief}` : '')
      )
    }
    lines.push('')
  }

  const documents = files
    .filter(
      (f) =>
        f.language === 'markdown' &&
        ((f.headings && f.headings.length > 0) || Boolean(f.summary))
    )
    .sort((a, b) => documentScore(b) - documentScore(a) || a.path.localeCompare(b.path))

  if (documents.length > 0) {
    lines.push('## Documents')
    for (const file of documents.slice(0, 40)) {
      const brief = formatDocumentBrief(file, 10)
      lines.push(
        `- ${file.path} (${t('ai.indexLines', { count: file.lines })})` +
          (brief ? ` | ${brief}` : '')
      )
    }
    if (documents.length > 40) {
      lines.push(`- ... and ${documents.length - 40} more documents`)
    }
    lines.push('')
  }

  const dataFiles = files
    .filter((f) => Boolean(f.dataSchema) && isDataIndexPath(f.path))
    .sort((a, b) => dataScore(b) - dataScore(a) || a.path.localeCompare(b.path))

  if (dataFiles.length > 0) {
    lines.push('## Data')
    for (const file of dataFiles.slice(0, 40)) {
      const brief = formatDataBrief(file, 12)
      lines.push(
        `- ${file.path} (${file.language}, ${t('ai.indexLines', { count: file.lines })})` +
          (brief ? ` | ${brief}` : '')
      )
    }
    if (dataFiles.length > 40) {
      lines.push(`- ... and ${dataFiles.length - 40} more data files`)
    }
    lines.push('')
  }

  lines.push('## File Overview')

  // Prefer files with symbols/exports/document/data outline; keep a stable path sort within ties.
  const overview = [...files].sort((a, b) => {
    const sa =
      a.exports.length * 2 +
      a.symbols.length +
      entryPointScore(a.path) +
      documentScore(a) +
      dataScore(a)
    const sb =
      b.exports.length * 2 +
      b.symbols.length +
      entryPointScore(b.path) +
      documentScore(b) +
      dataScore(b)
    if (sb !== sa) return sb - sa
    return a.path.localeCompare(b.path)
  })

  for (const file of overview.slice(0, 80)) {
    const brief = formatFileBrief(file, 6)
    const importTargets = file.imports.filter((i) => i.startsWith('.')).slice(0, 4).join(', ')
    lines.push(
      `- ${file.path} (${file.language}, ${t('ai.indexLines', { count: file.lines })})` +
        (brief ? ` | ${brief}` : '') +
        (importTargets ? ` | imports: ${importTargets}` : '')
    )
  }

  if (files.length > 80) {
    lines.push(`- ... and ${files.length - 80} more files`)
  }

  lines.push('', '## Key Relations')
  // Prefer edges into / out of entry points when available.
  const entrySet = new Set(entryPoints.map((f) => f.path))
  const rankedEdges = [...edges].sort((a, b) => {
    const sa = (entrySet.has(a.from) ? 2 : 0) + (entrySet.has(a.to) ? 2 : 0)
    const sb = (entrySet.has(b.from) ? 2 : 0) + (entrySet.has(b.to) ? 2 : 0)
    return sb - sa
  })
  const relationSample = rankedEdges.slice(0, 60)
  for (const edge of relationSample) {
    lines.push(`- ${edge.from} -> ${edge.to}`)
  }
  if (edges.length > 60) {
    lines.push(`- ... and ${edges.length - 60} more relations`)
  }

  return lines.join('\n')
}

function getCompassDir(workspaceRoot: string): string {
  return join(workspaceRoot, COMPASS_DIR)
}

export function isIgnoredPath(relativePath: string): boolean {
  const parts = relativePath.replace(/\\/g, '/').split('/').filter(Boolean)
  return parts.some((part) => IGNORED_DIRS.has(part))
}

export function isSourcePath(relativePath: string): boolean {
  if (isIgnoredPath(relativePath)) return false
  const ext = extname(relativePath).slice(1).toLowerCase()
  // Directory-level events (no extension) still matter for add/remove.
  if (!ext) return true
  return SOURCE_EXTENSIONS.has(ext)
}

interface IndexMeta {
  version: number
  indexedAt: string
  workspaceRoot: string
  fileCount: number
  relationCount: number
}

async function readIndexMeta(workspaceRoot: string): Promise<IndexMeta | null> {
  try {
    const raw = await readFile(join(getCompassDir(workspaceRoot), 'meta.json'), 'utf-8')
    const meta = JSON.parse(raw) as Partial<IndexMeta>
    if (
      typeof meta.indexedAt !== 'string' ||
      typeof meta.fileCount !== 'number' ||
      typeof meta.relationCount !== 'number'
    ) {
      return null
    }
    return {
      version: typeof meta.version === 'number' ? meta.version : INDEX_VERSION,
      indexedAt: meta.indexedAt,
      workspaceRoot: typeof meta.workspaceRoot === 'string' ? meta.workspaceRoot : workspaceRoot,
      fileCount: meta.fileCount,
      relationCount: meta.relationCount
    }
  } catch {
    return null
  }
}

export async function isProjectIndexStale(workspaceRoot: string): Promise<boolean> {
  const meta = await readIndexMeta(workspaceRoot)
  if (!meta || meta.version !== INDEX_VERSION) return true

  const indexedAtMs = Date.parse(meta.indexedAt)
  if (Number.isNaN(indexedAtMs)) return true

  let filesRaw: string
  try {
    filesRaw = await readFile(join(getCompassDir(workspaceRoot), 'files.json'), 'utf-8')
  } catch {
    return true
  }

  let indexedFiles: IndexedFile[]
  try {
    indexedFiles = JSON.parse(filesRaw) as IndexedFile[]
    if (!Array.isArray(indexedFiles)) return true
  } catch {
    return true
  }

  const absolutePaths = await listSourceFiles(workspaceRoot)
  const currentRelPaths = absolutePaths.map((p) =>
    relative(workspaceRoot, p).replace(/\\/g, '/')
  )
  const currentSet = new Set(currentRelPaths)
  const indexedSet = new Set(indexedFiles.map((f) => f.path))

  if (currentSet.size !== indexedSet.size) return true
  for (const path of currentSet) {
    if (!indexedSet.has(path)) return true
  }

  for (const absPath of absolutePaths) {
    try {
      const info = await stat(absPath)
      if (info.mtimeMs > indexedAtMs) return true
    } catch {
      return true
    }
  }

  return false
}

let activeBuild: { root: string; promise: Promise<IndexBuildResult> } | null = null
let buildEpoch = 0

/** Normalize roots so Windows path casing / separators compare equal. */
export function normalizeWorkspaceRoot(workspaceRoot: string): string {
  return workspaceRoot.replace(/[/\\]+$/, '').replace(/\\/g, '/').toLowerCase()
}

export function sameWorkspaceRoot(a: string, b: string): boolean {
  return normalizeWorkspaceRoot(a) === normalizeWorkspaceRoot(b)
}

export async function ensureCompassDir(workspaceRoot: string): Promise<string> {
  const compassDir = getCompassDir(workspaceRoot)
  await mkdir(compassDir, { recursive: true })
  return compassDir
}

async function runBuildProjectIndex(
  workspaceRoot: string,
  epoch: number
): Promise<IndexBuildResult> {
  // Create .compass immediately so folder switches always leave a visible index dir,
  // even if the file scan takes a long time or is later superseded.
  const compassDir = await ensureCompassDir(workspaceRoot)

  const absolutePaths = await listSourceFiles(workspaceRoot)
  if (epoch !== buildEpoch) {
    return {
      workspaceRoot,
      fileCount: 0,
      relationCount: 0,
      indexedAt: new Date().toISOString()
    }
  }

  const relativePaths = absolutePaths.map((p) => relative(workspaceRoot, p).replace(/\\/g, '/'))
  const fileSet = new Set(relativePaths)
  const files: IndexedFile[] = []

  for (const absPath of absolutePaths) {
    if (epoch !== buildEpoch) {
      return {
        workspaceRoot,
        fileCount: 0,
        relationCount: 0,
        indexedAt: new Date().toISOString()
      }
    }

    const relPath = relative(workspaceRoot, absPath).replace(/\\/g, '/')
    try {
      const info = await stat(absPath)
      if (info.size > 256 * 1024) continue

      const content = await readFile(absPath, 'utf-8')
      if (content.includes('\0')) continue

      const ext = extname(absPath).slice(1).toLowerCase()
      const language = getLanguage(ext)
      const lines = content.split('\n').length

      const entry: IndexedFile = {
        path: relPath,
        language,
        lines,
        imports: extractImports(content, language),
        exports: extractExports(content, language),
        symbols: extractSymbols(content, language)
      }

      if (language === 'markdown') {
        const headings = parseMarkdownHeadings(content).slice(0, 40)
        const summary = extractMarkdownSummary(content, 200)
        if (headings.length > 0) entry.headings = headings
        if (summary) entry.summary = summary
      }

      const dataSchema = extractDataSchema(relPath, content)
      if (dataSchema) entry.dataSchema = dataSchema

      files.push(entry)
    } catch {
      // skip unreadable files
    }
  }

  const edges: GraphEdge[] = []
  for (const file of files) {
    for (const imp of file.imports) {
      const resolved = resolveImportPath(file.path, imp, fileSet)
      if (resolved) {
        edges.push({ from: file.path, to: resolved, type: 'import' })
      }
    }
  }

  if (epoch !== buildEpoch) {
    return {
      workspaceRoot,
      fileCount: files.length,
      relationCount: edges.length,
      indexedAt: new Date().toISOString()
    }
  }

  const indexedAt = new Date().toISOString()

  const meta: IndexMeta = {
    version: INDEX_VERSION,
    indexedAt,
    workspaceRoot,
    fileCount: files.length,
    relationCount: edges.length
  }

  await writeFile(join(compassDir, 'meta.json'), JSON.stringify(meta, null, 2), 'utf-8')
  await writeFile(join(compassDir, 'files.json'), JSON.stringify(files, null, 2), 'utf-8')
  await writeFile(join(compassDir, 'graph.json'), JSON.stringify({ edges }, null, 2), 'utf-8')
  await writeFile(join(compassDir, 'summary.txt'), buildSummary(files, edges), 'utf-8')

  return {
    workspaceRoot,
    fileCount: files.length,
    relationCount: edges.length,
    indexedAt
  }
}

export async function buildProjectIndex(workspaceRoot: string): Promise<IndexBuildResult> {
  if (activeBuild && sameWorkspaceRoot(activeBuild.root, workspaceRoot)) {
    return activeBuild.promise
  }

  const epoch = ++buildEpoch
  const promise = runBuildProjectIndex(workspaceRoot, epoch).finally(() => {
    if (activeBuild?.promise === promise) activeBuild = null
  })
  activeBuild = { root: workspaceRoot, promise }
  return promise
}

export interface EnsureIndexResult extends IndexBuildResult {
  rebuilt: boolean
}

export async function ensureProjectIndex(workspaceRoot: string): Promise<EnsureIndexResult> {
  const stale = await isProjectIndexStale(workspaceRoot)
  if (!stale) {
    const meta = await readIndexMeta(workspaceRoot)
    if (meta) {
      return {
        workspaceRoot,
        fileCount: meta.fileCount,
        relationCount: meta.relationCount,
        indexedAt: meta.indexedAt,
        rebuilt: false
      }
    }
  }

  const result = await buildProjectIndex(workspaceRoot)
  return { ...result, rebuilt: true }
}

/** Pull a `## Heading` section (until the next `## `) out of summary.txt. */
export function extractSummarySection(summary: string, heading: string): string | null {
  const marker = heading.startsWith('## ') ? heading : `## ${heading}`
  const start = summary.indexOf(marker)
  if (start < 0) return null
  const after = summary.slice(start + marker.length)
  const next = after.search(/\n## /)
  const body = (next >= 0 ? after.slice(0, next) : after).replace(/^\n+/, '').trimEnd()
  return `${marker}\n${body}`.trim()
}

/** For the data use-case, put ## Data first and give it a larger share of the budget. */
export function compactSummaryForPreset(
  summary: string,
  preset?: UseCasePreset | null,
  maxChars = 5000
): string {
  if (preset !== 'data') {
    return summary.slice(0, maxChars)
  }

  const dataSection = extractSummarySection(summary, '## Data')
  if (!dataSection) {
    return summary.slice(0, maxChars)
  }

  const dataBudget = Math.min(4500, Math.floor(maxChars * 0.7))
  const restBudget = Math.max(800, maxChars - Math.min(dataSection.length, dataBudget) - 2)
  const trimmedData = dataSection.slice(0, dataBudget)
  const withoutData = summary
    .replace(dataSection, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return `${trimmedData}\n\n${withoutData.slice(0, restBudget)}`.slice(0, maxChars)
}

export async function getProjectIndexContext(
  workspaceRoot: string,
  options: {
    currentFile?: string
    referencePaths?: string[]
    preset?: UseCasePreset | null
  } = {}
): Promise<ProjectIndexContext | null> {
  try {
    const compassDir = getCompassDir(workspaceRoot)
    const [metaRaw, filesRaw, graphRaw, summary] = await Promise.all([
      readFile(join(compassDir, 'meta.json'), 'utf-8'),
      readFile(join(compassDir, 'files.json'), 'utf-8'),
      readFile(join(compassDir, 'graph.json'), 'utf-8'),
      readFile(join(compassDir, 'summary.txt'), 'utf-8')
    ])

    const meta = JSON.parse(metaRaw) as { indexedAt: string; fileCount: number }
    const files = JSON.parse(filesRaw) as IndexedFile[]
    const graph = JSON.parse(graphRaw) as { edges: GraphEdge[] }
    const preset = options.preset ?? null

    const focusPaths = new Set<string>()
    const currentRel = options.currentFile
      ? relative(workspaceRoot, options.currentFile).replace(/\\/g, '/')
      : null

    if (currentRel) focusPaths.add(currentRel)
    for (const ref of options.referencePaths ?? []) {
      focusPaths.add(relative(workspaceRoot, ref).replace(/\\/g, '/'))
    }

    const related = new Set<string>()
    for (const path of focusPaths) {
      related.add(path)
      for (const edge of graph.edges) {
        if (edge.from === path) related.add(edge.to)
        if (edge.to === path) related.add(edge.from)
      }
    }

    // Data use-case: also attach sibling data files in the same folder (no import graph).
    if (preset === 'data') {
      const focusDirs = new Set(
        [...focusPaths].map((path) => {
          const slash = path.lastIndexOf('/')
          return slash >= 0 ? path.slice(0, slash) : ''
        })
      )
      for (const file of files) {
        if (!file.dataSchema || !isDataIndexPath(file.path)) continue
        const slash = file.path.lastIndexOf('/')
        const dir = slash >= 0 ? file.path.slice(0, slash) : ''
        if (focusDirs.has(dir) || focusPaths.has(file.path)) {
          related.add(file.path)
        }
      }
    }

    const relatedFiles = files.filter((f) => related.has(f.path))
    const relatedSection =
      relatedFiles.length > 0
        ? [
            '## Related to current context',
            ...relatedFiles.map((f) => {
              const detail = formatFileBrief(f, 8)
              const imps = f.imports
                .filter((i) => i.startsWith('.'))
                .slice(0, 5)
                .join(', ')
              const withImports = [detail, imps ? `-> ${imps}` : ''].filter(Boolean).join(' | ')
              return `- ${f.path}: ${withImports || 'no symbols'}`
            })
          ].join('\n')
        : ''

    const summaryBudget = preset === 'data' ? 6000 : 5000
    const compactSummary = compactSummaryForPreset(summary, preset, summaryBudget)
    const contextBudget = preset === 'data' ? 10000 : 8000
    const aiContext = [
      t('ai.indexHeader'),
      `indexedAt: ${meta.indexedAt}`,
      `fileCount: ${meta.fileCount}`,
      '',
      compactSummary,
      relatedSection ? `\n${relatedSection}` : ''
    ].join('\n')

    return {
      indexedAt: meta.indexedAt,
      fileCount: meta.fileCount,
      aiContext: aiContext.slice(0, contextBudget)
    }
  } catch {
    return null
  }
}
