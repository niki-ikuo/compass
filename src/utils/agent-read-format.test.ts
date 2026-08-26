import { describe, expect, it } from 'vitest'
import { formatFileLines } from './agent-read-format'

describe('formatFileLines', () => {
  it('prefixes 1-based line numbers', () => {
    const result = formatFileLines('alpha\nbeta\ngamma')
    expect(result.startLine).toBe(1)
    expect(result.endLine).toBe(3)
    expect(result.totalLines).toBe(3)
    expect(result.formatted).toBe('1|alpha\n2|beta\n3|gamma')
    expect(result.omitted).toBe(false)
  })

  it('slices with offset and limit', () => {
    const lines = Array.from({ length: 20 }, (_, i) => `line-${i + 1}`).join('\n')
    const result = formatFileLines(lines, { offset: 80, limit: 3 })
    // offset beyond end → empty slice
    expect(result.startLine).toBe(21)
    expect(result.endLine).toBe(20)
    expect(result.formatted).toBe('')

    const mid = formatFileLines(lines, { offset: 8, limit: 3 })
    expect(mid.startLine).toBe(8)
    expect(mid.endLine).toBe(10)
    expect(mid.formatted).toContain(' 8|line-8')
    expect(mid.formatted).toContain('10|line-10')
    expect(mid.omitted).toBe(true)
  })
})
