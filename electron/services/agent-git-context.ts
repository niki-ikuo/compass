import type { GitDiffResult, GitStatusResult } from '../../src/types'
import { getGitDiff, getGitStatus } from './git'

const MAX_DIRTY_NAMES = 12
const MAX_DIFF_CHARS = 24_000

export function formatGitDirtySummary(status: GitStatusResult): string | null {
  if (!status.available) return null
  if (!status.isRepo) return '[git] not a git repository'
  const names = status.entries.map((e) => e.path).filter(Boolean)
  const shown = names.slice(0, MAX_DIRTY_NAMES)
  const extra = names.length - shown.length
  const branch = status.branch || '(detached)'
  const dirty =
    shown.length === 0
      ? 'clean'
      : `dirty: ${shown.join(', ')}${extra > 0 ? ` (+${extra} more)` : ''}`
  const aheadBehind =
    status.ahead || status.behind
      ? ` ahead ${status.ahead} / behind ${status.behind}`
      : ''
  return `[git] branch ${branch}${aheadBehind}, ${dirty}`
}

export async function loadGitDirtySummary(workspaceRoot: string): Promise<string | null> {
  try {
    const status = await getGitStatus(workspaceRoot)
    return formatGitDirtySummary(status)
  } catch {
    return null
  }
}

export function formatGitStatusForModel(status: GitStatusResult): string {
  const header = formatGitDirtySummary(status)
  if (!status.isRepo || status.entries.length === 0) {
    return header ?? '[git] unavailable'
  }
  const lines = [header ?? '[git]']
  for (const entry of status.entries.slice(0, 80)) {
    lines.push(`${entry.x}${entry.y} ${entry.path}`)
  }
  if (status.entries.length > 80) {
    lines.push(`…(${status.entries.length - 80} more)`)
  }
  return lines.join('\n')
}

export async function executeGitStatusTool(
  workspaceRoot: string
): Promise<{ ok: boolean; summary: string; content: string }> {
  try {
    const status = await getGitStatus(workspaceRoot)
    if (!status.available) {
      return {
        ok: false,
        summary: status.error || 'git not available',
        content: `Error: ${status.error || 'git not available'}`
      }
    }
    const content = formatGitStatusForModel(status)
    return {
      ok: true,
      summary: status.isRepo
        ? `${status.entries.length} dirty path(s)`
        : 'not a git repository',
      content
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, summary: message, content: `Error: ${message}` }
  }
}

export async function executeGitDiffTool(
  workspaceRoot: string,
  pathArg: string,
  side?: 'auto' | 'staged' | 'unstaged'
): Promise<{ ok: boolean; summary: string; content: string }> {
  const path = pathArg.trim()
  if (!path) {
    return { ok: false, summary: 'path is required', content: 'Error: path is required' }
  }
  try {
    const diff: GitDiffResult = await getGitDiff(workspaceRoot, path, side ?? 'auto')
    let patch = diff.patch || '(no diff)'
    if (patch.length > MAX_DIFF_CHARS) {
      patch = `${patch.slice(0, MAX_DIFF_CHARS)}\n…(truncated)`
    }
    return {
      ok: true,
      summary: `${diff.side} diff ${diff.path}${diff.truncated ? ' (truncated)' : ''}`,
      content: `# gitDiff ${diff.path} (${diff.side})\n${patch}`
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, summary: message, content: `Error: ${message}` }
  }
}
