import { describe, expect, it } from 'vitest'
import { buildSummary } from './project-indexer'

function file(
  path: string,
  overrides: Partial<{
    language: string
    lines: number
    imports: string[]
    exports: string[]
    symbols: Array<{ name: string; kind: string; line: number }>
  }> = {}
) {
  return {
    path,
    language: overrides.language ?? 'typescript',
    lines: overrides.lines ?? 100,
    imports: overrides.imports ?? [],
    exports: overrides.exports ?? [],
    symbols: overrides.symbols ?? []
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
})
