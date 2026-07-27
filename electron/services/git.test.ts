import { mkdtemp, mkdir, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { setLocale } from '../../src/i18n/runtime'
import {
  commitGit,
  getGitDiff,
  getGitStatus,
  parseGitStatusPorcelain,
  setGitRunnerForTests,
  stageGitPaths,
  unstageGitPaths,
  type GitRunResult,
  type GitRunner
} from './git'

afterEach(() => {
  setLocale('en')
  setGitRunnerForTests(null)
})

describe('parseGitStatusPorcelain', () => {
  it('parses branch header with ahead/behind', () => {
    const raw =
      '## main...origin/main [ahead 2, behind 1]\0' + ' M notes.md\0' + '?? draft.txt\0'
    const parsed = parseGitStatusPorcelain(raw)
    expect(parsed.branch).toBe('main')
    expect(parsed.upstream).toBe('origin/main')
    expect(parsed.ahead).toBe(2)
    expect(parsed.behind).toBe(1)
    expect(parsed.entries).toHaveLength(2)
    expect(parsed.entries[0]).toMatchObject({
      path: 'notes.md',
      kind: 'modified',
      staged: false,
      unstaged: true
    })
    expect(parsed.entries[1]).toMatchObject({
      path: 'draft.txt',
      kind: 'untracked',
      staged: false,
      unstaged: true
    })
  })

  it('parses staged and rename entries', () => {
    const raw = '## feature\0M  a.ts\0R  new.md\0old.md\0'
    const parsed = parseGitStatusPorcelain(raw)
    expect(parsed.branch).toBe('feature')
    expect(parsed.entries[0]).toMatchObject({
      path: 'a.ts',
      kind: 'modified',
      staged: true,
      unstaged: false
    })
    expect(parsed.entries[1]).toMatchObject({
      path: 'new.md',
      originalPath: 'old.md',
      kind: 'renamed',
      staged: true
    })
  })

  it('parses no-commits-yet header', () => {
    const parsed = parseGitStatusPorcelain('## No commits yet on main\0?? README.md\0')
    expect(parsed.branch).toBe('main')
    expect(parsed.entries[0]?.path).toBe('README.md')
  })
})

function mockRunner(handlers: Record<string, GitRunResult | ((args: string[]) => GitRunResult)>): GitRunner {
  return async (args) => {
    const key = args.join(' ')
    for (const [pattern, value] of Object.entries(handlers)) {
      if (key === pattern || key.startsWith(pattern)) {
        return typeof value === 'function' ? value(args) : value
      }
    }
    return { code: 1, stdout: '', stderr: `unmocked: ${key}` }
  }
}

describe('getGitStatus', () => {
  it('reports git not available', async () => {
    setGitRunnerForTests(async () => {
      throw new Error('Git was not found on PATH')
    })
    // Force notFound message path via ENOENT-like: call real notFound by throwing matching t()
    setLocale('en')
    setGitRunnerForTests(async () => {
      const { t } = await import('../../src/i18n/runtime')
      throw new Error(t('git.notFound'))
    })
    const status = await getGitStatus(join(tmpdir(), 'missing-ws'))
    expect(status.available).toBe(false)
    expect(status.isRepo).toBe(false)
    expect(status.error).toBeTruthy()
  })

  it('reports non-repo workspace', async () => {
    setGitRunnerForTests(
      mockRunner({
        'rev-parse --is-inside-work-tree': { code: 128, stdout: '', stderr: 'not a git repo' }
      })
    )
    const status = await getGitStatus('C:\\work\\notes')
    expect(status.available).toBe(true)
    expect(status.isRepo).toBe(false)
  })

  it('returns parsed entries for a repo', async () => {
    setGitRunnerForTests(
      mockRunner({
        'rev-parse --is-inside-work-tree': { code: 0, stdout: 'true\n', stderr: '' },
        'status --porcelain=v1 -b -z': {
          code: 0,
          stdout: '## main\0 M doc.md\0',
          stderr: ''
        }
      })
    )
    const status = await getGitStatus('C:\\work\\repo')
    expect(status.isRepo).toBe(true)
    expect(status.branch).toBe('main')
    expect(status.entries).toHaveLength(1)
  })

  it('fetches remote-tracking refs when fetch option is set', async () => {
    const calls: string[][] = []
    setGitRunnerForTests(async (args) => {
      calls.push(args)
      if (args[0] === 'rev-parse') {
        return { code: 0, stdout: 'true\n', stderr: '' }
      }
      if (args[0] === 'fetch') {
        return { code: 0, stdout: '', stderr: '' }
      }
      if (args[0] === 'status') {
        return {
          code: 0,
          stdout: '## main...origin/main [ahead 1, behind 1]\0',
          stderr: ''
        }
      }
      return { code: 1, stdout: '', stderr: `unmocked ${args.join(' ')}` }
    })
    const status = await getGitStatus('C:\\work\\repo', { fetch: true })
    expect(calls.some((c) => c[0] === 'fetch' && c.includes('--prune'))).toBe(true)
    expect(status.ahead).toBe(1)
    expect(status.behind).toBe(1)
  })

  it('skips fetch by default', async () => {
    const calls: string[][] = []
    setGitRunnerForTests(async (args) => {
      calls.push(args)
      if (args[0] === 'rev-parse') {
        return { code: 0, stdout: 'true\n', stderr: '' }
      }
      if (args[0] === 'status') {
        return { code: 0, stdout: '## main...origin/main\0', stderr: '' }
      }
      return { code: 1, stdout: '', stderr: `unmocked ${args.join(' ')}` }
    })
    await getGitStatus('C:\\work\\repo')
    expect(calls.some((c) => c[0] === 'fetch')).toBe(false)
  })
})

describe('stage / unstage / commit (mocked)', () => {
  it('stages paths via git add', async () => {
    const calls: string[][] = []
    setGitRunnerForTests(async (args, cwd) => {
      calls.push(args)
      if (args[0] === 'rev-parse') {
        return { code: 0, stdout: 'true\n', stderr: '' }
      }
      if (args[0] === 'add') {
        return { code: 0, stdout: '', stderr: '' }
      }
      return { code: 1, stdout: '', stderr: `cwd=${cwd}` }
    })
    const root = await mkdtemp(join(tmpdir(), 'compass-git-stage-'))
    await writeFile(join(root, 'a.md'), 'hi\n', 'utf-8')
    const result = await stageGitPaths(root, ['a.md'])
    expect(result.paths).toEqual(['a.md'])
    expect(calls.some((c) => c[0] === 'add')).toBe(true)
  })

  it('unstages with restore --staged', async () => {
    setGitRunnerForTests(async (args) => {
      if (args[0] === 'rev-parse') return { code: 0, stdout: 'true\n', stderr: '' }
      if (args[0] === 'restore') return { code: 0, stdout: '', stderr: '' }
      return { code: 1, stdout: '', stderr: 'no' }
    })
    const root = await mkdtemp(join(tmpdir(), 'compass-git-unstage-'))
    await writeFile(join(root, 'a.md'), 'hi\n', 'utf-8')
    await expect(unstageGitPaths(root, ['a.md'])).resolves.toEqual({ paths: ['a.md'] })
  })

  it('commits with a message file when staged changes exist', async () => {
    setGitRunnerForTests(async (args) => {
      if (args.join(' ') === 'rev-parse --is-inside-work-tree') {
        return { code: 0, stdout: 'true\n', stderr: '' }
      }
      if (args[0] === 'status') {
        return { code: 0, stdout: '## main\0M  a.md\0', stderr: '' }
      }
      if (args[0] === 'commit') {
        return { code: 0, stdout: '[main abc1234] test commit\n', stderr: '' }
      }
      if (args.join(' ') === 'rev-parse --short HEAD') {
        return { code: 0, stdout: 'abc1234\n', stderr: '' }
      }
      return { code: 1, stdout: '', stderr: `unmocked ${args.join(' ')}` }
    })
    const root = await mkdtemp(join(tmpdir(), 'compass-git-commit-'))
    await writeFile(join(root, 'a.md'), 'hi\n', 'utf-8')
    const result = await commitGit(root, 'test commit')
    expect(result.hash).toBe('abc1234')
    expect(result.message).toBe('test commit')
  })

  it('rejects empty commit message', async () => {
    setGitRunnerForTests(async (args) => {
      if (args[0] === 'rev-parse') return { code: 0, stdout: 'true\n', stderr: '' }
      return { code: 1, stdout: '', stderr: 'no' }
    })
    const root = await mkdtemp(join(tmpdir(), 'compass-git-empty-'))
    await expect(commitGit(root, '   ')).rejects.toThrow(/message|メッセージ/i)
  })
})

describe('getGitDiff untracked', () => {
  it('builds a synthetic patch for untracked files', async () => {
    const root = await mkdtemp(join(tmpdir(), 'compass-git-diff-'))
    await mkdir(join(root, 'notes'), { recursive: true })
    await writeFile(join(root, 'notes', 'new.md'), 'hello\nworld\n', 'utf-8')

    setGitRunnerForTests(async (args) => {
      if (args[0] === 'rev-parse') return { code: 0, stdout: 'true\n', stderr: '' }
      if (args[0] === 'status') {
        return { code: 0, stdout: '?? notes/new.md\0', stderr: '' }
      }
      return { code: 1, stdout: '', stderr: 'no diff' }
    })

    const diff = await getGitDiff(root, 'notes/new.md', 'auto')
    expect(diff.side).toBe('unstaged')
    expect(diff.patch).toContain('+++ b/notes/new.md')
    expect(diff.patch).toContain('+hello')
    expect(diff.patch).toContain('+world')
  })
})
