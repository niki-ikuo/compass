import { describe, expect, it } from 'vitest'
import {
  buildFileUnitPreviewApproval,
  detailForProposeActionsReject,
  parseProposeActionsRejectIntent,
  PROPOSE_ACTIONS_REJECT_REVISE_DETAIL,
  PROPOSE_ACTIONS_REJECT_STOP_DETAIL,
  PROPOSE_ACTIONS_REJECT_STOP_PARTIAL_DETAIL
} from './agent-approval-reject'

describe('agent-approval-reject', () => {
  it('builds stop and revise detail strings', () => {
    expect(detailForProposeActionsReject('stop')).toBe(PROPOSE_ACTIONS_REJECT_STOP_DETAIL)
    expect(detailForProposeActionsReject('revise')).toBe(PROPOSE_ACTIONS_REJECT_REVISE_DETAIL)
  })

  it('parses stop and revise intents', () => {
    expect(parseProposeActionsRejectIntent(PROPOSE_ACTIONS_REJECT_STOP_DETAIL)).toBe('stop')
    expect(parseProposeActionsRejectIntent(PROPOSE_ACTIONS_REJECT_REVISE_DETAIL)).toBe('revise')
    expect(parseProposeActionsRejectIntent(PROPOSE_ACTIONS_REJECT_STOP_PARTIAL_DETAIL)).toBe(
      'stop'
    )
  })

  it('treats apply-failed feedback as revise', () => {
    expect(
      parseProposeActionsRejectIntent(
        'Apply failed: hunk mismatch\nThe proposed actions were NOT applied.'
      )
    ).toBe('revise')
  })

  it('defaults legacy full reject to stop', () => {
    expect(
      parseProposeActionsRejectIntent('User rejected the proposed workspace actions')
    ).toBe('stop')
  })

  it('resolves file-unit preview as approved when every remaining file was applied', () => {
    const result = buildFileUnitPreviewApproval(['src/a.ts', 'src/b.ts'], [])
    expect(result.approved).toBe(true)
    expect(result.detail).toContain('User approved and applied 2 workspace action(s)')
    expect(result.detail).toContain('- src/a.ts')
    expect(parseProposeActionsRejectIntent(result.detail)).toBe(null)
  })

  it('resolves mixed file-unit preview as a partial apply', () => {
    const result = buildFileUnitPreviewApproval(['src/a.ts'], ['src/b.ts'])
    expect(result.approved).toBe(true)
    expect(result.detail).toContain('User partially resolved')
    expect(result.detail).toContain('Applied:\n- src/a.ts')
    expect(result.detail).toContain('Rejected:\n- src/b.ts')
  })

  it('stops the run when every remaining file was rejected', () => {
    const result = buildFileUnitPreviewApproval([], ['src/a.ts'])
    expect(result).toEqual({
      approved: false,
      detail: PROPOSE_ACTIONS_REJECT_STOP_PARTIAL_DETAIL
    })
  })

  it('returns null for unrelated details', () => {
    expect(parseProposeActionsRejectIntent('User approved and applied 1 workspace action(s)')).toBe(
      null
    )
    expect(parseProposeActionsRejectIntent(null)).toBe(null)
  })
})
