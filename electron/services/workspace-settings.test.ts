import { describe, expect, it } from 'vitest'
import {
  createEmptyWorkspaceSettings,
  resolveWorkspaceDefaultUseCasePreset
} from '../../electron/services/workspace-settings'

describe('workspace-settings helpers', () => {
  it('starts empty and resolves undefined until a preset is set', () => {
    expect(createEmptyWorkspaceSettings()).toEqual({})
    expect(resolveWorkspaceDefaultUseCasePreset({})).toBeUndefined()
    expect(
      resolveWorkspaceDefaultUseCasePreset({ defaultUseCasePreset: 'document' })
    ).toBe('document')
    expect(
      resolveWorkspaceDefaultUseCasePreset({ defaultUseCasePreset: 'nope' as never })
    ).toBeUndefined()
  })
})
