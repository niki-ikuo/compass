import { describe, expect, it } from 'vitest'
import { resolveInlineCompletionStyle } from '@/utils/inline-completion-prompt'

describe('resolveInlineCompletionStyle', () => {
  it('prefers code languages over use-case preset', () => {
    expect(
      resolveInlineCompletionStyle({
        language: 'typescript',
        useCasePreset: 'general'
      })
    ).toBe('code')
  })

  it('prefers text languages over code use-case', () => {
    expect(
      resolveInlineCompletionStyle({
        language: 'markdown',
        useCasePreset: 'code'
      })
    ).toBe('text')
  })

  it('uses file extension when language is missing', () => {
    expect(resolveInlineCompletionStyle({ filePath: 'notes/plan.md' })).toBe('text')
    expect(resolveInlineCompletionStyle({ filePath: 'src/app.ts' })).toBe('code')
    expect(resolveInlineCompletionStyle({ filePath: 'data/rows.csv' })).toBe('text')
  })

  it('falls back to use-case when language is unknown plaintext', () => {
    expect(
      resolveInlineCompletionStyle({
        language: 'plaintext',
        useCasePreset: 'code'
      })
    ).toBe('code')
    expect(
      resolveInlineCompletionStyle({
        language: 'plaintext',
        useCasePreset: 'document'
      })
    ).toBe('text')
    expect(resolveInlineCompletionStyle({})).toBe('text')
  })

  it('treats yaml/json as text vs code respectively', () => {
    expect(resolveInlineCompletionStyle({ language: 'yaml' })).toBe('text')
    expect(resolveInlineCompletionStyle({ language: 'json' })).toBe('code')
  })
})
