import { describe, expect, it } from 'vitest'
import {
  createCompareTabPath,
  isCompareOpenFile,
  isCompareTabPath,
  pathsEqualIgnoreCase
} from './compare-tab'

describe('compare-tab', () => {
  it('creates and detects compare tab paths', () => {
    const path = createCompareTabPath('abc')
    expect(path).toBe('compass-compare://abc')
    expect(isCompareTabPath(path)).toBe(true)
    expect(isCompareTabPath('C:/tmp/a.md')).toBe(false)
  })

  it('detects compare open files', () => {
    expect(isCompareOpenFile({ viewKind: 'compare' })).toBe(true)
    expect(isCompareOpenFile({ viewKind: 'text' })).toBe(false)
  })

  it('compares paths case-insensitively', () => {
    expect(pathsEqualIgnoreCase('C:\\Foo\\a.md', 'c:/foo/a.md')).toBe(true)
    expect(pathsEqualIgnoreCase('a.md', 'b.md')).toBe(false)
  })
})
