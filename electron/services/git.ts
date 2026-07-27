import { execFile } from 'child_process'
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join, relative, resolve } from 'path'
import { promisify } from 'util'
import { t } from '../../src/i18n/runtime'
import type {
  GitCommitResult,
  GitDiffResult,
  GitDiffSide,
  GitStageResult,
  GitStatusEntry,
  GitStatusKind,
  GitStatusResult
} from '../../src/types'
import { resolveInsideWorkspace } from './filesystem'

const execFileAsync = promisify(execFile)

const GIT_TIMEOUT_MS = 30_000
const MAX_DIFF_CHARS = 400_000
const MAX_COMMIT_MESSAGE_CHARS = 10_000
const MAX_PATHS = 500

export type GitRunResult = {
  code: number
  stdout: string
  stderr: string
}

/** Test seam — override in unit tests. */
export type GitRunner = (
  args: string[],
  cwd: string
) => Promise<GitRunResult>

let gitRunner: GitRunner = defaultGitRunner

export function setGitRunnerForTests(runner: GitRunner | null): void {
  gitRunner = runner ?? defaultGitRunner
}

async function defaultGitRunner(args: string[], cwd: string): Promise<GitRunResult> {
  try {
    const { stdout, stderr } = await execFileAsync('git', args, {
      cwd,
      timeout: GIT_TIMEOUT_MS,
      maxBuffer: 8 * 1024 * 1024,
      windowsHide: true,
      encoding: 'utf-8'
    })
    return { code: 0, stdout: stdout ?? '', stderr: stderr ?? '' }
  } catch (err) {
    const e = err as NodeJS.ErrnoException & {
      code?: string | number
      stdout?: string
      stderr?: string
      killed?: boolean
    }
    if (e.code === 'ENOENT') {
      throw new Error(t('git.notFound'))
    }
    if (e.killed) {
      throw new Error(t('git.timeout'))
    }
    const exitCode = typeof e.code === 'number' ? e.code : 1
    return {
      code: exitCode,
      stdout: typeof e.stdout === 'string' ? e.stdout : '',
      stderr: typeof e.stderr === 'string' ? e.stderr : e.message || String(err)
    }
  }
}

function runGit(args: string[], cwd: string): Promise<GitRunResult> {
  return gitRunner(args, cwd)
}

function normalizeRelPath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\.\//, '')
}

function mapXyToKind(x: string, y: string): GitStatusKind {
  if (x === 'U' || y === 'U' || (x === 'A' && y === 'A') || (x === 'D' && y === 'D')) {
    return 'conflict'
  }
  if (x === '?' || y === '?') return 'untracked'
  if (x === '!' || y === '!') return 'ignored'
  if (x === 'R' || y === 'R') return 'renamed'
  if (x === 'C' || y === 'C') return 'copied'
  if (x === 'A' || y === 'A') return 'added'
  if (x === 'D' || y === 'D') return 'deleted'
  if (x === 'M' || y === 'M') return 'modified'
  if (x === 'T' || y === 'T') return 'modified'
  return 'modified'
}

/**
 * Parse `git status --porcelain=v1 -b -z` output.
 * Exported for unit tests.
 */
export function parseGitStatusPorcelain(raw: string): {
  branch: string | null
  upstream: string | null
  ahead: number
  behind: number
  entries: GitStatusEntry[]
} {
  const parts = raw.split('\0').filter((p, i, arr) => !(p === '' && i === arr.length - 1))
  let branch: string | null = null
  let upstream: string | null = null
  let ahead = 0
  let behind = 0
  const entries: GitStatusEntry[] = []

  let i = 0
  while (i < parts.length) {
    const part = parts[i]
    if (!part) {
      i += 1
      continue
    }

    if (part.startsWith('## ')) {
      const header = part.slice(3)
      const aheadMatch = header.match(/ahead\s+(\d+)/)
      const behindMatch = header.match(/behind\s+(\d+)/)
      ahead = aheadMatch ? Number(aheadMatch[1]) : 0
      behind = behindMatch ? Number(behindMatch[1]) : 0

      const noUpstream = header.match(/^(.+?)\.\.\.(.+?)(?:\s|$)/)
      if (noUpstream) {
        branch = noUpstream[1] === 'HEAD' ? 'HEAD' : noUpstream[1]
        upstream = noUpstream[2]
      } else if (header.startsWith('No commits yet on ')) {
        branch = header.slice('No commits yet on '.length).trim() || null
      } else if (header.startsWith('HEAD (no branch)')) {
        branch = 'HEAD'
      } else {
        branch = header.split(/\s/)[0] || null
      }
      i += 1
      continue
    }

    if (part.length < 3) {
      i += 1
      continue
    }

    const x = part[0] ?? ' '
    const y = part[1] ?? ' '
    let path = part.slice(3)
    let originalPath: string | undefined

    // Rename/copy (-z): current path is the new path; next record is the old path
    if (x === 'R' || x === 'C' || y === 'R' || y === 'C') {
      const next = parts[i + 1]
      if (next !== undefined) {
        originalPath = normalizeRelPath(next)
        i += 1
      }
    }

    const rel = normalizeRelPath(path)
    if (!rel) {
      i += 1
      continue
    }

    const untracked = x === '?' && y === '?'
    const staged = !untracked && x !== ' ' && x !== '?'
    const unstaged = untracked || (y !== ' ' && y !== '?')

    entries.push({
      path: rel,
      originalPath: originalPath ? normalizeRelPath(originalPath) : undefined,
      x,
      y,
      kind: mapXyToKind(x, y),
      staged,
      unstaged,
      untracked
    })
    i += 1
  }

  return { branch, upstream, ahead, behind, entries }
}

async function ensureGitRepo(workspaceRoot: string): Promise<string> {
  const root = resolve(workspaceRoot)
  const rev = await runGit(['rev-parse', '--is-inside-work-tree'], root)
  if (rev.code !== 0 || rev.stdout.trim() !== 'true') {
    throw new Error(t('git.notRepo'))
  }
  return root
}

async function buildUntrackedDiff(root: string, rel: string): Promise<string> {
  try {
    const content = await readFile(join(root, rel), 'utf-8')
    const lines = content.split('\n')
    // Drop trailing empty line from final newline so hunk count matches git-ish output
    const bodyLines =
      lines.length > 0 && lines[lines.length - 1] === '' ? lines.slice(0, -1) : lines
    const count = bodyLines.length
    const hunk =
      count === 0
        ? '@@ -0,0 +0,0 @@\n'
        : `@@ -0,0 +1,${count} @@\n` + bodyLines.map((l) => `+${l}`).join('\n') + '\n'
    return (
      `diff --git a/${rel} b/${rel}\n` +
      `new file mode 100644\n` +
      `--- /dev/null\n` +
      `+++ b/${rel}\n` +
      hunk
    )
  } catch {
    return `diff --git a/${rel} b/${rel}\n--- /dev/null\n+++ b/${rel}\n`
  }
}

function assertRelativePaths(workspaceRoot: string, paths: string[]): string[] {
  if (paths.length === 0) {
    throw new Error(t('git.noPaths'))
  }
  if (paths.length > MAX_PATHS) {
    throw new Error(t('git.tooManyPaths', { max: String(MAX_PATHS) }))
  }
  const normalized: string[] = []
  for (const p of paths) {
    if (typeof p !== 'string' || !p.trim()) {
      throw new Error(t('git.invalidPath'))
    }
    const abs = resolveInsideWorkspace(workspaceRoot, p)
    const rel = normalizeRelPath(relative(resolve(workspaceRoot), abs))
    if (!rel || rel.startsWith('..')) {
      throw new Error(t('git.invalidPath'))
    }
    normalized.push(rel)
  }
  return normalized
}

export type GitStatusOptions = {
  /** When true, run `git fetch --prune` before status so ahead/behind match the remote. */
  fetch?: boolean
}

export async function getGitStatus(
  workspaceRoot: string,
  options?: GitStatusOptions
): Promise<GitStatusResult> {
  const root = resolve(workspaceRoot)
  try {
    const probe = await runGit(['rev-parse', '--is-inside-work-tree'], root)
    if (probe.code !== 0 || probe.stdout.trim() !== 'true') {
      return {
        available: true,
        isRepo: false,
        branch: null,
        upstream: null,
        ahead: 0,
        behind: 0,
        entries: []
      }
    }

    // Refresh remote-tracking refs so ↑/↓ counts are not stuck on a stale origin/*.
    // Failures (offline, auth, timeout) are ignored — local status still proceeds.
    if (options?.fetch) {
      try {
        await runGit(['fetch', '--prune', '--quiet'], root)
      } catch {
        // keep going with local refs
      }
    }

    const result = await runGit(['status', '--porcelain=v1', '-b', '-z'], root)
    if (result.code !== 0) {
      return {
        available: true,
        isRepo: true,
        branch: null,
        upstream: null,
        ahead: 0,
        behind: 0,
        entries: [],
        error: result.stderr.trim() || t('git.statusFailed')
      }
    }

    const parsed = parseGitStatusPorcelain(result.stdout)
    return {
      available: true,
      isRepo: true,
      branch: parsed.branch,
      upstream: parsed.upstream,
      ahead: parsed.ahead,
      behind: parsed.behind,
      entries: parsed.entries
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (message === t('git.notFound')) {
      return {
        available: false,
        isRepo: false,
        branch: null,
        upstream: null,
        ahead: 0,
        behind: 0,
        entries: [],
        error: message
      }
    }
    return {
      available: true,
      isRepo: false,
      branch: null,
      upstream: null,
      ahead: 0,
      behind: 0,
      entries: [],
      error: message
    }
  }
}

export async function getGitDiff(
  workspaceRoot: string,
  path: string,
  side: GitDiffSide = 'auto'
): Promise<GitDiffResult> {
  const root = await ensureGitRepo(workspaceRoot)
  const [rel] = assertRelativePaths(workspaceRoot, [path])

  const tryDiff = async (args: string[]): Promise<string> => {
    const result = await runGit(args, root)
    // git diff exits 0 normally; some setups may still return 1 with differences
    if (result.code !== 0 && result.code !== 1) {
      throw new Error(result.stderr.trim() || t('git.diffFailed'))
    }
    return result.stdout
  }

  const status = await runGit(['status', '--porcelain=v1', '-z', '--', rel], root)
  const entry = parseGitStatusPorcelain(status.stdout).entries.find((e) => e.path === rel)

  let patch = ''
  let resolvedSide: Exclude<GitDiffSide, 'auto'> = 'unstaged'

  if (side === 'staged') {
    patch = await tryDiff(['diff', '--cached', '--', rel])
    resolvedSide = 'staged'
  } else if (side === 'unstaged') {
    if (entry?.untracked) {
      patch = await buildUntrackedDiff(root, rel)
    } else {
      patch = await tryDiff(['diff', '--', rel])
    }
    resolvedSide = 'unstaged'
  } else if (entry?.untracked) {
    patch = await buildUntrackedDiff(root, rel)
    resolvedSide = 'unstaged'
  } else {
    const unstaged = await tryDiff(['diff', '--', rel])
    if (unstaged.trim()) {
      patch = unstaged
      resolvedSide = 'unstaged'
    } else {
      patch = await tryDiff(['diff', '--cached', '--', rel])
      resolvedSide = 'staged'
    }
  }

  let truncated = false
  if (patch.length > MAX_DIFF_CHARS) {
    patch = patch.slice(0, MAX_DIFF_CHARS)
    truncated = true
  }

  return {
    path: rel,
    side: resolvedSide,
    patch,
    truncated
  }
}

export async function stageGitPaths(
  workspaceRoot: string,
  paths: string[]
): Promise<GitStageResult> {
  const root = await ensureGitRepo(workspaceRoot)
  const rels = assertRelativePaths(workspaceRoot, paths)
  const result = await runGit(['add', '--', ...rels], root)
  if (result.code !== 0) {
    throw new Error(result.stderr.trim() || t('git.stageFailed'))
  }
  return { paths: rels }
}

export async function unstageGitPaths(
  workspaceRoot: string,
  paths: string[]
): Promise<GitStageResult> {
  const root = await ensureGitRepo(workspaceRoot)
  const rels = assertRelativePaths(workspaceRoot, paths)
  // restore --staged works on modern git; fallback to reset HEAD
  let result = await runGit(['restore', '--staged', '--', ...rels], root)
  if (result.code !== 0) {
    result = await runGit(['reset', 'HEAD', '--', ...rels], root)
  }
  if (result.code !== 0) {
    throw new Error(result.stderr.trim() || t('git.unstageFailed'))
  }
  return { paths: rels }
}

export async function commitGit(
  workspaceRoot: string,
  message: string,
  options?: { paths?: string[] }
): Promise<GitCommitResult> {
  const root = await ensureGitRepo(workspaceRoot)
  const trimmed = (message ?? '').trim()
  if (!trimmed) {
    throw new Error(t('git.emptyMessage'))
  }
  if (trimmed.length > MAX_COMMIT_MESSAGE_CHARS) {
    throw new Error(
      t('git.messageTooLong', { max: String(MAX_COMMIT_MESSAGE_CHARS) })
    )
  }

  if (options?.paths && options.paths.length > 0) {
    await stageGitPaths(workspaceRoot, options.paths)
  }

  const status = await getGitStatus(workspaceRoot)
  const hasStaged = status.entries.some((e) => e.staged)
  if (!hasStaged) {
    throw new Error(t('git.nothingToCommit'))
  }

  const dir = await mkdtemp(join(tmpdir(), 'compass-git-commit-'))
  const msgPath = join(dir, 'COMMIT_EDITMSG')
  try {
    await writeFile(msgPath, `${trimmed}\n`, 'utf-8')
    const result = await runGit(['commit', '-F', msgPath], root)
    if (result.code !== 0) {
      throw new Error(result.stderr.trim() || result.stdout.trim() || t('git.commitFailed'))
    }

    const rev = await runGit(['rev-parse', '--short', 'HEAD'], root)
    const hash = rev.code === 0 ? rev.stdout.trim() : ''
    return {
      hash,
      message: trimmed,
      summary: result.stdout.trim().split('\n')[0] ?? trimmed
    }
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined)
  }
}
