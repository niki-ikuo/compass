import { mkdir, readFile, writeFile } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { afterEach, describe, expect, it } from 'vitest'
import { accessSync, rmSync } from 'fs'
import { deleteInboxItem, markAllInboxDone } from './desk-capture'

function tempRoot(name: string): string {
  return join(
    tmpdir(),
    `compass-desk-inbox-${name}-${Date.now()}-${Math.random().toString(36).slice(2)}`
  )
}

describe('desk-capture inbox bulk', () => {
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

  it('deletes active inbox files and rejects done/ or outside paths', async () => {
    const root = tempRoot('delete')
    roots.push(root)
    const inbox = join(root, '.compass', 'inbox')
    const done = join(inbox, 'done')
    await mkdir(done, { recursive: true })
    const active = join(inbox, '20260728-120000.md')
    await writeFile(active, 'capture\n', 'utf-8')
    const doneFile = join(done, 'old.md')
    await writeFile(doneFile, 'done\n', 'utf-8')
    const outside = join(root, 'notes.md')
    await writeFile(outside, 'keep\n', 'utf-8')

    expect((await deleteInboxItem(root, outside)).ok).toBe(false)
    expect((await deleteInboxItem(root, doneFile)).ok).toBe(false)

    const deleted = await deleteInboxItem(root, active)
    expect(deleted.ok).toBe(true)
    await expect(readFile(active, 'utf-8')).rejects.toThrow()
    expect(await readFile(doneFile, 'utf-8')).toBe('done\n')
  })

  it('marks all active inbox files done', async () => {
    const root = tempRoot('all-done')
    roots.push(root)
    const inbox = join(root, '.compass', 'inbox')
    const done = join(inbox, 'done')
    await mkdir(done, { recursive: true })
    await writeFile(join(inbox, 'a.md'), 'a\n', 'utf-8')
    await writeFile(join(inbox, 'b.md'), 'b\n', 'utf-8')

    const result = await markAllInboxDone(root)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.moved).toBe(2)

    await expect(readFile(join(inbox, 'a.md'), 'utf-8')).rejects.toThrow()
    accessSync(join(done, 'a.md'))
    accessSync(join(done, 'b.md'))
  })
})
