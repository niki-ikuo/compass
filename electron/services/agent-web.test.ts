import { describe, expect, it } from 'vitest'
import { assertSafePublicHttpUrl } from './agent-web'

describe('assertSafePublicHttpUrl', () => {
  it('rejects metadata and private LAN hosts', () => {
    expect(() => assertSafePublicHttpUrl('http://169.254.169.254/latest')).toThrow()
    expect(() => assertSafePublicHttpUrl('http://10.0.0.1/secret')).toThrow()
    expect(() => assertSafePublicHttpUrl('ftp://example.com')).toThrow()
  })

  it('allows public https URLs', () => {
    expect(assertSafePublicHttpUrl('https://example.com/docs')).toBe(
      'https://example.com/docs'
    )
  })
})
