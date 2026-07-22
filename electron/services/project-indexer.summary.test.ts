import { describe, expect, it } from 'vitest'
import type { DataSchema } from '../../src/utils/data-outline'
import {
  buildSummary,
  compactSummaryForPreset,
  expandRelatedPathsForPreset,
  extractSummarySection
} from './project-indexer'

function file(
  path: string,
  overrides: Partial<{
    language: string
    lines: number
    imports: string[]
    exports: string[]
    symbols: Array<{ name: string; kind: string; line: number }>
    headings: Array<{ level: number; text: string; line: number }>
    summary: string
    docLinks: string[]
    dataSchema: DataSchema
  }> = {}
) {
  return {
    path,
    language: overrides.language ?? 'typescript',
    lines: overrides.lines ?? 100,
    imports: overrides.imports ?? [],
    exports: overrides.exports ?? [],
    symbols: overrides.symbols ?? [],
    ...(overrides.headings ? { headings: overrides.headings } : {}),
    ...(overrides.summary ? { summary: overrides.summary } : {}),
    ...(overrides.docLinks ? { docLinks: overrides.docLinks } : {}),
    ...(overrides.dataSchema ? { dataSchema: overrides.dataSchema } : {})
  }
}

describe('buildSummary', () => {
  it('surfaces entry points and exports', () => {
    const files = [
      file('src/utils/helper.ts', {
        exports: ['clamp'],
        symbols: [{ name: 'clamp', kind: 'function', line: 3 }]
      }),
      file('electron/main.ts', {
        exports: ['bootstrap'],
        symbols: [
          { name: 'bootstrap', kind: 'function', line: 10 },
          { name: 'createWindow', kind: 'function', line: 40 }
        ]
      }),
      file('package.json', { language: 'json', lines: 40 })
    ]
    const edges = [
      { from: 'electron/main.ts', to: 'src/utils/helper.ts', type: 'import' as const }
    ]

    const summary = buildSummary(files, edges)
    expect(summary).toContain('## Entry points')
    expect(summary).toContain('electron/main.ts')
    expect(summary).toContain('package.json')
    expect(summary).toMatch(/exports:\s*bootstrap/)
    expect(summary).toContain('## File Overview')
    expect(summary).toContain('## Key Relations')
  })

  it('includes symbol kinds with line numbers when exports are absent', () => {
    const summary = buildSummary(
      [
        file('lib/internal.ts', {
          symbols: [{ name: 'hidden', kind: 'function', line: 7 }]
        })
      ],
      []
    )
    expect(summary).toContain('hidden(function@L7)')
  })

  it('includes a Documents section with markdown headings and summary', () => {
    const summary = buildSummary(
      [
        file('docs/guide.md', {
          language: 'markdown',
          lines: 40,
          headings: [
            { level: 1, text: 'Guide', line: 1 },
            { level: 2, text: 'Setup', line: 5 }
          ],
          summary: 'How to install Compass.'
        }),
        file('src/app.ts', {
          exports: ['run'],
          symbols: [{ name: 'run', kind: 'function', line: 1 }]
        })
      ],
      []
    )
    expect(summary).toContain('## Documents')
    expect(summary).toContain('docs/guide.md')
    expect(summary).toContain('headings: # Guide > ## Setup')
    expect(summary).toContain('summary: How to install Compass.')
  })

  it('includes a Data section with CSV/JSON schema briefs', () => {
    const summary = buildSummary(
      [
        file('data/sales.csv', {
          language: 'csv',
          lines: 10,
          dataSchema: {
            kind: 'csv',
            fields: ['sku', 'qty'],
            rowCount: 8,
            fieldTypes: { sku: 'string', qty: 'integer' },
            shape: 'csv columns[2]: sku, qty; rows: 8',
            sample: 'A1, 3'
          }
        }),
        file('data/users.json', {
          language: 'json',
          lines: 20,
          dataSchema: {
            kind: 'json',
            fields: ['id', 'name'],
            rowCount: 2,
            shape: 'json array[2] keys: id, name'
          }
        }),
        file('src/app.ts', {
          exports: ['run'],
          symbols: [{ name: 'run', kind: 'function', line: 1 }]
        })
      ],
      []
    )
    expect(summary).toContain('## Data')
    expect(summary).toContain('data/sales.csv')
    expect(summary).toContain('columns[2]: sku, qty')
    expect(summary).toContain('data/users.json')
    expect(summary).toContain('array[2] keys: id, name')
  })
})

describe('compactSummaryForPreset', () => {
  const summary = [
    '# Compass Project Index',
    '',
    '## Entry points',
    '- src/main.ts',
    '',
    '## Documents',
    '- docs/guide.md | headings: # Guide',
    '- docs/plan.md | headings: # Plan',
    '',
    '## Data',
    '- data/a.csv | csv columns[2]: x, y; rows: 3',
    '- data/b.json | json array[2] keys: id',
    '',
    '## File Overview',
    '- src/main.ts'
  ].join('\n')

  it('extracts the Data section', () => {
    expect(extractSummarySection(summary, '## Data')).toContain('data/a.csv')
  })

  it('puts Data first for the data preset', () => {
    const compact = compactSummaryForPreset(summary, 'data', 500)
    expect(compact.indexOf('## Data')).toBeLessThan(compact.indexOf('## Entry points'))
    expect(compact).toContain('data/a.csv')
  })

  it('puts Documents first for the document preset', () => {
    const compact = compactSummaryForPreset(summary, 'document', 500)
    expect(compact.indexOf('## Documents')).toBeLessThan(compact.indexOf('## Entry points'))
    expect(compact).toContain('docs/guide.md')
  })

  it('leaves order alone for other presets', () => {
    const compact = compactSummaryForPreset(summary, 'code', 500)
    expect(compact.indexOf('## Entry points')).toBeLessThan(compact.indexOf('## Data'))
  })
})

describe('expandRelatedPathsForPreset', () => {
  it('adds sibling markdown and doc link targets for document', () => {
    const related = new Set<string>(['docs/a.md'])
    expandRelatedPathsForPreset({
      preset: 'document',
      focusPaths: ['docs/a.md'],
      files: [
        file('docs/a.md', {
          language: 'markdown',
          docLinks: ['shared/note.md']
        }),
        file('docs/b.md', { language: 'markdown' }),
        file('shared/note.md', { language: 'markdown' }),
        file('other/c.md', { language: 'markdown' }),
        file('src/app.ts')
      ],
      related
    })
    expect(related.has('docs/b.md')).toBe(true)
    expect(related.has('shared/note.md')).toBe(true)
    expect(related.has('other/c.md')).toBe(false)
  })

  it('adds sibling data files for data preset', () => {
    const related = new Set<string>(['data/a.csv'])
    expandRelatedPathsForPreset({
      preset: 'data',
      focusPaths: ['data/a.csv'],
      files: [
        file('data/a.csv', {
          language: 'csv',
          dataSchema: {
            kind: 'csv',
            fields: ['x'],
            shape: 'csv'
          }
        }),
        file('data/b.csv', {
          language: 'csv',
          dataSchema: {
            kind: 'csv',
            fields: ['y'],
            shape: 'csv'
          }
        }),
        file('other/c.csv', {
          language: 'csv',
          dataSchema: {
            kind: 'csv',
            fields: ['z'],
            shape: 'csv'
          }
        })
      ],
      related
    })
    expect(related.has('data/b.csv')).toBe(true)
    expect(related.has('other/c.csv')).toBe(false)
  })
})
