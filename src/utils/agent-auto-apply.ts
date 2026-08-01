import type { WorkspaceAction } from '@/types'

/** Deletes always require a human preview — auto-apply only covers write/patch style edits. */
export function agentProposalHasDeletes(actions: WorkspaceAction[]): boolean {
  return actions.some((a) => a.type === 'deleteFile' || a.type === 'deleteDir')
}

/**
 * Whether Agent `proposeActions` should apply without showing the approval UI.
 * Setting must be on; delete actions always fall back to manual approval.
 */
export function shouldAutoApplyAgentProposal(
  enabled: boolean,
  actions: WorkspaceAction[]
): boolean {
  if (!enabled) return false
  if (actions.length === 0) return false
  if (agentProposalHasDeletes(actions)) return false
  return true
}
