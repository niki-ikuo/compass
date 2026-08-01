import { describe, expect, it } from 'vitest'
import {
  agentProposalHasDeletes,
  shouldAutoApplyAgentProposal
} from '@/utils/agent-auto-apply'
import type { WorkspaceAction } from '@/types'

describe('shouldAutoApplyAgentProposal', () => {
  const writes: WorkspaceAction[] = [
    { type: 'writeFile', path: 'a.md', content: 'x' }
  ]
  const withDelete: WorkspaceAction[] = [
    { type: 'writeFile', path: 'a.md', content: 'x' },
    { type: 'deleteFile', path: 'b.md' }
  ]

  it('is off when setting is false', () => {
    expect(shouldAutoApplyAgentProposal(false, writes)).toBe(false)
  })

  it('is on for write-only proposals when enabled', () => {
    expect(shouldAutoApplyAgentProposal(true, writes)).toBe(true)
  })

  it('refuses empty action lists', () => {
    expect(shouldAutoApplyAgentProposal(true, [])).toBe(false)
  })

  it('refuses proposals that include deletes', () => {
    expect(agentProposalHasDeletes(withDelete)).toBe(true)
    expect(shouldAutoApplyAgentProposal(true, withDelete)).toBe(false)
  })
})
