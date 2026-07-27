import { describe, expect, it } from 'vitest'
import {
  formatUiPath,
  formatUiPathList,
  normalizeUiPath,
  truncateMiddlePath
} from './display-path'

describe('normalizeUiPath', () => {
  it('normalizes backslashes and duplicate slashes', () => {
    expect(normalizeUiPath('src\\foo\\\\bar.ts')).toBe('src/foo/bar.ts')
  })
})

describe('truncateMiddlePath', () => {
  it('returns short paths unchanged', () => {
    expect(truncateMiddlePath('src/a.ts', 40)).toBe('src/a.ts')
  })

  it('keeps the filename and first segment when truncating', () => {
    const path = 'src/components/features/editor/panels/FooBar.tsx'
    const label = truncateMiddlePath(path, 36)
    expect(label.startsWith('src/')).toBe(true)
    expect(label.includes('…')).toBe(true)
    expect(label.endsWith('FooBar.tsx')).toBe(true)
    expect(label.length).toBeLessThanOrEqual(36)
  })

  it('falls back to ellipsis + filename when needed', () => {
    const path = 'a/b/c/VeryLongFileNameThatExceedsTheLimit.ts'
    const label = truncateMiddlePath(path, 24)
    expect(label.includes('…')).toBe(true)
    expect(label.endsWith('Limit.ts') || label.includes('VeryLongFileName')).toBe(true)
    expect(label.length).toBeLessThanOrEqual(24)
  })

  it('truncates a long bare filename from the start', () => {
    const label = truncateMiddlePath('SuperCalifragilisticExpialidocious.ts', 16)
    expect(label.startsWith('…')).toBe(true)
    expect(label.length).toBeLessThanOrEqual(16)
  })
})

describe('formatUiPath', () => {
  it('strips workspace root and truncates the label', () => {
    const root = 'C:/Users/niki/Desktop/SecondBrain'
    const abs = `${root}/notes/projects/deep/nested/readme.md`
    const { label, title } = formatUiPath(abs, { workspaceRoot: root, maxChars: 28 })
    expect(title).toBe('notes/projects/deep/nested/readme.md')
    expect(label).not.toContain('C:/Users')
    expect(label.endsWith('readme.md')).toBe(true)
    expect(label.length).toBeLessThanOrEqual(28)
  })

  it('leaves already-relative paths as title', () => {
    const { label, title } = formatUiPath('docs/a.md', { maxChars: 40 })
    expect(label).toBe('docs/a.md')
    expect(title).toBe('docs/a.md')
  })
})

describe('formatUiPathList', () => {
  it('joins truncated paths and reports overflow', () => {
    const paths = [
      'src/a/b/c/one.ts',
      'src/a/b/c/two.ts',
      'src/a/b/c/three.ts',
      'src/a/b/c/four.ts',
      'src/a/b/c/five.ts'
    ]
    const { label, title } = formatUiPathList(paths, { maxItems: 2, maxChars: 20 })
    expect(label).toContain('+3')
    expect(title.split(', ')).toHaveLength(5)
  })
})
