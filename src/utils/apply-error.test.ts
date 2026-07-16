import { describe, expect, it } from 'vitest'
import { getAgentStepTone, getApplyErrorTone, isVerifyUnavailable } from './apply-error'

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
})
