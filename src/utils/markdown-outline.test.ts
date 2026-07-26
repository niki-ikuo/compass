import { describe, expect, it } from 'vitest'
import {
  compactDiffLines,
  compactProseDiffLines,
  diffMarkdownHeadings,
  extractMarkdownSection,
  extractMarkdownSummary,
  parseGlossaryMarkdown,
  parseMarkdownDocLinks,
  parseMarkdownHeadings,
  replaceMarkdownSection,
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

describe('replaceMarkdownSection', () => {
  it('replaces one heading subtree without touching siblings', () => {
    const text = ['# Title', '', '## Setup', 'old', '## Next', 'keep'].join('\n')
    const next = replaceMarkdownSection(text, 'Setup', '## Setup\nnew body')
    expect(next).toBe(['# Title', '', '## Setup', 'new body', '## Next', 'keep'].join('\n'))
  })

  it('prepends the original heading when body has none', () => {
    const text = ['## Setup', 'old', '## Next', 'keep'].join('\n')
    const next = replaceMarkdownSection(text, 'Setup', 'rewritten')
    expect(next).toBe(['## Setup', 'rewritten', '## Next', 'keep'].join('\n'))
  })

  it('returns null when heading is missing', () => {
    expect(replaceMarkdownSection('# A\n', 'Missing', 'x')).toBeNull()
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

  it('flags glossary term mismatches', () => {
    const glossary = parseGlossaryMarkdown('API Key | apikey\n')
    expect(glossary).toEqual([{ preferred: 'API Key', avoid: ['apikey'] }])
    const issues = validateMarkdownDocument('Use an apikey here.\n', {
      glossaryTerms: glossary
    })
    expect(issues.some((i) => i.kind === 'term_mismatch')).toBe(true)
  })

  it('flags broken heading anchors and missing media', () => {
    const text = [
      '# Title',
      '',
      'See [jump](#missing-section)',
      '![chart](./chart.png)'
    ].join('\n')
    const issues = validateMarkdownDocument(text, {
      relativePath: 'docs/a.md',
      fileExists: (p) => p === 'docs/a.md'
    })
    expect(issues.some((i) => i.kind === 'broken_anchor')).toBe(true)
    expect(issues.some((i) => i.kind === 'broken_media')).toBe(true)
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

describe('compactProseDiffLines', () => {
  it('inserts nearest heading context before a change region', () => {
    const oldText = ['# Title', '', '## Setup', 'alpha', 'beta', 'gamma', 'delta'].join('\n')
    const lines = [
      { type: 'same' as const, content: '# Title' },
      { type: 'same' as const, content: '' },
      { type: 'same' as const, content: '## Setup' },
      { type: 'same' as const, content: 'alpha' },
      { type: 'same' as const, content: 'beta' },
      { type: 'remove' as const, content: 'gamma' },
      { type: 'add' as const, content: 'gamma2' },
      { type: 'same' as const, content: 'delta' }
    ]
    const compact = compactProseDiffLines(lines, oldText, 1)
    expect(compact).toContainEqual({ type: 'heading', level: 2, text: 'Setup' })
    expect(compact).toContainEqual({ type: 'remove', content: 'gamma' })
    expect(compact).toContainEqual({ type: 'add', content: 'gamma2' })
  })
})
