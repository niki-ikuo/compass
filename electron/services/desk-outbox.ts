import { readFile, rm, writeFile } from 'fs/promises'
import { isAbsolute, relative, resolve, sep } from 'path'
import {
  parseDeskFrontmatter,
  serializeOutboxDocument,
  type OutboxDocMeta
} from '../../src/utils/desk-frontmatter'
import { digestsDir, ensureDeskDirs, outboxDir } from './desk-dirs'
import { t } from '../../src/i18n/runtime'

function isUnderDir(dir: string, absolutePath: string): boolean {
  const root = resolve(dir)
  const target = resolve(absolutePath)
  const rel = relative(root, target)
  if (!rel) return false
  if (isAbsolute(rel)) return false
  if (rel === '..' || rel.startsWith(`..${sep}`) || rel.startsWith('../')) return false
  // Windows: tolerate case / slash differences already normalized by resolve/relative
  return true
}

function isUnderOutbox(workspaceRoot: string, absolutePath: string): boolean {
  return isUnderDir(outboxDir(workspaceRoot), absolutePath)
}

function isUnderDigests(workspaceRoot: string, absolutePath: string): boolean {
  return isUnderDir(digestsDir(workspaceRoot), absolutePath)
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

export async function deleteDigestItem(
  workspaceRoot: string,
  absolutePath: string
): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    await ensureDeskDirs(workspaceRoot)
    if (!isUnderDigests(workspaceRoot, absolutePath)) {
      return { ok: false, message: t('desk.digest.notDigest') }
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
