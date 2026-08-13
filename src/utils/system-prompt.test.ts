import { describe, expect, it } from 'vitest'
import { composeSystemPrompt, getUseCasePresetReminderKey, normalizeCustomRolePrompt, resolveRolePromptLayer } from '@/utils/system-prompt'
import { ja, en } from '@/i18n/messages'
import { CONTEXT_BUDGET } from '@/utils/context-budget'

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

describe('ai.responseLanguage', () => {
  it('pins reply language for ja and en catalogs', () => {
    expect(ja['ai.responseLanguage']).toContain('日本語')
    expect(en['ai.responseLanguage']).toContain('English')
  })
})

describe('normalizeCustomRolePrompt', () => {
  it('returns null for empty or whitespace', () => {
    expect(normalizeCustomRolePrompt(undefined)).toBeNull()
    expect(normalizeCustomRolePrompt('')).toBeNull()
    expect(normalizeCustomRolePrompt('   \n')).toBeNull()
  })

  it('trims and keeps a short role', () => {
    expect(normalizeCustomRolePrompt('  You are a PM.  ')).toBe('You are a PM.')
  })

  it('truncates to the role token budget', () => {
    const long = `You are a PM. ${'x'.repeat(20_000)}`
    const out = normalizeCustomRolePrompt(long, CONTEXT_BUDGET.roleTokens)
    expect(out).not.toBeNull()
    expect(out!.length).toBeLessThan(long.length)
    expect(out).toContain('You are a PM.')
  })
})

describe('resolveRolePromptLayer', () => {
  it('uses custom role when present and otherwise the preset', () => {
    expect(resolveRolePromptLayer('PRESET', 'You are a PM.')).toBe('You are a PM.')
    expect(resolveRolePromptLayer('PRESET', '  ')).toBe('PRESET')
    expect(resolveRolePromptLayer('PRESET', null)).toBe('PRESET')
  })
})
