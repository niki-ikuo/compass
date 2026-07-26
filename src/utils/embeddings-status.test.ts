import { describe, expect, it } from 'vitest'
import type { SemanticEmbeddingsInfo } from '../types'
import { formatEmbeddingsStatus } from './embeddings-status'

const t = (key: string, params?: Record<string, string | number>) => {
  if (!params) return key
  return `${key}:${JSON.stringify(params)}`
}

function info(partial: Partial<SemanticEmbeddingsInfo>): SemanticEmbeddingsInfo {
  return {
    backend: 'hash',
    chunkCount: 12,
    quality: 'hash',
    ...partial
  }
}

describe('formatEmbeddingsStatus', () => {
  it('returns null when info is missing', () => {
    expect(formatEmbeddingsStatus(null, t)).toBeNull()
  })

  it('formats API embeddings with model', () => {
    const labels = formatEmbeddingsStatus(
      info({
        backend: 'api',
        quality: 'api',
        model: 'text-embedding-3-small',
        chunkCount: 40
      }),
      t
    )
    expect(labels?.short).toContain('text-embedding-3-small')
    expect(labels?.detail).toContain('40')
  })

  it('formats API failure fallback', () => {
    const labels = formatEmbeddingsStatus(
      info({ quality: 'fallback', settingsFingerprint: 'api:openai:m:ready' }),
      t
    )
    expect(labels?.short).toBe('status.embeddingsFallbackShort')
  })

  it('formats unavailable API credentials', () => {
    const labels = formatEmbeddingsStatus(
      info({ quality: 'unavailable', settingsFingerprint: 'api:openai:m:unready' }),
      t
    )
    expect(labels?.short).toBe('status.embeddingsUnavailableShort')
  })
})
