import { mkdir, readFile, writeFile } from 'fs/promises'
import { join, relative, resolve } from 'path'
import type {
  WorkspaceSearchFileResult,
  WorkspaceSearchMatch,
  WorkspaceSearchMode,
  WorkspaceSearchOptions,
  WorkspaceSearchResult
} from '../../src/types'
import { chunkFileContent, snippetFromText, type TextChunk } from '../../src/utils/text-chunker'
import {
  cosineSimilarity,
  embedText,
  EMBEDDING_DIM,
  EMBEDDING_VERSION,
  keywordOverlapScore,
  quantizeEmbedding
} from '../../src/utils/text-embedder'

const CHUNKS_FILE = 'chunks.json'
const MAX_CHUNKS_TOTAL = 8000
const DEFAULT_MEANING_RESULTS = 40
const MIN_SCORE = 0.12

export interface IndexedSemanticChunk {
  id: string
  path: string
  heading?: string
  startLine: number
  endLine: number
  summary: string
  snippet: string
  embedding: number[]
}

interface SemanticIndexFile {
  version: number
  dim: number
  chunkCount: number
  chunks: IndexedSemanticChunk[]
}

export interface SemanticSourceFile {
  path: string
  content: string
  language: string
}

export async function writeSemanticIndex(
  workspaceRoot: string,
  sources: SemanticSourceFile[]
): Promise<number> {
  const compassDir = join(workspaceRoot, '.compass')
  await mkdir(compassDir, { recursive: true })
  const chunks: IndexedSemanticChunk[] = []

  for (const source of sources) {
    if (chunks.length >= MAX_CHUNKS_TOTAL) break
    const textChunks = chunkFileContent(source.path, source.content, source.language)
    for (const chunk of textChunks) {
      if (chunks.length >= MAX_CHUNKS_TOTAL) break
      chunks.push(toIndexedChunk(chunk))
    }
  }

  const payload: SemanticIndexFile = {
    version: EMBEDDING_VERSION,
    dim: EMBEDDING_DIM,
    chunkCount: chunks.length,
    chunks
  }
  await writeFile(join(compassDir, CHUNKS_FILE), JSON.stringify(payload), 'utf-8')
  return chunks.length
}

export async function loadSemanticIndex(
  workspaceRoot: string
): Promise<IndexedSemanticChunk[] | null> {
  try {
    const raw = await readFile(join(workspaceRoot, '.compass', CHUNKS_FILE), 'utf-8')
    const data = JSON.parse(raw) as Partial<SemanticIndexFile>
    if (!Array.isArray(data.chunks)) return null
    if (data.version !== EMBEDDING_VERSION || data.dim !== EMBEDDING_DIM) return null
    return data.chunks.filter(isValidChunk)
  } catch {
    return null
  }
}

export async function hasSemanticIndex(workspaceRoot: string): Promise<boolean> {
  const chunks = await loadSemanticIndex(workspaceRoot)
  return Boolean(chunks && chunks.length > 0)
}

export async function searchSemanticWorkspace(
  workspaceRoot: string,
  options: WorkspaceSearchOptions
): Promise<WorkspaceSearchResult> {
  const query = options.query?.trim() ?? ''
  if (!query) {
    return { files: [], totalMatches: 0, truncated: false, filesSearched: 0 }
  }

  const mode: WorkspaceSearchMode = options.mode ?? 'hybrid'
  let chunks = await loadSemanticIndex(workspaceRoot)
  if (!chunks || chunks.length === 0) {
    return { files: [], totalMatches: 0, truncated: false, filesSearched: 0 }
  }

  const rootFilter = normalizeScope(workspaceRoot, options.rootPath)
  if (rootFilter) {
    chunks = chunks.filter((chunk) => {
      if (rootFilter.isFile) return chunk.path === rootFilter.relative
      return chunk.path === rootFilter.relative || chunk.path.startsWith(`${rootFilter.relative}/`)
    })
  }

  if (options.include?.trim() || options.exclude?.trim()) {
    chunks = chunks.filter((chunk) => {
      if (!matchesGlobList(chunk.path, options.include, true)) return false
      if (matchesGlobList(chunk.path, options.exclude, false)) return false
      return true
    })
  }

  const queryEmbedding = embedText(query)
  const scored = chunks
    .map((chunk) => {
      const semantic = cosineSimilarity(queryEmbedding, chunk.embedding)
      const haystack = `${chunk.heading ?? ''} ${chunk.summary} ${chunk.snippet}`
      const keyword = keywordOverlapScore(query, haystack)
      const headingBoost =
        chunk.heading && keywordOverlapScore(query, chunk.heading) > 0 ? 0.08 : 0
      const score =
        mode === 'semantic'
          ? semantic + headingBoost
          : 0.55 * semantic + 0.45 * keyword + headingBoost
      return { chunk, score, semantic, keyword }
    })
    .filter((row) => row.score >= MIN_SCORE)
    .sort((a, b) => b.score - a.score)

  const maxResults = options.maxResults ?? DEFAULT_MEANING_RESULTS
  const top = scored.slice(0, maxResults)
  const truncated = scored.length > top.length

  const byFile = new Map<string, WorkspaceSearchFileResult>()
  for (const { chunk, score } of top) {
    const absolutePath = resolve(workspaceRoot, chunk.path)
    let file = byFile.get(chunk.path)
    if (!file) {
      file = {
        path: absolutePath,
        relativePath: chunk.path,
        matches: []
      }
      byFile.set(chunk.path, file)
    }
    file.matches.push(chunkToMatch(chunk, query, score))
  }

  return {
    files: [...byFile.values()],
    totalMatches: top.length,
    truncated,
    filesSearched: chunks.length
  }
}

/** Format top hybrid hits for Ask/Agent user payloads. */
export async function formatMeaningExcerptsForAi(
  workspaceRoot: string,
  query: string,
  maxHits = 6,
  maxChars = 3200
): Promise<string | null> {
  const trimmed = query.trim()
  if (!trimmed || trimmed.length < 2) return null

  const result = await searchSemanticWorkspace(workspaceRoot, {
    query: trimmed,
    mode: 'hybrid',
    maxResults: maxHits
  })
  if (result.totalMatches === 0) return null

  const lines: string[] = ['[Related workspace excerpts]', 'Use these citations when answering location / topic questions.']
  let used = lines.join('\n').length

  for (const file of result.files) {
    for (const match of file.matches) {
      const heading = match.heading ? ` — ${match.heading}` : ''
      const block = [
        `### ${file.relativePath}${heading} (L${match.line})`,
        match.preview.trim()
      ].join('\n')
      if (used + block.length + 2 > maxChars) {
        lines.push('…(truncated)')
        return lines.join('\n')
      }
      lines.push(block)
      used += block.length + 2
    }
  }

  return lines.join('\n')
}

function toIndexedChunk(chunk: TextChunk): IndexedSemanticChunk {
  const embedSource = [chunk.heading, chunk.summary, chunk.text].filter(Boolean).join('\n')
  return {
    id: chunk.id,
    path: chunk.path,
    heading: chunk.heading,
    startLine: chunk.startLine,
    endLine: chunk.endLine,
    summary: chunk.summary,
    snippet: snippetFromText(chunk.text),
    embedding: quantizeEmbedding(embedText(embedSource))
  }
}

function chunkToMatch(
  chunk: IndexedSemanticChunk,
  query: string,
  score: number
): WorkspaceSearchMatch {
  const preview = chunk.snippet || chunk.summary
  const lowerPreview = preview.toLowerCase()
  const lowerQuery = query.toLowerCase().trim()
  let column = 1
  let endColumn = Math.min(preview.length + 1, 2)
  let matchText = preview.slice(0, Math.min(preview.length, 24))

  if (lowerQuery) {
    const idx = lowerPreview.indexOf(lowerQuery)
    if (idx >= 0) {
      column = idx + 1
      endColumn = idx + lowerQuery.length + 1
      matchText = preview.slice(idx, idx + lowerQuery.length)
    } else {
      // Highlight first overlapping token if possible
      const token = lowerQuery.split(/\s+/).find((t) => t.length >= 2 && lowerPreview.includes(t))
      if (token) {
        const tIdx = lowerPreview.indexOf(token)
        column = tIdx + 1
        endColumn = tIdx + token.length + 1
        matchText = preview.slice(tIdx, tIdx + token.length)
      }
    }
  }

  return {
    line: chunk.startLine,
    column,
    endColumn,
    preview: preview.length > 200 ? `${preview.slice(0, 200)}…` : preview,
    matchText,
    heading: chunk.heading,
    score,
    endLine: chunk.endLine
  }
}

function isValidChunk(chunk: IndexedSemanticChunk): boolean {
  return (
    typeof chunk.id === 'string' &&
    typeof chunk.path === 'string' &&
    typeof chunk.startLine === 'number' &&
    Array.isArray(chunk.embedding) &&
    chunk.embedding.length === EMBEDDING_DIM
  )
}

function normalizeScope(
  workspaceRoot: string,
  rootPath?: string
): { relative: string; isFile: boolean } | null {
  if (!rootPath) return null
  const workspace = resolve(workspaceRoot)
  const absolute = resolve(rootPath)
  const rel = relative(workspace, absolute).replace(/\\/g, '/')
  if (!rel || rel === '.' || rel.startsWith('..')) return null
  const isFile = /\.[a-z0-9]+$/i.test(rel) && !rel.endsWith('/')
  return { relative: rel, isFile }
}

function globToRegExp(pattern: string): RegExp {
  const normalized = pattern.replace(/\\/g, '/').trim()
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
  const baseName = relativePath.split('/').pop() ?? relativePath
  return parts.some((pattern) => {
    const re = globToRegExp(pattern)
    return re.test(relativePath) || re.test(baseName)
  })
}
