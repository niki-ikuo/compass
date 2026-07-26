import { describe, expect, it } from 'vitest'
import {
  cosineSimilarity,
  embedText,
  keywordOverlapScore,
  tokenize
} from './text-embedder'

describe('text-embedder', () => {
  it('tokenizes english and japanese', () => {
    const tokens = tokenize('Hello 世界 World')
    expect(tokens).toContain('hello')
    expect(tokens).toContain('world')
    expect(tokens).toContain('世')
    expect(tokens).toContain('界')
  })

  it('embeds similar phrases closer than unrelated ones', () => {
    const a = embedText('authentication login password reset')
    const b = embedText('how to reset the login password')
    const c = embedText('gardening tips for tomato plants')
    expect(cosineSimilarity(a, b)).toBeGreaterThan(cosineSimilarity(a, c))
  })

  it('scores keyword overlap', () => {
    expect(keywordOverlapScore('reset password', 'users can reset password here')).toBeGreaterThan(
      0.9
    )
    expect(keywordOverlapScore('reset password', 'unrelated document')).toBe(0)
  })
})
