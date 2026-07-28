import { access, readdir, rename, rm, writeFile } from 'fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'path'
import { clipboard } from 'electron'
import { serializeInboxDocument } from '../../src/utils/desk-frontmatter'
import { ensureDeskDirs, inboxDir } from './desk-dirs'
import { t } from '../../src/i18n/runtime'

const MAX_CAPTURE_CHARS = 512 * 1024

export type DeskCaptureResult =
  | {
      ok: true
      absolutePath: string
      relativePath: string
    }
  | {
      ok: false
      reason: 'no_workspace' | 'empty' | 'too_large' | 'write_failed'
      message: string
    }

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

function captureStamp(d = new Date()): string {
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
}

async function uniqueInboxPath(dir: string, stamp: string): Promise<string> {
  let candidate = join(dir, `${stamp}.md`)
  let i = 2
  for (;;) {
    try {
      await access(candidate)
      candidate = join(dir, `${stamp}-${i}.md`)
      i += 1
    } catch {
      return candidate
    }
  }
}

export async function captureClipboardToInbox(
  workspaceRoot: string | null,
  textFromCaller?: string
): Promise<DeskCaptureResult> {
  if (!workspaceRoot) {
    return {
      ok: false,
      reason: 'no_workspace',
      message: t('desk.capture.noWorkspace')
    }
  }

  const text = (textFromCaller ?? clipboard.readText() ?? '').replace(/\r\n/g, '\n')
  if (!text.trim()) {
    return {
      ok: false,
      reason: 'empty',
      message: t('desk.capture.empty')
    }
  }
  if (text.length > MAX_CAPTURE_CHARS) {
    return {
      ok: false,
      reason: 'too_large',
      message: t('desk.capture.tooLarge')
    }
  }

  try {
    await ensureDeskDirs(workspaceRoot)
    const dir = inboxDir(workspaceRoot)
    const absolutePath = await uniqueInboxPath(dir, captureStamp())
    const capturedAt = new Date().toISOString()
    const content = serializeInboxDocument(
      { kind: 'inbox', capturedAt, source: 'clipboard' },
      text.endsWith('\n') ? text : `${text}\n`
    )
    await writeFile(absolutePath, content, 'utf-8')
    const relativePath = absolutePath
      .slice(workspaceRoot.length)
      .replace(/^[/\\]/, '')
      .replace(/\\/g, '/')
    return { ok: true, absolutePath, relativePath }
  } catch (error) {
    return {
      ok: false,
      reason: 'write_failed',
      message: error instanceof Error ? error.message : String(error)
    }
  }
}

export async function markInboxDone(
  workspaceRoot: string,
  absolutePath: string
): Promise<{ ok: true; absolutePath: string } | { ok: false; message: string }> {
  try {
    await ensureDeskDirs(workspaceRoot)
    const normalized = absolutePath.replace(/\\/g, '/')
    const inboxPrefix = inboxDir(workspaceRoot).replace(/\\/g, '/')
    if (!normalized.startsWith(inboxPrefix) || normalized.includes('/done/')) {
      return { ok: false, message: t('desk.inbox.notInbox') }
    }
    const base = absolutePath.split(/[/\\]/).pop() || 'item.md'
    const doneDir = join(workspaceRoot, '.compass', 'inbox', 'done')
    let dest = join(doneDir, base)
    let i = 2
    for (;;) {
      try {
        await access(dest)
        const dot = base.lastIndexOf('.')
        const stem = dot > 0 ? base.slice(0, dot) : base
        const ext = dot > 0 ? base.slice(dot) : ''
        dest = join(doneDir, `${stem}-${i}${ext}`)
        i += 1
      } catch {
        break
      }
    }
    await rename(absolutePath, dest)
    return { ok: true, absolutePath: dest }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error)
    }
  }
}

/** Move every active inbox *.md into done/ (not files already under done/). */
export async function markAllInboxDone(
  workspaceRoot: string
): Promise<{ ok: true; moved: number } | { ok: false; message: string }> {
  try {
    await ensureDeskDirs(workspaceRoot)
    const dir = inboxDir(workspaceRoot)
    let names: string[] = []
    try {
      const entries = await readdir(dir, { withFileTypes: true })
      names = entries
        .filter((e) => e.isFile() && e.name.toLowerCase().endsWith('.md'))
        .map((e) => e.name)
    } catch {
      names = []
    }
    let moved = 0
    for (const name of names) {
      const absolutePath = join(dir, name)
      const result = await markInboxDone(workspaceRoot, absolutePath)
      if (result.ok) moved += 1
    }
    return { ok: true, moved }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error)
    }
  }
}

function isUnderInboxActive(workspaceRoot: string, absolutePath: string): boolean {
  const root = resolve(inboxDir(workspaceRoot))
  const target = resolve(absolutePath)
  const rel = relative(root, target)
  if (!rel || isAbsolute(rel)) return false
  if (rel === '..' || rel.startsWith(`..${sep}`) || rel.startsWith('../')) return false
  // Reject done/ and any nested path under done
  const norm = rel.replace(/\\/g, '/')
  if (norm === 'done' || norm.startsWith('done/')) return false
  // Only direct children of inbox (no nested folders beyond a single file)
  if (norm.includes('/')) return false
  return true
}

/** Permanently delete an active inbox capture (not done/). */
export async function deleteInboxItem(
  workspaceRoot: string,
  absolutePath: string
): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    await ensureDeskDirs(workspaceRoot)
    if (!isUnderInboxActive(workspaceRoot, absolutePath)) {
      return { ok: false, message: t('desk.inbox.notInbox') }
    }
    await rm(absolutePath, { force: true })
    return { ok: true }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error)
    }
  }
}
