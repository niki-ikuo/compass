import { afterEach, describe, expect, it } from 'vitest'
import { setLocale } from '@/i18n/runtime'
import {
  buildOutboxDraftRequest,
  clearReservedOutboxPathsForTests,
  outboxRelativePath,
  outboxStamp
} from './desk-presets'

describe('desk-presets localization', () => {
  afterEach(() => {
    clearReservedOutboxPathsForTests()
  })

  it('builds Japanese draft prompts when locale is ja', () => {
    setLocale('ja')
    const request = buildOutboxDraftRequest(null, 'C:/ws', 'mail', 'ja')
    expect(request.text).toContain('下書き')
    expect(request.text).toContain('メール本文')
    expect(request.text).not.toContain('Create exactly one new outbox draft')
  })

  it('builds English draft prompts when locale is en', () => {
    setLocale('en')
    const request = buildOutboxDraftRequest(null, 'C:/ws', 'mail', 'en')
    expect(request.text).toContain('Create exactly one new outbox draft')
    expect(request.text).not.toContain('ちょうど1つだけ')
  })

  it('builds Edit-mode requests for all four presets with unique outbox paths', () => {
    setLocale('en')
    const presets = ['mail', 'minutes', 'report', 'chat'] as const
    const paths = new Set<string>()
    for (const preset of presets) {
      const request = buildOutboxDraftRequest(null, 'C:/ws', preset, 'en')
      expect(request.mode).toBe('edit')
      expect(request.text).toContain(`.compass/outbox/${preset}-`)
      expect(request.text).toMatch(/kind:\s*outbox|preset:\s*|status:\s*draft|createdAt/i)
      const match = request.text.match(/\.compass\/outbox\/[^\s`]+\.md/)
      expect(match).toBeTruthy()
      if (match) paths.add(match[0])
    }
    expect(paths.size).toBe(4)
  })
})

describe('outboxRelativePath uniqueness', () => {
  afterEach(() => {
    clearReservedOutboxPathsForTests()
  })

  it('uses second precision in the stamp', () => {
    const now = new Date(2026, 6, 28, 11, 17, 5)
    expect(outboxStamp(now)).toBe('20260728-111705')
    expect(outboxRelativePath('mail', [], now)).toBe('.compass/outbox/mail-20260728-111705.md')
  })

  it('suffixes -2, -3 when the same second is allocated again', () => {
    const now = new Date(2026, 6, 28, 11, 17, 5)
    expect(outboxRelativePath('mail', [], now)).toBe('.compass/outbox/mail-20260728-111705.md')
    expect(outboxRelativePath('mail', [], now)).toBe('.compass/outbox/mail-20260728-111705-2.md')
    expect(outboxRelativePath('mail', [], now)).toBe('.compass/outbox/mail-20260728-111705-3.md')
  })

  it('avoids basenames already on disk', () => {
    const now = new Date(2026, 6, 28, 11, 17, 5)
    const path = outboxRelativePath('mail', ['mail-20260728-111705.md'], now)
    expect(path).toBe('.compass/outbox/mail-20260728-111705-2.md')
  })

  it('keeps different presets independent for the same stamp', () => {
    const now = new Date(2026, 6, 28, 11, 17, 5)
    expect(outboxRelativePath('mail', [], now)).toBe('.compass/outbox/mail-20260728-111705.md')
    expect(outboxRelativePath('minutes', [], now)).toBe(
      '.compass/outbox/minutes-20260728-111705.md'
    )
  })
})
