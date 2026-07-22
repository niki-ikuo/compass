import { describe, expect, it } from 'vitest'
import {
  compactDiffLines,
  diffMarkdownHeadings,
  extractMarkdownSection,
  extractMarkdownSummary,
  parseMarkdownDocLinks,
  parseMarkdownHeadings,
  resolveMarkdownLink,
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

describe('extractMarkdownSection', () => {
  it('returns from heading through next same-or-higher level', () => {
    const text = ['# Title', '', '## Setup', 'one', '### Detail', 'two', '## Next', 'three'].join(
      '\n'
    )
    expect(extractMarkdownSection(text, 'Setup')).toBe('## Setup\none\n### Detail\ntwo')
    expect(extractMarkdownSection(text, '## Setup')).toBe('## Setup\none\n### Detail\ntwo')
  })

  it('returns null when heading is missing', () => {
    expect(extractMarkdownSection('# A\n', 'Missing')).toBeNull()
  })
})

describe('parseMarkdownDocLinks / resolveMarkdownLink', () => {
  it('resolves relative doc links and skips urls / images', () => {
    const text = [
      'See [guide](./guide.md#install) and [abs](https://example.com/a.md).',
      '![img](./pic.png)',
      '[other](../shared/note.md)'
    ].join('\n')
    expect(parseMarkdownDocLinks(text, 'docs/index.md')).toEqual([
      'docs/guide.md',
      'shared/note.md'
    ])
    expect(resolveMarkdownLink('docs/a.md', '../../escape.md')).toBeNull()
  })
})

describe('validateMarkdownDocument', () => {
  it('flags broken ATX and level jumps', () => {
    const text = ['#Ok', '# Title', '### Jump'].join('\n')
    const issues = validateMarkdownDocument(text)
    expect(issues.some((i) => i.kind === 'broken_atx')).toBe(true)
    expect(issues.some((i) => i.kind === 'level_jump')).toBe(true)
  })

  it('flags duplicate headings and broken relative doc links', () => {
    const text = ['# Title', '## Dup', '## Dup', '[gone](./missing.md)'].join('\n')
    const issues = validateMarkdownDocument(text, {
      relativePath: 'docs/a.md',
      fileExists: (p) => p === 'docs/a.md'
    })
    expect(issues.some((i) => i.kind === 'duplicate_heading')).toBe(true)
    expect(issues.some((i) => i.kind === 'broken_link')).toBe(true)
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
