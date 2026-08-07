import type { WorkspaceAction } from '@/types'
import { isSensitivePath } from '@/utils/sensitive-path'

/** Deletes always require a human preview — auto-apply only covers write/patch style edits. */
export function agentProposalHasDeletes(actions: WorkspaceAction[]): boolean {
  return actions.some((a) => a.type === 'deleteFile' || a.type === 'deleteDir')
}

export function agentProposalHasSensitivePaths(actions: WorkspaceAction[]): boolean {
  return actions.some((a) => {
    const path = typeof a.path === 'string' ? a.path : ''
    return path.trim() !== '' && isSensitivePath(path)
  })
}

/**
 * Whether Agent `proposeActions` should apply without showing the approval UI.
 * Setting must be on; delete actions and sensitive paths always fall back to manual approval.
 */
export function shouldAutoApplyAgentProposal(
  enabled: boolean,
  actions: WorkspaceAction[]
): boolean {
  if (!enabled) return false
  if (actions.length === 0) return false
  if (agentProposalHasDeletes(actions)) return false
  if (agentProposalHasSensitivePaths(actions)) return false
  return true
}
