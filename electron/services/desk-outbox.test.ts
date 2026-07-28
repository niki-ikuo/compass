import { mkdir, readFile, writeFile } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { afterEach, describe, expect, it } from 'vitest'
import { rmSync } from 'fs'
import { serializeOutboxDocument, parseDeskFrontmatter } from '../../src/utils/desk-frontmatter'
import { archiveOutboxItem, deleteDigestItem, deleteOutboxItem } from './desk-outbox'

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

  it('deletes digest files and rejects paths outside digests', async () => {
    const root = tempRoot('digest-del')
    roots.push(root)
    const digests = join(root, '.compass', 'digests')
    await mkdir(digests, { recursive: true })
    const path = join(digests, '2026-07-28.md')
    await writeFile(path, 'digest\n', 'utf-8')

    const outside = join(root, '.compass', 'outbox', 'mail.md')
    await mkdir(join(root, '.compass', 'outbox'), { recursive: true })
    await writeFile(outside, 'keep\n', 'utf-8')
    expect((await deleteDigestItem(root, outside)).ok).toBe(false)

    const deleted = await deleteDigestItem(root, path)
    expect(deleted.ok).toBe(true)
    await expect(readFile(path, 'utf-8')).rejects.toThrow()
  })

  it('accepts digest paths with forward slashes', async () => {
    const root = tempRoot('digest-slash')
    roots.push(root)
    const digests = join(root, '.compass', 'digests')
    await mkdir(digests, { recursive: true })
    const path = join(digests, '2026-07-28.md')
    await writeFile(path, 'digest\n', 'utf-8')
    const slashPath = path.replace(/\\/g, '/')
    const deleted = await deleteDigestItem(root, slashPath)
    expect(deleted.ok).toBe(true)
  })
})
