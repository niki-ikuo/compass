import { mkdir, writeFile } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { afterEach, describe, expect, it } from 'vitest'
import { rmSync } from 'fs'
import { serializeInboxDocument, serializeOutboxDocument } from '../../src/utils/desk-frontmatter'
import { listDeskInbox, listDeskOutbox } from './desk-list'

function tempRoot(name: string): string {
  return join(
    tmpdir(),
    `compass-desk-list-${name}-${Date.now()}-${Math.random().toString(36).slice(2)}`
  )
}

describe('desk-list', () => {
  const roots: string[] = []

  afterEach(() => {
    for (const root of roots) {
      try {
        rmSync(root, { recursive: true, force: true })
      } catch {
        // ignore
      }
    }
    roots.length = 0
  })

  it('lists active inbox only (excludes done/) with snippets', async () => {
    const root = tempRoot('inbox')
    roots.push(root)
    const inbox = join(root, '.compass', 'inbox')
    const done = join(inbox, 'done')
    await mkdir(done, { recursive: true })
    await writeFile(
      join(inbox, 'active.md'),
      serializeInboxDocument(
        { kind: 'inbox', capturedAt: '2026-07-28T00:00:00.000Z', source: 'clipboard' },
        'hello inbox body for snippet\n'
      ),
      'utf-8'
    )
    await writeFile(
      join(done, 'old.md'),
      serializeInboxDocument(
        { kind: 'inbox', capturedAt: '2026-07-27T00:00:00.000Z', source: 'clipboard' },
        'done item\n'
      ),
      'utf-8'
    )

    const items = await listDeskInbox(root, 20)
    expect(items).toHaveLength(1)
    expect(items[0].fileName).toBe('active.md')
    expect(items[0].snippet).toContain('hello inbox')
  })

  it('lists outbox drafts and hides archived by default', async () => {
    const root = tempRoot('outbox')
    roots.push(root)
    const outbox = join(root, '.compass', 'outbox')
    await mkdir(outbox, { recursive: true })
    await writeFile(
      join(outbox, 'mail-draft.md'),
      serializeOutboxDocument(
        {
          kind: 'outbox',
          preset: 'mail',
          status: 'draft',
          subject: 'Hi',
          createdAt: '2026-07-28T00:00:00.000Z'
        },
        'body\n'
      ),
      'utf-8'
    )
    await writeFile(
      join(outbox, 'mail-archived.md'),
      serializeOutboxDocument(
        {
          kind: 'outbox',
          preset: 'mail',
          status: 'archived',
          subject: 'Old',
          createdAt: '2026-07-27T00:00:00.000Z'
        },
        'old\n'
      ),
      'utf-8'
    )

    const items = await listDeskOutbox(root, 20)
    expect(items).toHaveLength(1)
    expect(items[0].fileName).toBe('mail-draft.md')
    expect(items[0].preset).toBe('mail')
    expect(items[0].status).toBe('draft')
    expect(items[0].subject).toBe('Hi')
  })
})
