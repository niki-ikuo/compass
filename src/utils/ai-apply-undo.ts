import type {
  ChatAppliedChangeSet,
  WorkspaceChangeEntry,
  WorkspaceChangeSet
} from '@/types'
import { t } from '@/i18n/runtime'

export function summarizeChangeSetEntries(
  entries: WorkspaceChangeEntry[],
  limit = 6
): string {
  const parts = entries
    .slice(0, limit)
    .map((entry) => `${entry.type} ${entry.relativePath}`)
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
