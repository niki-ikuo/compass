import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: {
    getPath: () => 'C:\\Users\\test\\AppData\\Roaming\\Compass',
    isPackaged: true,
    getAppPath: () => 'C:\\app'
  }
}))

vi.mock('./agent-runner', () => ({
  runAgent: vi.fn()
}))

vi.mock('./ai-undo', () => ({
  applyWorkspaceActionsRecordingUndo: vi.fn()
}))

vi.mock('./path-guard', () => ({
  setActiveWorkspaceRoot: vi.fn()
}))

import { evaluateScheduledJobOutcome } from './agent-job-runner'

const emptyStats = {
  execRejected: 0,
  execApproved: 0,
  execStarts: 0,
  proposeApplied: 0,
  proposeRejected: 0,
  toolStarts: 0
}

describe('evaluateScheduledJobOutcome', () => {
  it('fails auto-apply-files when exec was rejected and no files changed', () => {
    const result = evaluateScheduledJobOutcome({
      doneChannel: 'ai:done',
      changedFiles: [],
      policy: 'auto-apply-files',
      stats: { ...emptyStats, execRejected: 1 }
    })
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/full-unattended|auto-apply-safe/i)
  })

  it('does not fail auto-apply-safe when exec was skipped', () => {
    const result = evaluateScheduledJobOutcome({
      doneChannel: 'ai:done',
      changedFiles: [],
      policy: 'auto-apply-safe',
      stats: { ...emptyStats, execRejected: 1 }
    })
    expect(result.ok).toBe(true)
  })

  it('fails full-unattended when exec ran but no files changed', () => {
    const result = evaluateScheduledJobOutcome({
      doneChannel: 'ai:done',
      changedFiles: [],
      policy: 'full-unattended',
      stats: { ...emptyStats, execStarts: 1, toolStarts: 1 }
    })
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/no workspace files/i)
  })

  it('fails when agent exits with no tools and no file changes', () => {
    const result = evaluateScheduledJobOutcome({
      doneChannel: 'ai:done',
      changedFiles: [],
      policy: 'full-unattended',
      stats: emptyStats
    })
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/without using tools/i)
  })

  it('succeeds when files changed', () => {
    const result = evaluateScheduledJobOutcome({
      doneChannel: 'ai:done',
      changedFiles: ['20260812.md'],
      policy: 'auto-apply-files',
      stats: { ...emptyStats, execRejected: 1 }
    })
    expect(result.ok).toBe(true)
  })

  it('allows report-only with zero writes', () => {
    const result = evaluateScheduledJobOutcome({
      doneChannel: 'ai:done',
      changedFiles: [],
      policy: 'report-only',
      stats: emptyStats
    })
    expect(result.ok).toBe(true)
  })
})
