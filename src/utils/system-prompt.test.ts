import { describe, expect, it } from 'vitest'
import { composeSystemPrompt, getUseCasePresetReminderKey } from '@/utils/system-prompt'
import { ja, en } from '@/i18n/messages'

describe('composeSystemPrompt', () => {
  it('joins role then mode with a blank line', () => {
    expect(composeSystemPrompt('ROLE', 'MODE')).toBe('ROLE\n\nMODE')
  })

  it('keeps code role + ask mode as distinct layers (ja)', () => {
    const system = composeSystemPrompt(ja['ai.preset.code.role'], ja['ai.askSystemPrompt'])
    expect(system.startsWith(ja['ai.preset.code.role'])).toBe(true)
    expect(system).toContain('\n\n')
    expect(system.endsWith(ja['ai.askSystemPrompt'])).toBe(true)
    expect(ja['ai.askSystemPrompt']).not.toContain('あなたはコーディングアシスタント')
  })

  it('keeps document role distinct from code role (en)', () => {
    expect(en['ai.preset.document.role']).toContain('document-editing assistant')
    expect(en['ai.preset.code.role']).toContain('coding assistant')
    expect(en['ai.preset.document.role']).not.toEqual(en['ai.preset.code.role'])
  })
})

describe('getUseCasePresetReminderKey', () => {
  it('skips reminder for code (and unknown) to keep code path lean', () => {
    expect(getUseCasePresetReminderKey('code')).toBeNull()
    expect(getUseCasePresetReminderKey(undefined)).toBeNull()
    expect(getUseCasePresetReminderKey('other')).toBeNull()
  })

  it('returns short reminder keys for document / data / general', () => {
    expect(getUseCasePresetReminderKey('document')).toBe('ai.preset.document.reminder')
    expect(getUseCasePresetReminderKey('data')).toBe('ai.preset.data.reminder')
    expect(getUseCasePresetReminderKey('general')).toBe('ai.preset.general.reminder')
    expect(ja['ai.preset.document.reminder']).toContain('見出し')
    expect(en['ai.preset.data.reminder']).toContain('columns')
  })
})
