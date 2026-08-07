import { readdir, readFile, rm, writeFile } from 'fs/promises'
import { join } from 'path'
import {
  parseDeskFrontmatter,
  serializeOutboxDocument,
  type OutboxDocMeta
} from '../../src/utils/desk-frontmatter'
import { ensureDeskDirs, outboxDir } from './desk-dirs'
import { isPathUnderDir } from './path-guard'
import { t } from '../../src/i18n/runtime'

export function isUnderOutbox(workspaceRoot: string, absolutePath: string): boolean {
  return isPathUnderDir(outboxDir(workspaceRoot), absolutePath)
}

export async function archiveOutboxItem(
  workspaceRoot: string,
  absolutePath: string
): Promise<{ ok: true; absolutePath: string } | { ok: false; message: string }> {
  try {
    await ensureDeskDirs(workspaceRoot)
    if (!isUnderOutbox(workspaceRoot, absolutePath)) {
      return { ok: false, message: t('desk.outbox.notOutbox') }
    }
    const raw = await readFile(absolutePath, 'utf-8')
    const { meta, body } = parseDeskFrontmatter(raw)
    const now = new Date().toISOString()
    const nextMeta: OutboxDocMeta =
      meta?.kind === 'outbox'
        ? { ...meta, status: 'archived', updatedAt: now }
        : {
            kind: 'outbox',
            preset: 'mail',
            status: 'archived',
            to: '',
            subject: '',
            createdAt: now,
            updatedAt: now
          }
    await writeFile(absolutePath, serializeOutboxDocument(nextMeta, body), 'utf-8')
    return { ok: true, absolutePath }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error)
    }
  }
}

/** Archive every non-archived outbox *.md (status → archived). */
export async function archiveAllOutboxItems(
  workspaceRoot: string
): Promise<{ ok: true; archived: number } | { ok: false; message: string }> {
  try {
    await ensureDeskDirs(workspaceRoot)
    const dir = outboxDir(workspaceRoot)
    let names: string[] = []
    try {
      const entries = await readdir(dir, { withFileTypes: true })
      names = entries
        .filter((e) => e.isFile() && e.name.toLowerCase().endsWith('.md'))
        .map((e) => e.name)
    } catch {
      names = []
    }
    let archived = 0
    for (const name of names) {
      const absolutePath = join(dir, name)
      const raw = await readFile(absolutePath, 'utf-8')
      const { meta } = parseDeskFrontmatter(raw)
      if (meta?.kind === 'outbox' && meta.status === 'archived') continue
      const result = await archiveOutboxItem(workspaceRoot, absolutePath)
      if (result.ok) archived += 1
    }
    return { ok: true, archived }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error)
    }
  }
}

/**
 * After a successful ship-copy: draft → ready.
 * Leaves archived alone. Returns the file contents written (or existing if unchanged).
 */
export async function markOutboxReadyAfterCopy(
  absolutePath: string
): Promise<{ content: string; changed: boolean }> {
  const raw = await readFile(absolutePath, 'utf-8')
  const { meta, body } = parseDeskFrontmatter(raw)
  if (meta?.kind !== 'outbox') {
    return { content: raw, changed: false }
  }
  if (meta.status === 'ready' || meta.status === 'archived') {
    return { content: raw, changed: false }
  }
  const nextMeta: OutboxDocMeta = {
    ...meta,
    status: 'ready',
    updatedAt: new Date().toISOString()
  }
  const content = serializeOutboxDocument(nextMeta, body)
  await writeFile(absolutePath, content, 'utf-8')
  return { content, changed: true }
}

export async function deleteOutboxItem(
  workspaceRoot: string,
  absolutePath: string
): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    await ensureDeskDirs(workspaceRoot)
    if (!isUnderOutbox(workspaceRoot, absolutePath)) {
      return { ok: false, message: t('desk.outbox.notOutbox') }
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
