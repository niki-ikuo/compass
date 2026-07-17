import { describe, expect, it } from 'vitest'
import {
  compactDiffLines,
  diffMarkdownHeadings,
  extractMarkdownSummary,
  parseMarkdownHeadings,
  validateMarkdownDocument
} from '@/utils/markdown-outline'

describe('parseMarkdownHeadings', () => {
  it('extracts ATX headings with 1-based line numbers', () => {
    const text = ['# Title', '', '## Section', 'body', '### Detail'].join('\n')
    expect(parseMarkdownHeadings(text)).toEqual([
      { level: 1, text: 'Title', line: 1 },
      { level: 2, text: 'Section', line: 3 },
      { level: 3, text: 'Detail', line: 5 }
    ])
  })

  it('ignores headings inside fenced code blocks', () => {
    const text = ['# Real', '```', '# Fake', '```', '## Also'].join('\n')
    expect(parseMarkdownHeadings(text)).toEqual([
      { level: 1, text: 'Real', line: 1 },
      { level: 2, text: 'Also', line: 5 }
    ])
  })
})

describe('extractMarkdownSummary', () => {
  it('takes the first body paragraph after headings', () => {
    const text = ['# Title', '', 'Hello world.', '', '## Next', 'Ignored'].join('\n')
    expect(extractMarkdownSummary(text, 200)).toBe('Hello world.')
  })

  it('skips fenced code and truncates long text', () => {
    const text = ['```', 'code', '```', 'abcdefghij'].join('\n')
    expect(extractMarkdownSummary(text, 6)).toBe('abcde…')
  })
})

describe('validateMarkdownDocument', () => {
  it('flags broken ATX and level jumps', () => {
    const text = ['#Ok', '# Title', '### Jump'].join('\n')
    const issues = validateMarkdownDocument(text)
    expect(issues.some((i) => i.kind === 'broken_atx')).toBe(true)
    expect(issues.some((i) => i.kind === 'level_jump')).toBe(true)
  })
})

describe('diffMarkdownHeadings', () => {
  it('reports added and removed headings', () => {
    const oldText = '# A\n## B\n'
    const newText = '# A\n## C\n'
    expect(diffMarkdownHeadings(oldText, newText)).toEqual([
      { kind: 'added', level: 2, text: 'C' },
      { kind: 'removed', level: 2, text: 'B' }
    ])
  })
})

describe('compactDiffLines', () => {
  it('folds unchanged lines away from edits', () => {
    const lines = [
      { type: 'same' as const, content: 'a' },
      { type: 'same' as const, content: 'b' },
      { type: 'same' as const, content: 'c' },
      { type: 'remove' as const, content: 'old' },
      { type: 'add' as const, content: 'new' },
      { type: 'same' as const, content: 'd' },
      { type: 'same' as const, content: 'e' },
      { type: 'same' as const, content: 'f' }
    ]
    const compact = compactDiffLines(lines, 1)
    expect(compact[0]).toEqual({ type: 'skip', count: 2 })
    expect(compact).toContainEqual({ type: 'same', content: 'c' })
    expect(compact).toContainEqual({ type: 'remove', content: 'old' })
    expect(compact).toContainEqual({ type: 'add', content: 'new' })
    expect(compact).toContainEqual({ type: 'same', content: 'd' })
    expect(compact.at(-1)).toEqual({ type: 'skip', count: 2 })
  })
})
