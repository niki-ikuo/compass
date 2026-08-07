import type { AppSettings, EmbeddingsMode } from '../../src/types'
import type { LlmProviderId } from '../../src/types'
import {
  defaultEmbeddingsModel,
  resolveEmbeddingsConnection,
  resolveEmbeddingsModel,
  resolveEmbeddingsProviderId,
  type EmbeddingsConnection
} from '../../src/utils/embeddings'
import { jsonStringifyUtf8Safe } from '../../src/utils/utf8-text'
import { assertSafeApiBaseUrl } from './path-guard'
import { getSettings } from './settings'

export {
  defaultEmbeddingsModel,
  resolveEmbeddingsConnection,
  resolveEmbeddingsModel,
  resolveEmbeddingsProviderId
}
export type { EmbeddingsConnection }

/** Local copy — avoid importing ai-client (circular via semantic-index). */
function buildApiHeaders(
  providerId: LlmProviderId,
  apiKey: string
): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json'
  }
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`
  }
  if (providerId === 'openrouter') {
    headers['HTTP-Referer'] = 'https://github.com/compass-editor'
    headers['X-Title'] = 'Compass'
  }
  return headers
}

const BATCH_SIZE = 64
/** Default for bulk index builds. Query embeds should pass a shorter timeout. */
export const EMBEDDINGS_REQUEST_TIMEOUT_MS = 60_000
/** Interactive search should fail fast and fall back to keyword scoring. */
export const EMBEDDINGS_QUERY_TIMEOUT_MS = 4_000

export interface EmbeddingsBackendMeta {
  backend: EmbeddingsMode
  model: string
  dim: number
}

/**
 * OpenAI-compatible `POST /embeddings`. Returns null on any failure
 * (caller should fall back to local hash embeddings).
 */
export async function embedTextsViaApi(
  texts: string[],
  settings?: AppSettings,
  options?: { timeoutMs?: number }
): Promise<{ vectors: number[][]; meta: EmbeddingsBackendMeta } | null> {
  if (texts.length === 0) {
    return { vectors: [], meta: { backend: 'api', model: '', dim: 0 } }
  }

  const resolved = settings ?? (await getSettings())
  const connection = resolveEmbeddingsConnection(resolved)
  if (!connection) return null
  try {
    assertSafeApiBaseUrl(connection.apiBaseUrl, {
      allowPrivateLan: resolved.allowLanApiBaseUrl === true
    })
  } catch {
    return null
  }

  const timeoutMs = options?.timeoutMs ?? EMBEDDINGS_REQUEST_TIMEOUT_MS
  const vectors: number[][] = []
  let dim = 0

  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE)
    const batchVectors = await fetchEmbeddingBatch(connection, batch, timeoutMs)
    if (!batchVectors) return null
    if (batchVectors.length !== batch.length) return null
    for (const vec of batchVectors) {
      if (!Array.isArray(vec) || vec.length === 0) return null
      if (dim === 0) dim = vec.length
      else if (vec.length !== dim) return null
      vectors.push(vec)
    }
  }

  return {
    vectors,
    meta: { backend: 'api', model: connection.model, dim }
  }
}

async function fetchEmbeddingBatch(
  connection: EmbeddingsConnection,
  input: string[],
  timeoutMs: number
): Promise<number[][] | null> {
  const base = connection.apiBaseUrl.replace(/\/$/, '')
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(`${base}/embeddings`, {
      method: 'POST',
      headers: buildApiHeaders(connection.providerId, connection.apiKey),
      body: jsonStringifyUtf8Safe({ model: connection.model, input }),
      signal: controller.signal
    })
    if (!response.ok) return null
    const json = (await response.json()) as {
      data?: Array<{ embedding?: number[]; index?: number }>
    }
    if (!Array.isArray(json.data) || json.data.length === 0) return null

    const ordered = [...json.data].sort(
      (a, b) => (a.index ?? 0) - (b.index ?? 0)
    )
    const vectors: number[][] = []
    for (const row of ordered) {
      if (!Array.isArray(row.embedding) || row.embedding.length === 0) return null
      vectors.push(row.embedding.map((n) => Number(n)))
    }
    return vectors
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}
