import { mkdir, readFile, writeFile } from 'fs/promises'
import { join, relative, resolve } from 'path'
import type {
  EmbeddingsMode,
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
import { embedTextsViaApi } from './embeddings-client'
import { getSettings } from './settings'

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
  backend: EmbeddingsMode
  model?: string
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

  const pending: Array<{ chunk: TextChunk; embedSource: string }> = []
  for (const source of sources) {
    if (pending.length >= MAX_CHUNKS_TOTAL) break
    const textChunks = chunkFileContent(source.path, source.content, source.language)
    for (const chunk of textChunks) {
      if (pending.length >= MAX_CHUNKS_TOTAL) break
      const embedSource = [chunk.heading, chunk.summary, chunk.text].filter(Boolean).join('\n')
      pending.push({ chunk, embedSource })
    }
  }

  let backend: EmbeddingsMode = 'hash'
  let model = ''
  let dim = EMBEDDING_DIM
  let vectors: number[][] | null = null

  const settings = await safeGetSettings()
  if (settings?.embeddingsMode === 'api' && pending.length > 0) {
    const api = await embedTextsViaApi(
      pending.map((row) => row.embedSource),
      settings
    )
    if (api && api.vectors.length === pending.length && api.meta.dim > 0) {
      vectors = api.vectors
      backend = 'api'
      model = api.meta.model
      dim = api.meta.dim
    }
  }

  if (!vectors) {
    vectors = pending.map((row) => quantizeEmbedding(embedText(row.embedSource)))
    backend = 'hash'
    model = ''
    dim = EMBEDDING_DIM
  }

  const chunks: IndexedSemanticChunk[] = pending.map((row, i) => ({
    id: row.chunk.id,
    path: row.chunk.path,
    heading: row.chunk.heading,
    startLine: row.chunk.startLine,
    endLine: row.chunk.endLine,
    summary: row.chunk.summary,
    snippet: snippetFromText(row.chunk.text),
    embedding: quantizeEmbedding(vectors![i])
  }))

  const payload: SemanticIndexFile = {
    version: EMBEDDING_VERSION,
    dim,
    backend,
    model: model || undefined,
    chunkCount: chunks.length,
    chunks
  }
  await writeFile(join(compassDir, CHUNKS_FILE), JSON.stringify(payload), 'utf-8')
  return chunks.length
}

export async function loadSemanticIndex(
  workspaceRoot: string
): Promise<{ chunks: IndexedSemanticChunk[]; meta: Omit<SemanticIndexFile, 'chunks' | 'chunkCount'> } | null> {
  try {
    const raw = await readFile(join(workspaceRoot, '.compass', CHUNKS_FILE), 'utf-8')
    const data = JSON.parse(raw) as Partial<SemanticIndexFile>
    if (!Array.isArray(data.chunks)) return null
    if (data.version !== EMBEDDING_VERSION) return null
    const dim = typeof data.dim === 'number' && data.dim > 0 ? data.dim : EMBEDDING_DIM
    const backend: EmbeddingsMode = data.backend === 'api' ? 'api' : 'hash'
    // Legacy hash indexes omit backend; require classic dim.
    if (backend === 'hash' && dim !== EMBEDDING_DIM) return null
    const chunks = data.chunks.filter((chunk) => isValidChunk(chunk, dim))
    if (chunks.length === 0) return null
    return {
      chunks,
      meta: {
        version: EMBEDDING_VERSION,
        dim,
        backend,
        model: typeof data.model === 'string' ? data.model : undefined
      }
    }
  } catch {
    return null
  }
}

export async function hasSemanticIndex(workspaceRoot: string): Promise<boolean> {
  const loaded = await loadSemanticIndex(workspaceRoot)
  return Boolean(loaded && loaded.chunks.length > 0)
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
  const loaded = await loadSemanticIndex(workspaceRoot)
  if (!loaded || loaded.chunks.length === 0) {
    return { files: [], totalMatches: 0, truncated: false, filesSearched: 0 }
  }

  let chunks = loaded.chunks
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

  const queryEmbedding = await embedQueryVector(query, loaded.meta)
  const scored = chunks
    .map((chunk) => {
      const semantic = queryEmbedding
        ? cosineSimilarity(queryEmbedding, chunk.embedding)
        : 0
      const haystack = `${chunk.heading ?? ''} ${chunk.summary} ${chunk.snippet}`
      const keyword = keywordOverlapScore(query, haystack)
      const headingBoost =
        chunk.heading && keywordOverlapScore(query, chunk.heading) > 0 ? 0.08 : 0
      // If API query embed failed against an API index, degrade to keyword-only.
      const score =
        !queryEmbedding
          ? keyword + headingBoost
          : mode === 'semantic'
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

async function embedQueryVector(
  query: string,
  meta: { backend: EmbeddingsMode; dim: number; model?: string }
): Promise<number[] | null> {
  if (meta.backend === 'api') {
    const settings = await safeGetSettings()
    // Prefer API query embed so space matches the index; fall back to null (keyword-only).
    if (settings?.embeddingsMode === 'api') {
      const api = await embedTextsViaApi([query], settings)
      if (api && api.vectors[0] && api.vectors[0].length === meta.dim) {
        return api.vectors[0]
      }
    }
    return null
  }
  return embedText(query)
}

async function safeGetSettings() {
  try {
    return await getSettings()
  } catch {
    return null
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

function isValidChunk(chunk: IndexedSemanticChunk, dim: number): boolean {
  return (
    typeof chunk.id === 'string' &&
    typeof chunk.path === 'string' &&
    typeof chunk.startLine === 'number' &&
    Array.isArray(chunk.embedding) &&
    chunk.embedding.length === dim
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
