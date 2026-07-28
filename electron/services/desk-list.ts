import { readdir, readFile, stat } from 'fs/promises'
import { join } from 'path'
import { parseDeskFrontmatter, type OutboxPreset, type OutboxStatus } from '../../src/utils/desk-frontmatter'
import { ensureDeskDirs, inboxDir, outboxDir } from './desk-dirs'

export type DeskInboxItem = {
  absolutePath: string
  relativePath: string
  fileName: string
  capturedAt: string
  snippet: string
  mtimeMs: number
}

export type DeskOutboxItem = {
  absolutePath: string
  relativePath: string
  fileName: string
  preset: OutboxPreset
  status: OutboxStatus
  subject: string
  sourcePath: string
  snippet: string
  mtimeMs: number
}

function toRelative(workspaceRoot: string, absolutePath: string): string {
  return absolutePath
    .slice(workspaceRoot.length)
    .replace(/^[/\\]/, '')
    .replace(/\\/g, '/')
}

function snippetFrom(body: string, max = 40): string {
  const one = body.replace(/\s+/g, ' ').trim()
  if (one.length <= max) return one
  return `${one.slice(0, max)}…`
}

async function listMarkdownFiles(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true })
    return entries
      .filter((e) => e.isFile() && e.name.toLowerCase().endsWith('.md'))
      .map((e) => join(dir, e.name))
  } catch {
    return []
  }
}

export async function listDeskInbox(
  workspaceRoot: string,
  limit = 20
): Promise<DeskInboxItem[]> {
  await ensureDeskDirs(workspaceRoot)
  const files = await listMarkdownFiles(inboxDir(workspaceRoot))
  const items: DeskInboxItem[] = []
  for (const absolutePath of files) {
    try {
      const raw = await readFile(absolutePath, 'utf-8')
      const st = await stat(absolutePath)
      const { meta, body } = parseDeskFrontmatter(raw)
      const fileName = absolutePath.split(/[/\\]/).pop() || ''
      items.push({
        absolutePath,
        relativePath: toRelative(workspaceRoot, absolutePath),
        fileName,
        capturedAt:
          meta?.kind === 'inbox' && meta.capturedAt ? meta.capturedAt : new Date(st.mtimeMs).toISOString(),
        snippet: snippetFrom(body),
        mtimeMs: st.mtimeMs
      })
    } catch {
      // skip unreadable
    }
  }
  items.sort((a, b) => b.mtimeMs - a.mtimeMs)
  return items.slice(0, limit)
}

export async function listDeskOutbox(
  workspaceRoot: string,
  limit = 20,
  includeArchived = false
): Promise<DeskOutboxItem[]> {
  await ensureDeskDirs(workspaceRoot)
  const files = await listMarkdownFiles(outboxDir(workspaceRoot))
  const items: DeskOutboxItem[] = []
  for (const absolutePath of files) {
    try {
      const raw = await readFile(absolutePath, 'utf-8')
      const st = await stat(absolutePath)
      const { meta, body } = parseDeskFrontmatter(raw)
      const status = meta?.kind === 'outbox' ? meta.status : 'draft'
      if (!includeArchived && status === 'archived') continue
      const fileName = absolutePath.split(/[/\\]/).pop() || ''
      items.push({
        absolutePath,
        relativePath: toRelative(workspaceRoot, absolutePath),
        fileName,
        preset: meta?.kind === 'outbox' ? meta.preset : 'mail',
        status,
        subject: meta?.kind === 'outbox' ? meta.subject ?? '' : '',
        sourcePath: meta?.kind === 'outbox' ? meta.sourcePath?.trim() ?? '' : '',
        snippet: snippetFrom(body),
        mtimeMs: st.mtimeMs
      })
    } catch {
      // skip
    }
  }
  items.sort((a, b) => b.mtimeMs - a.mtimeMs)
  return items.slice(0, limit)
}
