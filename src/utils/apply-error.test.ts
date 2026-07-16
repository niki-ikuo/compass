import { describe, expect, it } from 'vitest'
import {
  formatActionPreviewError,
  getAgentStepStatusLabelKey,
  getAgentStepTone,
  getApplyErrorTone,
  isVerifyUnavailable
} from './apply-error'

describe('apply-error tone helpers', () => {
  it('treats patch context mismatch as warning', () => {
    expect(
      getApplyErrorTone('Failed to locate hunk context near line 1: "async function main()"')
    ).toBe('warning')
  })

  it('treats verify unavailable as skipped warning', () => {
    const summary = 'no verify commands available; skipped test, lint, typecheck'
    expect(isVerifyUnavailable(summary)).toBe(true)
    expect(
      getAgentStepTone({
        name: 'verify',
        ok: true,
        summary
      })
    ).toBe('warning')
    expect(getAgentStepStatusLabelKey({ name: 'verify', ok: true, summary })).toBe(
      'chat.agentToolSkipped'
    )
  })

  it('keeps real verify failures as failed', () => {
    expect(
      getAgentStepTone({
        name: 'verify',
        ok: false,
        summary: 'verify failed: test'
      })
    ).toBe('failed')
  })

  it('treats user rejection as cancelled', () => {
    expect(
      getAgentStepTone({
        name: 'proposeActions',
        ok: false,
        summary: 'User rejected'
      })
    ).toBe('cancelled')
    expect(
      getAgentStepStatusLabelKey({
        name: 'proposeActions',
        ok: false,
        summary: 'User rejected'
      })
    ).toBe('chat.agentToolCancelled')
  })

  it('treats truncated proposeActions as warning', () => {
    const summary =
      'proposeActions arguments were truncated (likely hit the output token limit). Incomplete writeFile/applyPatch payloads are not shown in preview.'
    expect(
      getAgentStepTone({
        name: 'proposeActions',
        ok: false,
        summary
      })
    ).toBe('warning')
  })

  it('treats blocked exec as warning', () => {
    const summary = 'workspace wipe blocked'
    const observation =
      'Error: workspace wipe blocked. Choose a safer command (for example delete a specific path, not the workspace root).'
    expect(
      getAgentStepTone({
        name: 'exec',
        ok: false,
        summary,
        observation
      })
    ).toBe('warning')
    expect(
      getAgentStepStatusLabelKey({
        name: 'exec',
        ok: false,
        summary,
        observation
      })
    ).toBe('chat.agentToolBlocked')
  })

  it('uses patch mismatch detail from observation for proposeActions', () => {
    expect(
      getAgentStepTone({
        name: 'proposeActions',
        ok: false,
        summary: 'Apply failed — re-propose',
        observation:
          'Apply failed: Failed to locate hunk context near line 1: "async function main()"'
      })
    ).toBe('warning')
  })

  it('formats edit preview errors with mismatch copy', () => {
    const message = 'Failed to locate hunk context near line 1'
    expect(
      formatActionPreviewError(message, (_key, params) => `${_key}:${params.message}`)
    ).toBe('chat.patchMismatchError:Failed to locate hunk context near line 1')
  })
})
