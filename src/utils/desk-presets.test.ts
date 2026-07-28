import { describe, expect, it } from 'vitest'
import { setLocale } from '@/i18n/runtime'
import { buildDigestRequest, buildOutboxDraftRequest } from './desk-presets'

describe('desk-presets localization', () => {
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

  it('builds Japanese digest prompts when locale is ja', () => {
    setLocale('ja')
    const request = buildDigestRequest(
      '.compass/digests/2026-07-28.md',
      'ctx',
      '2026-07-21',
      '2026-07-28',
      'ja'
    )
    expect(request.text).toContain('ダイジェスト')
    expect(request.text).toContain('決定事項')
  })
})
