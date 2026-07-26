import { describe, expect, it } from 'vitest'
import { classifyEmbeddingsQuality } from './semantic-index'

describe('classifyEmbeddingsQuality', () => {
  it('returns api when backend is api', () => {
    expect(classifyEmbeddingsQuality('api', 'api:openai:m:ready')).toBe('api')
  })

  it('returns hash when intentional', () => {
    expect(classifyEmbeddingsQuality('hash', 'hash')).toBe('hash')
    expect(classifyEmbeddingsQuality('hash', undefined)).toBe('hash')
  })

  it('returns unavailable when API intent was unready', () => {
    expect(classifyEmbeddingsQuality('hash', 'api:openai:text-embedding-3-small:unready')).toBe(
      'unavailable'
    )
  })

  it('returns fallback when API intent was ready but backend is hash', () => {
    expect(classifyEmbeddingsQuality('hash', 'api:openai:text-embedding-3-small:ready')).toBe(
      'fallback'
    )
  })
})
