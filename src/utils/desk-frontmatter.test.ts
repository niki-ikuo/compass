import { describe, expect, it } from 'vitest'
import {
  parseDeskFrontmatter,
  serializeInboxDocument,
  serializeOutboxDocument
} from './desk-frontmatter'
import { formatOutboxCopyPayload, runShipCheckStageA } from './desk-ship-check'

describe('desk-frontmatter', () => {
  it('round-trips inbox documents', () => {
    const raw = serializeInboxDocument(
      { kind: 'inbox', capturedAt: '2026-07-28T00:00:00.000Z', source: 'clipboard' },
      'hello world\n'
    )
    const parsed = parseDeskFrontmatter(raw)
    expect(parsed.meta).toEqual({
      kind: 'inbox',
      capturedAt: '2026-07-28T00:00:00.000Z',
      source: 'clipboard'
    })
    expect(parsed.body.trim()).toBe('hello world')
  })

  it('parses outbox mail meta', () => {
    const raw = serializeOutboxDocument(
      {
        kind: 'outbox',
        preset: 'mail',
        status: 'draft',
        to: 'a@example.com',
        subject: 'Hello',
        createdAt: '2026-07-28T00:00:00.000Z'
      },
      'Body text\n'
    )
    const parsed = parseDeskFrontmatter(raw)
    expect(parsed.meta?.kind).toBe('outbox')
    if (parsed.meta?.kind === 'outbox') {
      expect(parsed.meta.subject).toBe('Hello')
      expect(parsed.meta.to).toBe('a@example.com')
    }
  })

  it('tolerates missing frontmatter', () => {
    const parsed = parseDeskFrontmatter('just text')
    expect(parsed.meta).toBeNull()
    expect(parsed.body).toBe('just text')
  })
})

describe('desk-ship-check', () => {
  it('flags TBD and empty subject for mail', () => {
    const raw = `---
kind: outbox
preset: mail
status: draft
to: ""
subject: ""
createdAt: 2026-07-28T00:00:00.000Z
---

Please fix TBD before send.
`
    const result = runShipCheckStageA(raw)
    const ids = result.findings.map((f) => f.id)
    expect(ids).toContain('tbd_markers')
    expect(ids).toContain('mail_missing_subject')
    expect(ids).not.toContain('status_not_ready')
    const tbd = result.findings.find((f) => f.id === 'tbd_markers')
    expect(tbd?.messageKey).toBe('desk.ship.finding.tbd')
    expect(tbd?.messageParams?.token).toBe('TBD')
  })

  it('does not warn only because status is still draft', () => {
    const raw = `---
kind: outbox
preset: chat
status: draft
createdAt: 2026-07-28T00:00:00.000Z
---

Short post ready to paste.
`
    const result = runShipCheckStageA(raw)
    expect(result.findings.map((f) => f.id)).not.toContain('status_not_ready')
    expect(result.findings.filter((f) => f.severity === 'error')).toHaveLength(0)
  })

  it('flags secret-like tokens as errors', () => {
    const raw = `---
kind: outbox
preset: chat
status: ready
createdAt: 2026-07-28T00:00:00.000Z
---

Bearer sk-abcdefghijklmnopqrstuvwxyz123456
`
    const result = runShipCheckStageA(raw)
    expect(result.findings.some((f) => f.id === 'secret_pattern')).toBe(true)
  })

  it('formats mail copy payload without frontmatter', () => {
    const raw = serializeOutboxDocument(
      {
        kind: 'outbox',
        preset: 'mail',
        status: 'ready',
        to: 'a@example.com',
        subject: 'Hi',
        createdAt: '2026-07-28T00:00:00.000Z'
      },
      'Hello there\n'
    )
    const payload = formatOutboxCopyPayload(raw)
    expect(payload).toContain('To: a@example.com')
    expect(payload).toContain('Subject: Hi')
    expect(payload).toContain('Hello there')
    expect(payload).not.toContain('kind: outbox')
  })
})
