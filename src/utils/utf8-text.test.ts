import { describe, expect, it } from 'vitest'
import { jsonStringifyUtf8Safe, sanitizeUtf8Text, sliceUtf16Safe } from '@/utils/utf8-text'

describe('sanitizeUtf8Text', () => {
  it('leaves normal text and valid emoji alone', () => {
    expect(sanitizeUtf8Text('hello 😀 world')).toBe('hello 😀 world')
  })

  it('replaces lone high and low surrogates', () => {
    expect(sanitizeUtf8Text(`a\uD800b`)).toBe('a\uFFFDb')
    expect(sanitizeUtf8Text(`a\uDCFFb`)).toBe('a\uFFFDb')
  })

  it('produces UTF-8-encodable output', () => {
    const dirty = `prefix\uD800suffix😀`
    const clean = sanitizeUtf8Text(dirty)
    expect(() => Buffer.from(clean, 'utf8').toString('utf8')).not.toThrow()
    expect(Buffer.from(clean, 'utf8').toString('utf8')).toBe(clean)
  })
})

describe('sliceUtf16Safe', () => {
  it('does not split an emoji at the end', () => {
    const text = `ab😀cd`
    // 😀 is two code units at indices 2-3
    expect(sliceUtf16Safe(text, 0, 3)).toBe('ab')
    expect(sliceUtf16Safe(text, 0, 4)).toBe('ab😀')
  })

  it('does not start on a low surrogate', () => {
    const text = `ab😀cd`
    expect(sliceUtf16Safe(text, 3)).toBe('cd')
  })
})

describe('jsonStringifyUtf8Safe', () => {
  it('strips lone surrogates from nested strings', () => {
    const json = jsonStringifyUtf8Safe({
      messages: [{ content: `x\uD800y` }]
    })
    expect(json).toContain('\uFFFD')
    expect(json).not.toMatch(/\\ud800/i)
    expect(JSON.parse(json).messages[0].content).toBe('x\uFFFDy')
  })
})
