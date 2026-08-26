import { describe, expect, it } from 'vitest'
import { applyExactReplace, countOccurrences } from './agent-str-replace'

describe('applyExactReplace', () => {
  it('replaces a unique substring', () => {
    const result = applyExactReplace('hello world', 'world', 'there')
    expect(result).toEqual({ ok: true, content: 'hello there', replacements: 1 })
  })

  it('errors when oldString is missing', () => {
    const result = applyExactReplace('hello world', 'missing', 'x')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('not_found')
    expect(result.message).toContain('readFile')
  })

  it('errors when the match is not unique unless replaceAll', () => {
    const unique = applyExactReplace('aa aa', 'aa', 'bb')
    expect(unique.ok).toBe(false)
    if (unique.ok) return
    expect(unique.code).toBe('not_unique')
    expect(unique.count).toBe(2)

    const all = applyExactReplace('aa aa', 'aa', 'bb', true)
    expect(all).toEqual({ ok: true, content: 'bb bb', replacements: 2 })
  })

  it('rejects empty oldString', () => {
    const result = applyExactReplace('hello', '', 'x')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('empty_old')
  })
})

describe('countOccurrences', () => {
  it('counts non-overlapping matches', () => {
    expect(countOccurrences('aaa', 'aa')).toBe(1)
    expect(countOccurrences('ababab', 'ab')).toBe(3)
  })
})
