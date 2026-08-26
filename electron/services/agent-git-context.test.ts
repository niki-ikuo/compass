import { describe, expect, it } from 'vitest'
import { formatGitDirtySummary } from './agent-git-context'
import type { GitStatusResult } from '../../src/types'

function status(partial: Partial<GitStatusResult>): GitStatusResult {
  return {
    available: true,
    isRepo: true,
    branch: 'main',
    upstream: null,
    ahead: 0,
    behind: 0,
    entries: [],
    ...partial
  }
}

describe('formatGitDirtySummary', () => {
  it('summarizes dirty names without dumping a diff', () => {
    const text = formatGitDirtySummary(
      status({
        entries: [
          {
            path: 'src/a.ts',
            x: ' ',
            y: 'M',
            kind: 'modified',
            staged: false,
            unstaged: true,
            untracked: false
          },
          {
            path: 'src/b.ts',
            x: '?',
            y: '?',
            kind: 'untracked',
            staged: false,
            unstaged: false,
            untracked: true
          }
        ]
      })
    )
    expect(text).toContain('[git] branch main')
    expect(text).toContain('src/a.ts')
    expect(text).toContain('src/b.ts')
    expect(text).not.toContain('diff --git')
  })

  it('reports a clean repo', () => {
    expect(formatGitDirtySummary(status({ entries: [] }))).toBe('[git] branch main, clean')
  })
})
