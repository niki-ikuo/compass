import { describe, expect, it } from 'vitest'
import { resolveEffectiveUseCasePreset } from '@/utils/use-case-preset'

describe('resolveEffectiveUseCasePreset', () => {
  it('prefers UI selection, then workspace, then app, then general', () => {
    expect(
      resolveEffectiveUseCasePreset({
        uiPreset: 'data',
        workspacePreset: 'document',
        appPreset: 'general'
      })
    ).toBe('data')

    expect(
      resolveEffectiveUseCasePreset({
        uiPreset: undefined,
        workspacePreset: 'document',
        appPreset: 'general'
      })
    ).toBe('document')

    expect(
      resolveEffectiveUseCasePreset({
        workspacePreset: undefined,
        appPreset: 'code'
      })
    ).toBe('code')

    expect(resolveEffectiveUseCasePreset({})).toBe('general')
  })

  it('ignores invalid values', () => {
    expect(
      resolveEffectiveUseCasePreset({
        uiPreset: 'nope' as never,
        workspacePreset: 'document',
        appPreset: 'code'
      })
    ).toBe('document')
  })
})
