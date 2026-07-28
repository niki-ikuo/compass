import { mkdir, readFile, writeFile } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { afterEach, describe, expect, it } from 'vitest'
import { rmSync } from 'fs'
import { serializeOutboxDocument, parseDeskFrontmatter } from '../../src/utils/desk-frontmatter'
import { archiveOutboxItem, archiveAllOutboxItems, deleteOutboxItem, markOutboxReadyAfterCopy } from './desk-outbox'

function tempRoot(name: string): string {
  return join(
    tmpdir(),
    `compass-desk-outbox-${name}-${Date.now()}-${Math.random().toString(36).slice(2)}`
  )
}

describe('desk-outbox', () => {
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

  it('archives by setting status and hides from default list semantics', async () => {
    const root = tempRoot('archive')
    roots.push(root)
    const outbox = join(root, '.compass', 'outbox')
    await mkdir(outbox, { recursive: true })
    const path = join(outbox, 'mail-test.md')
    await writeFile(
      path,
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

    const result = await archiveOutboxItem(root, path)
    expect(result.ok).toBe(true)
    const parsed = parseDeskFrontmatter(await readFile(path, 'utf-8'))
    expect(parsed.meta?.kind).toBe('outbox')
    if (parsed.meta?.kind === 'outbox') {
      expect(parsed.meta.status).toBe('archived')
    }
  })

  it('archives all non-archived outbox files', async () => {
    const root = tempRoot('archive-all')
    roots.push(root)
    const outbox = join(root, '.compass', 'outbox')
    await mkdir(outbox, { recursive: true })
    await writeFile(
      join(outbox, 'a.md'),
      serializeOutboxDocument(
        {
          kind: 'outbox',
          preset: 'mail',
          status: 'draft',
          subject: 'A',
          createdAt: '2026-07-28T00:00:00.000Z'
        },
        'a\n'
      ),
      'utf-8'
    )
    await writeFile(
      join(outbox, 'b.md'),
      serializeOutboxDocument(
        {
          kind: 'outbox',
          preset: 'chat',
          status: 'ready',
          createdAt: '2026-07-28T00:00:00.000Z'
        },
        'b\n'
      ),
      'utf-8'
    )
    await writeFile(
      join(outbox, 'c.md'),
      serializeOutboxDocument(
        {
          kind: 'outbox',
          preset: 'mail',
          status: 'archived',
          subject: 'C',
          createdAt: '2026-07-28T00:00:00.000Z'
        },
        'c\n'
      ),
      'utf-8'
    )

    const result = await archiveAllOutboxItems(root)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.archived).toBe(2)

    for (const name of ['a.md', 'b.md', 'c.md']) {
      const parsed = parseDeskFrontmatter(await readFile(join(outbox, name), 'utf-8'))
      expect(parsed.meta?.kind).toBe('outbox')
      if (parsed.meta?.kind === 'outbox') {
        expect(parsed.meta.status).toBe('archived')
      }
    }
  })

  it('marks draft outbox ready after copy without touching archived', async () => {
    const root = tempRoot('ready')
    roots.push(root)
    const outbox = join(root, '.compass', 'outbox')
    await mkdir(outbox, { recursive: true })
    const draftPath = join(outbox, 'mail-draft.md')
    await writeFile(
      draftPath,
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

    const marked = await markOutboxReadyAfterCopy(draftPath)
    expect(marked.changed).toBe(true)
    const draftParsed = parseDeskFrontmatter(marked.content)
    expect(draftParsed.meta?.kind).toBe('outbox')
    if (draftParsed.meta?.kind === 'outbox') {
      expect(draftParsed.meta.status).toBe('ready')
    }

    const archivedPath = join(outbox, 'mail-archived.md')
    await writeFile(
      archivedPath,
      serializeOutboxDocument(
        {
          kind: 'outbox',
          preset: 'mail',
          status: 'archived',
          subject: 'Old',
          createdAt: '2026-07-28T00:00:00.000Z'
        },
        'body\n'
      ),
      'utf-8'
    )
    const skipped = await markOutboxReadyAfterCopy(archivedPath)
    expect(skipped.changed).toBe(false)
    const archivedParsed = parseDeskFrontmatter(skipped.content)
    if (archivedParsed.meta?.kind === 'outbox') {
      expect(archivedParsed.meta.status).toBe('archived')
    }
  })

  it('deletes outbox files and rejects paths outside outbox', async () => {
    const root = tempRoot('delete')
    roots.push(root)
    const outbox = join(root, '.compass', 'outbox')
    await mkdir(outbox, { recursive: true })
    const path = join(outbox, 'mail-del.md')
    await writeFile(path, 'x\n', 'utf-8')

    const outside = join(root, 'notes.md')
    await writeFile(outside, 'keep\n', 'utf-8')
    const rejected = await deleteOutboxItem(root, outside)
    expect(rejected.ok).toBe(false)

    const deleted = await deleteOutboxItem(root, path)
    expect(deleted.ok).toBe(true)
    await expect(readFile(path, 'utf-8')).rejects.toThrow()
  })

})
