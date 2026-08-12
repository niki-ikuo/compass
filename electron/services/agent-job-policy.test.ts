import { describe, expect, it, vi } from 'vitest'
import type { WorkspaceAction } from '../../src/types'

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

import { canAutoApplyForJobPolicy } from './agent-job-runner'

describe('canAutoApplyForJobPolicy', () => {
  const write: WorkspaceAction = { type: 'writeFile', path: 'notes.md', content: 'hi' }
  const del: WorkspaceAction = { type: 'deleteFile', path: 'notes.md' }
  const env: WorkspaceAction = { type: 'writeFile', path: '.env', content: 'X=1' }

  it('rejects all writes for report-only', () => {
    expect(canAutoApplyForJobPolicy('report-only', [write])).toBe(false)
  })

  it('allows normal writes for auto-apply-files', () => {
    expect(canAutoApplyForJobPolicy('auto-apply-files', [write])).toBe(true)
  })

  it('rejects deletes and sensitive paths', () => {
    expect(canAutoApplyForJobPolicy('auto-apply-files', [del])).toBe(false)
    expect(canAutoApplyForJobPolicy('auto-apply-files', [env])).toBe(false)
  })
})
