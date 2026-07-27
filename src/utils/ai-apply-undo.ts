import type {
  ChatAppliedChangeSet,
  WorkspaceChangeEntry,
  WorkspaceChangeSet,
  WorkspaceChangeSetSummary
} from '@/types'
import { t } from '@/i18n/runtime'
import { truncateMiddlePath } from '@/utils/display-path'

export function summarizeChangeSetEntries(
  entries: WorkspaceChangeEntry[],
  limit = 6
): string {
  const parts = entries
    .slice(0, limit)
    .map((entry) => `${entry.type} ${truncateMiddlePath(entry.relativePath, 36)}`)
  if (entries.length > limit) {
    parts.push(`+${entries.length - limit}`)
  }
  return parts.join(', ')
}

export function toChatAppliedChangeSet(changeSet: WorkspaceChangeSet): ChatAppliedChangeSet {
  return {
    id: changeSet.id,
    entryCount: changeSet.entries.length,
    status: 'applied',
    summary: summarizeChangeSetEntries(changeSet.entries)
  }
}

/** Stronger undo note for chat / Agent continuity. */
export function buildUndidApplyNote(
  changeSet: WorkspaceChangeSet,
  options?: { agentRunning?: boolean }
): string {
  const summary = summarizeChangeSetEntries(changeSet.entries, 8)
  const detail = t('chat.undidApplyDetail', {
    count: changeSet.entries.length,
    summary
  })
  if (options?.agentRunning) {
    return `${t('chat.undidApplyAgentWarning')}\n${detail}`
  }
  return detail
}

export type ApplySummaryMeta = {
  chatTitle?: string
  messagePreview?: string
}

function isChangeSetSummary(
  item: WorkspaceChangeSet | WorkspaceChangeSetSummary
): item is WorkspaceChangeSetSummary {
  return Array.isArray((item as WorkspaceChangeSetSummary).paths)
}

/** Markdown note for optional “save apply summary” from the timeline. */
export function buildApplySummaryMarkdown(
  item: WorkspaceChangeSet | WorkspaceChangeSetSummary,
  meta?: ApplySummaryMeta
): string {
  const entryCount = isChangeSetSummary(item) ? item.entryCount : item.entries.length
  const summary = isChangeSetSummary(item)
    ? item.summary
    : summarizeChangeSetEntries(item.entries, 20)
  const paths = isChangeSetSummary(item)
    ? item.paths
    : item.entries.map((entry) => entry.relativePath)
  const when = new Date(item.createdAt).toISOString()
  const lines = [
    '# AI Apply summary',
    '',
    `- When: ${when}`,
    `- Chat: ${meta?.chatTitle?.trim() || item.chatId}`,
    `- Change set: ${item.id}`,
    `- Source: ${item.source}`,
    `- Status: ${item.status}`,
    `- Changes: ${entryCount}`
  ]
  if (item.messageId) {
    lines.push(`- Message id: ${item.messageId}`)
  }
  if (meta?.messagePreview?.trim()) {
    lines.push(`- Message: ${meta.messagePreview.trim().replace(/\s+/g, ' ').slice(0, 200)}`)
  }
  lines.push('', '## Paths', '')
  if (paths.length === 0) {
    lines.push('(none)')
  } else {
    for (const path of paths) {
      lines.push(`- \`${path}\``)
    }
  }
  lines.push('', '## Summary', '', summary || '(none)', '')
  return lines.join('\n')
}

/** How many tip→target applied sets a cascade undo would reverse (newest-first history). */
export function countCascadeApplies(
  historyNewestFirst: WorkspaceChangeSetSummary[],
  targetId: string
): number {
  let count = 0
  for (const item of historyNewestFirst) {
    if (item.status !== 'applied') continue
    count += 1
    if (item.id === targetId) return count
  }
  return 0
}

export function buildApplySummaryFileName(changeSetId: string, createdAt: number): string {
  const d = new Date(createdAt)
  const pad = (n: number) => String(n).padStart(2, '0')
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  const shortId = changeSetId.replace(/^cs_/, '').slice(0, 12)
  return `${stamp}-${shortId}.md`
}
