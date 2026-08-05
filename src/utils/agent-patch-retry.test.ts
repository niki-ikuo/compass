import { describe, expect, it } from 'vitest'
import {
  WRITEFILE_FALLBACK_AFTER_PATH_FAILURES,
  createPatchRetryState,
  fingerprintApplyPatch,
  formatIdenticalPatchBlockedGuidance,
  getIdenticalPatchBlockMessage,
  recordPatchMismatchFailure
} from './agent-patch-retry'

const BAD_PATCH = `@@ -1,3 +1,3 @@
 context
-old line
+new line
 context`

const MISMATCH = 'Failed to locate hunk context near line 1: "context"'

describe('agent-patch-retry', () => {
  it('fingerprints path + normalized patch', () => {
    expect(fingerprintApplyPatch('src\\a.ts', '@@\r\n-a\r\n+b\r\n')).toBe(
      fingerprintApplyPatch('src/a.ts', '@@\n-a\n+b\n')
    )
  })

  it('records mismatch and asks for force re-read', () => {
    const state = createPatchRetryState()
    const guidance = recordPatchMismatchFailure(
      state,
      [{ type: 'applyPatch', path: 'src/a.ts', patch: BAD_PATCH }],
      MISMATCH
    )
    expect(guidance).toContain('force=true')
    expect(guidance).toContain('src/a.ts')
    expect(guidance).not.toContain('writeFile')
    expect(state.pathFailures.get('src/a.ts')).toBe(1)
  })

  it('nudges writeFile after repeated path failures', () => {
    const state = createPatchRetryState()
    const first = recordPatchMismatchFailure(
      state,
      [{ type: 'applyPatch', path: 'src/a.ts', patch: BAD_PATCH }],
      MISMATCH
    )
    expect(first).not.toMatch(/writeFile/)

    const second = recordPatchMismatchFailure(
      state,
      [{ type: 'applyPatch', path: 'src/a.ts', patch: `${BAD_PATCH}\n+retry` }],
      MISMATCH
    )
    expect(second).toMatch(/writeFile/)
    expect(state.pathFailures.get('src/a.ts')).toBe(WRITEFILE_FALLBACK_AFTER_PATH_FAILURES)
  })

  it('blocks identical applyPatch after one mismatch failure', () => {
    const state = createPatchRetryState()
    const actions = [{ type: 'applyPatch', path: 'src/a.ts', patch: BAD_PATCH }]
    expect(getIdenticalPatchBlockMessage(state, actions)).toBeNull()

    recordPatchMismatchFailure(state, actions, MISMATCH)
    const blocked = getIdenticalPatchBlockMessage(state, actions)
    expect(blocked).toContain('src/a.ts')
    expect(blocked).toContain('force=true')
  })

  it('allows a different patch for the same path after a failure', () => {
    const state = createPatchRetryState()
    recordPatchMismatchFailure(
      state,
      [{ type: 'applyPatch', path: 'src/a.ts', patch: BAD_PATCH }],
      MISMATCH
    )
    expect(
      getIdenticalPatchBlockMessage(state, [
        { type: 'applyPatch', path: 'src/a.ts', patch: `${BAD_PATCH}\n+changed` }
      ])
    ).toBeNull()
  })

  it('ignores non-mismatch errors', () => {
    const state = createPatchRetryState()
    expect(
      recordPatchMismatchFailure(
        state,
        [{ type: 'applyPatch', path: 'src/a.ts', patch: BAD_PATCH }],
        'actions must be a non-empty array'
      )
    ).toBeNull()
    expect(state.pathFailures.size).toBe(0)
  })

  it('formats identical-block guidance', () => {
    expect(formatIdenticalPatchBlockedGuidance(['a.ts', 'b.ts'])).toContain('a.ts, b.ts')
  })
})
