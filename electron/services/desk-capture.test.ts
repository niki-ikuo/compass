import { mkdir, readdir, readFile, writeFile } from 'fs/promises'
import { join, resolve } from 'path'
import { tmpdir } from 'os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { accessSync, rmSync } from 'fs'
import { parseDeskFrontmatter } from '../../src/utils/desk-frontmatter'

vi.mock('electron', () => ({
  clipboard: {
    readText: vi.fn(() => '')
  }
}))

import {
  captureClipboardToInbox,
  deleteInboxItem,
  markAllInboxDone,
  markInboxDone,
  uniqueInboxPath
} from './desk-capture'

function tempRoot(name: string): string {
  return join(
    tmpdir(),
    `compass-desk-inbox-${name}-${Date.now()}-${Math.random().toString(36).slice(2)}`
  )
}

describe('captureClipboardToInbox', () => {
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

  it('fails safely with no workspace', async () => {
    const result = await captureClipboardToInbox(null, 'hello')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('no_workspace')
  })

  it('does not create a file for empty clipboard text', async () => {
    const root = tempRoot('empty')
    roots.push(root)
    const result = await captureClipboardToInbox(root, '   \n\t  ')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('empty')
    await expect(readdir(join(root, '.compass', 'inbox'))).rejects.toThrow()
  })

  it('rejects oversized clipboard text', async () => {
    const root = tempRoot('large')
    roots.push(root)
    const huge = 'x'.repeat(512 * 1024 + 1)
    const result = await captureClipboardToInbox(root, huge)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('too_large')
  })

  it('writes an inbox markdown with frontmatter on success', async () => {
    const root = tempRoot('ok')
    roots.push(root)
    const result = await captureClipboardToInbox(root, 'hello from notepad')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.relativePath.startsWith('.compass/inbox/')).toBe(true)
    expect(result.relativePath.endsWith('.md')).toBe(true)
    const raw = await readFile(result.absolutePath, 'utf-8')
    const parsed = parseDeskFrontmatter(raw)
    expect(parsed.meta?.kind).toBe('inbox')
    if (parsed.meta?.kind === 'inbox') {
      expect(parsed.meta.source).toBe('clipboard')
      expect(parsed.meta.capturedAt).toBeTruthy()
    }
    expect(parsed.body.trim()).toBe('hello from notepad')
  })

  it('suffixes -2 when the stamp file already exists', async () => {
    const root = tempRoot('collision')
    roots.push(root)
    const inbox = join(root, '.compass', 'inbox')
    await mkdir(join(inbox, 'done'), { recursive: true })
    const stamp = '20260728-120000'
    await writeFile(join(inbox, `${stamp}.md`), 'existing\n', 'utf-8')
    const next = await uniqueInboxPath(inbox, stamp)
    expect(next).toBe(join(inbox, `${stamp}-2.md`))
    await writeFile(next, 'second\n', 'utf-8')
    const third = await uniqueInboxPath(inbox, stamp)
    expect(third).toBe(join(inbox, `${stamp}-3.md`))
  })
})

describe('markInboxDone path validation', () => {
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

  it('moves active inbox files into done/ and rejects unsafe paths', async () => {
    const root = tempRoot('done')
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
    const prefixSibling = join(root, '.compass', 'inbox_evil')
    await mkdir(prefixSibling, { recursive: true })
    const prefixAttack = join(prefixSibling, 'x.md')
    await writeFile(prefixAttack, 'evil\n', 'utf-8')
    const traversal = resolve(join(inbox, '..', 'outbox', 'leak.md'))
    await mkdir(join(root, '.compass', 'outbox'), { recursive: true })
    await writeFile(traversal, 'leak\n', 'utf-8')

    expect((await markInboxDone(root, outside)).ok).toBe(false)
    expect((await markInboxDone(root, doneFile)).ok).toBe(false)
    expect((await markInboxDone(root, prefixAttack)).ok).toBe(false)
    expect((await markInboxDone(root, traversal)).ok).toBe(false)

    const moved = await markInboxDone(root, active)
    expect(moved.ok).toBe(true)
    if (!moved.ok) return
    await expect(readFile(active, 'utf-8')).rejects.toThrow()
    accessSync(moved.absolutePath)
    expect(moved.absolutePath.replace(/\\/g, '/')).toContain('/done/')
  })

  it('suffixes destination when done/ already has the same basename', async () => {
    const root = tempRoot('done-collide')
    roots.push(root)
    const inbox = join(root, '.compass', 'inbox')
    const done = join(inbox, 'done')
    await mkdir(done, { recursive: true })
    await writeFile(join(done, 'same.md'), 'old\n', 'utf-8')
    const active = join(inbox, 'same.md')
    await writeFile(active, 'new\n', 'utf-8')

    const moved = await markInboxDone(root, active)
    expect(moved.ok).toBe(true)
    if (!moved.ok) return
    expect(moved.absolutePath.replace(/\\/g, '/').endsWith('/done/same-2.md')).toBe(true)
    expect(await readFile(join(done, 'same.md'), 'utf-8')).toBe('old\n')
    expect(await readFile(moved.absolutePath, 'utf-8')).toBe('new\n')
  })
})

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
