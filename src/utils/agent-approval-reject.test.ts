import { describe, expect, it } from 'vitest'
import {
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

  it('returns null for unrelated details', () => {
    expect(parseProposeActionsRejectIntent('User approved and applied 1 workspace action(s)')).toBe(
      null
    )
    expect(parseProposeActionsRejectIntent(null)).toBe(null)
  })
})
