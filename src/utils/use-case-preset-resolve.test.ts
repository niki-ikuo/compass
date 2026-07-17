import { describe, expect, it } from 'vitest'
import { resolveEffectiveUseCasePreset } from '@/utils/use-case-preset'

describe('resolveEffectiveUseCasePreset', () => {
  it('prefers UI selection, then workspace, then app, then code', () => {
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
        appPreset: 'general'
      })
    ).toBe('general')

    expect(resolveEffectiveUseCasePreset({})).toBe('code')
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
