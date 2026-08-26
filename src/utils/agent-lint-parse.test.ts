import { describe, expect, it } from 'vitest'
import {
  filterDiagnosticsToPaths,
  formatDiagnosticsForModel,
  parseEslintUnixDiagnostics,
  parseTscDiagnostics
} from './agent-lint-parse'

describe('parseTscDiagnostics', () => {
  it('parses pretty-false tsc lines', () => {
    const out = parseTscDiagnostics(
      `src/foo.ts(12,4): error TS2322: Type 'string' is not assignable to type 'number'.\n`
    )
    expect(out).toEqual([
      {
        path: 'src/foo.ts',
        line: 12,
        column: 4,
        message: "Type 'string' is not assignable to type 'number'.",
        source: 'tsc'
      }
    ])
  })
})

describe('parseEslintUnixDiagnostics', () => {
  it('parses unix format', () => {
    const out = parseEslintUnixDiagnostics(
      `src/bar.ts:3:1: Unexpected var [Error/no-var]\n`
    )
    expect(out[0]).toMatchObject({
      path: 'src/bar.ts',
      line: 3,
      column: 1,
      source: 'eslint'
    })
    expect(out[0].message).toContain('Unexpected var')
  })
})

describe('filterDiagnosticsToPaths / formatDiagnosticsForModel', () => {
  it('keeps only requested relative paths', () => {
    const diags = [
      ...parseTscDiagnostics('src/foo.ts(1,1): error TS1: a\n'),
      ...parseTscDiagnostics('src/other.ts(1,1): error TS1: b\n')
    ]
    const filtered = filterDiagnosticsToPaths(diags, ['src/foo.ts'])
    expect(filtered).toHaveLength(1)
    expect(formatDiagnosticsForModel(filtered)).toContain('src/foo.ts:1:1 [tsc]')
  })
})
