import { mkdir, readdir, readFile, stat, writeFile } from 'fs/promises'
import { dirname, extname, join, relative } from 'path'
import type { IndexBuildResult, ProjectIndexContext } from '../../src/types'

const INDEX_VERSION = 1
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
  'css',
  'scss',
  'html',
  'yaml',
  'yml'
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
    json: 'json',
    css: 'css',
    html: 'html'
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
    let match: RegExpExecArray | null

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

function buildSummary(files: IndexedFile[], edges: GraphEdge[]): string {
  const lines: string[] = [
    '# Compass Project Index',
    '',
    `Files: ${files.length}`,
    `Relations: ${edges.length}`,
    '',
    '## File Overview'
  ]

  for (const file of files.slice(0, 80)) {
    const symbolNames = file.symbols.map((s) => s.name).slice(0, 6).join(', ')
    const importTargets = file.imports.filter((i) => i.startsWith('.')).slice(0, 4).join(', ')
    lines.push(
      `- ${file.path} (${file.language}, ${file.lines}行)` +
        (symbolNames ? ` | symbols: ${symbolNames}` : '') +
        (importTargets ? ` | imports: ${importTargets}` : '')
    )
  }

  if (files.length > 80) {
    lines.push(`- ... and ${files.length - 80} more files`)
  }

  lines.push('', '## Key Relations')
  const relationSample = edges.slice(0, 60)
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

      files.push({
        path: relPath,
        language,
        lines,
        imports: extractImports(content, language),
        exports: extractExports(content, language),
        symbols: extractSymbols(content, language)
      })
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

export async function getProjectIndexContext(
  workspaceRoot: string,
  options: { currentFile?: string; referencePaths?: string[] } = {}
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

    const relatedFiles = files.filter((f) => related.has(f.path))
    const relatedSection =
      relatedFiles.length > 0
        ? [
            '## Related to current context',
            ...relatedFiles.map((f) => {
              const syms = f.symbols
                .map((s) => `${s.name}(${s.kind})`)
                .slice(0, 8)
                .join(', ')
              const imps = f.imports
                .filter((i) => i.startsWith('.'))
                .slice(0, 5)
                .join(', ')
              return `- ${f.path}: ${syms || 'no symbols'}${imps ? ` | -> ${imps}` : ''}`
            })
          ].join('\n')
        : ''

    const compactSummary = summary.slice(0, 5000)
    const aiContext = [
      '[プロジェクト構造インデックス (.compass)]',
      `indexedAt: ${meta.indexedAt}`,
      `fileCount: ${meta.fileCount}`,
      '',
      compactSummary,
      relatedSection ? `\n${relatedSection}` : ''
    ].join('\n')

    return {
      indexedAt: meta.indexedAt,
      fileCount: meta.fileCount,
      aiContext: aiContext.slice(0, 8000)
    }
  } catch {
    return null
  }
}
