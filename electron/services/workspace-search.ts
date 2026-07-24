import { readdir, readFile, stat, writeFile } from 'fs/promises'
import { join, relative, resolve, sep } from 'path'
import { t } from '../../src/i18n/runtime'
import type {
  WorkspaceReplaceOptions,
  WorkspaceReplaceResult,
  WorkspaceSearchMatch,
  WorkspaceSearchOptions,
  WorkspaceSearchResult,
  WorkspaceSearchFileResult
} from '../../src/types'
import { shouldSkipWorkspaceEntry } from './fs-ignore'
import { decodeFileBuffer, encodeContent } from './encoding'

const IGNORED_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'out',
  'release',
  '.next',
  '.compass',
  'build',
  'coverage',
  '.turbo',
  '.cache'
])

const MAX_FILE_BYTES = 1024 * 1024
const DEFAULT_MAX_RESULTS = 2000
const BINARY_CHECK_BYTES = 8000

function normalizeSlashes(value: string): string {
  return value.replace(/\\/g, '/')
}

function resolveSearchRoot(workspaceRoot: string, rootPath?: string): string {
  const workspace = resolve(workspaceRoot)
  if (!rootPath) return workspace

  const absolute = resolve(rootPath)
  const rel = relative(workspace, absolute)
  if (rel.startsWith('..') || rel === '') {
    if (normalizeSlashes(absolute).toLowerCase() === normalizeSlashes(workspace).toLowerCase()) {
      return workspace
    }
    throw new Error(t('search.scopeOutside'))
  }
  return absolute
}

function isProbablyBinary(buffer: Buffer): boolean {
  const sample = buffer.subarray(0, Math.min(buffer.length, BINARY_CHECK_BYTES))
  for (let i = 0; i < sample.length; i++) {
    if (sample[i] === 0) return true
  }
  return false
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function buildMatcher(
  query: string,
  options: Pick<WorkspaceSearchOptions, 'caseSensitive' | 'wholeWord' | 'useRegex'>
): RegExp {
  if (!query) throw new Error(t('search.queryRequired'))

  let source = options.useRegex ? query : escapeRegExp(query)
  if (options.wholeWord) {
    source = `\\b(?:${source})\\b`
  }

  try {
    return new RegExp(source, options.caseSensitive ? 'g' : 'gi')
  } catch {
    throw new Error(t('search.invalidRegex'))
  }
}

function globToRegExp(pattern: string): RegExp {
  const normalized = normalizeSlashes(pattern.trim())
  let source = ''
  for (let i = 0; i < normalized.length; i++) {
    const ch = normalized[i]
    if (ch === '*') {
      if (normalized[i + 1] === '*') {
        source += '.*'
        i++
        if (normalized[i + 1] === '/') i++
      } else {
        source += '[^/]*'
      }
    } else if (ch === '?') {
      source += '[^/]'
    } else if ('\\.()+|^${}[]'.includes(ch)) {
      source += `\\${ch}`
    } else {
      source += ch
    }
  }
  return new RegExp(`^${source}$`, 'i')
}

function matchesGlobList(relativePath: string, patterns: string | undefined, fallback: boolean): boolean {
  if (!patterns?.trim()) return fallback
  const parts = patterns
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
  if (parts.length === 0) return fallback
  const pathNorm = normalizeSlashes(relativePath)
  const baseName = pathNorm.split('/').pop() ?? pathNorm
  return parts.some((pattern) => {
    const re = globToRegExp(pattern)
    return re.test(pathNorm) || re.test(baseName)
  })
}

async function collectFiles(dir: string, files: string[]): Promise<void> {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return
  }

  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name)) continue
      await collectFiles(join(dir, entry.name), files)
      continue
    }
    if (!entry.isFile()) continue
    if (shouldSkipWorkspaceEntry(entry.name, false)) continue
    files.push(join(dir, entry.name))
  }
}

function searchInContent(
  content: string,
  matcher: RegExp,
  maxRemaining: number
): { matches: WorkspaceSearchMatch[]; truncated: boolean } {
  const matches: WorkspaceSearchMatch[] = []
  const lines = content.split(/\r?\n/)

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex]
    matcher.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = matcher.exec(line)) !== null) {
      const text = match[0]
      if (text.length === 0) {
        matcher.lastIndex++
        continue
      }
      matches.push({
        line: lineIndex + 1,
        column: match.index + 1,
        endColumn: match.index + text.length + 1,
        preview: line.length > 200 ? `${line.slice(0, 200)}…` : line,
        matchText: text
      })
      if (matches.length >= maxRemaining) {
        return { matches, truncated: true }
      }
      if (!matcher.global) break
    }
  }

  return { matches, truncated: false }
}

function replaceInContent(
  content: string,
  matcher: RegExp,
  replace: string
): { content: string; count: number } {
  let count = 0
  const next = content.replace(matcher, (...args) => {
    count++
    const groups = args.slice(1, -2) as string[]
    let result = replace
    result = result.replace(/\$(\d+)/g, (_, n: string) => {
      const index = Number(n)
      return groups[index - 1] ?? ''
    })
    result = result.replace(/\$\$/g, '$')
    return result
  })
  return { content: next, count }
}

export async function searchWorkspace(
  workspaceRoot: string,
  options: WorkspaceSearchOptions
): Promise<WorkspaceSearchResult> {
  const query = options.query ?? ''
  if (!query) {
    return { files: [], totalMatches: 0, truncated: false, filesSearched: 0 }
  }

  const searchRoot = resolveSearchRoot(workspaceRoot, options.rootPath)
  const matcher = buildMatcher(query, options)
  const maxResults = options.maxResults ?? DEFAULT_MAX_RESULTS
  const workspaceResolved = resolve(workspaceRoot)

  const allFiles: string[] = []
  const rootStat = await stat(searchRoot)
  if (rootStat.isFile()) {
    allFiles.push(searchRoot)
  } else {
    await collectFiles(searchRoot, allFiles)
  }

  const files: WorkspaceSearchFileResult[] = []
  let totalMatches = 0
  let truncated = false
  let filesSearched = 0

  for (const filePath of allFiles) {
    if (totalMatches >= maxResults) {
      truncated = true
      break
    }

    const relativePath = normalizeSlashes(relative(workspaceResolved, filePath))
    if (!matchesGlobList(relativePath, options.include, true)) continue
    if (matchesGlobList(relativePath, options.exclude, false)) continue

    let buffer: Buffer
    try {
      const info = await stat(filePath)
      if (info.size > MAX_FILE_BYTES) continue
      buffer = await readFile(filePath)
    } catch {
      continue
    }

    if (isProbablyBinary(buffer)) continue

    filesSearched++
    const content = decodeFileBuffer(buffer).content
    const { matches, truncated: fileTruncated } = searchInContent(
      content,
      matcher,
      maxResults - totalMatches
    )
    if (matches.length === 0) continue

    files.push({ path: filePath, relativePath, matches })
    totalMatches += matches.length
    if (fileTruncated) {
      truncated = true
      break
    }
  }

  return { files, totalMatches, truncated, filesSearched }
}

export async function replaceInWorkspace(
  workspaceRoot: string,
  options: WorkspaceReplaceOptions
): Promise<WorkspaceReplaceResult> {
  const query = options.query ?? ''
  if (!query) {
    return { filesChanged: 0, replacements: 0, changedFiles: [], errors: [] }
  }

  const searchRoot = resolveSearchRoot(workspaceRoot, options.rootPath)
  const matcher = buildMatcher(query, options)
  const replace = options.replace ?? ''
  const workspaceResolved = resolve(workspaceRoot)
  const onlyPaths = options.paths?.length
    ? new Set(options.paths.map((p) => normalizeSlashes(resolve(p)).toLowerCase()))
    : null

  const allFiles: string[] = []
  const rootStat = await stat(searchRoot)
  if (rootStat.isFile()) {
    allFiles.push(searchRoot)
  } else {
    await collectFiles(searchRoot, allFiles)
  }

  const changedFiles: WorkspaceReplaceResult['changedFiles'] = []
  const errors: WorkspaceReplaceResult['errors'] = []
  let replacements = 0

  for (const filePath of allFiles) {
    const normalized = normalizeSlashes(resolve(filePath)).toLowerCase()
    if (onlyPaths && !onlyPaths.has(normalized)) continue

    const relativePath = normalizeSlashes(relative(workspaceResolved, filePath))
    if (!matchesGlobList(relativePath, options.include, true)) continue
    if (matchesGlobList(relativePath, options.exclude, false)) continue

    let buffer: Buffer
    try {
      const info = await stat(filePath)
      if (info.size > MAX_FILE_BYTES) continue
      buffer = await readFile(filePath)
    } catch (error) {
      errors.push({
        path: filePath,
        message: error instanceof Error ? error.message : t('search.readFailed')
      })
      continue
    }

    if (isProbablyBinary(buffer)) continue

    const decoded = decodeFileBuffer(buffer)
    const original = decoded.content
    matcher.lastIndex = 0
    const { content, count } = replaceInContent(original, matcher, replace)
    if (count === 0 || content === original) continue

    try {
      await writeFile(filePath, encodeContent(content, decoded.encoding))
      changedFiles.push({ path: filePath, content })
      replacements += count
    } catch (error) {
      errors.push({
        path: filePath,
        message: error instanceof Error ? error.message : t('search.writeFailed')
      })
    }
  }

  return {
    filesChanged: changedFiles.length,
    replacements,
    changedFiles,
    errors
  }
}

/** path separator helper kept for potential Windows path checks */
export const PATH_SEP = sep
