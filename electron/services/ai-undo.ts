import { existsSync } from 'fs'
import { mkdir, readdir, readFile, rm, stat, writeFile, cp } from 'fs/promises'
import { dirname, join } from 'path'
import type {
  ApplyWorkspaceOptions,
  WorkspaceAction,
  WorkspaceActionResult,
  WorkspaceChangeEntry,
  WorkspaceChangeSet,
  UndoAiApplyResult
} from '../../src/types'
import { t } from '../../src/i18n/runtime'
import { normalizeWorkspaceActionPath } from '../../src/utils/workspace-actions'
import {
  applyWorkspaceActions,
  deletePath,
  fileExists,
  materializeWorkspaceActions,
  readFileContent,
  resolveInsideWorkspace
} from './filesystem'

function normalizeActionPath(workspaceRoot: string, actionPath: string): string {
  return normalizeWorkspaceActionPath(workspaceRoot, actionPath, {
    pathExists: (absolutePath) => existsSync(absolutePath)
  })
}

const INDEX_VERSION = 1
const MAX_CHANGE_SETS = 20
const MAX_DELETE_DIR_BYTES = 50 * 1024 * 1024
const MAX_DELETE_DIR_FILES = 5_000

type AiUndoIndex = {
  version: typeof INDEX_VERSION
  changeSets: WorkspaceChangeSet[]
}

function undoRoot(workspaceRoot: string): string {
  return join(workspaceRoot, '.compass', 'ai-undo')
}

function indexPath(workspaceRoot: string): string {
  return join(undoRoot(workspaceRoot), 'index.json')
}

function backupsRoot(workspaceRoot: string): string {
  return join(undoRoot(workspaceRoot), 'backups')
}

function changeSetBackupDir(workspaceRoot: string, changeSetId: string): string {
  return join(backupsRoot(workspaceRoot), changeSetId)
}

function createChangeSetId(): string {
  return `cs_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}

function toPosixRelative(path: string): string {
  return path.replace(/\\/g, '/')
}

async function loadIndex(workspaceRoot: string): Promise<AiUndoIndex> {
  try {
    const raw = await readFile(indexPath(workspaceRoot), 'utf-8')
    const parsed = JSON.parse(raw) as AiUndoIndex
    if (!parsed || parsed.version !== INDEX_VERSION || !Array.isArray(parsed.changeSets)) {
      return { version: INDEX_VERSION, changeSets: [] }
    }
    return parsed
  } catch {
    return { version: INDEX_VERSION, changeSets: [] }
  }
}

async function saveIndex(workspaceRoot: string, index: AiUndoIndex): Promise<void> {
  const root = undoRoot(workspaceRoot)
  await mkdir(root, { recursive: true })
  await writeFile(indexPath(workspaceRoot), JSON.stringify(index, null, 2), 'utf-8')
}

async function removeBackupDir(workspaceRoot: string, changeSetId: string): Promise<void> {
  const dir = changeSetBackupDir(workspaceRoot, changeSetId)
  await rm(dir, { recursive: true, force: true })
}

async function pruneChangeSets(workspaceRoot: string, index: AiUndoIndex): Promise<AiUndoIndex> {
  if (index.changeSets.length <= MAX_CHANGE_SETS) return index
  const overflow = index.changeSets.length - MAX_CHANGE_SETS
  const removed = index.changeSets.slice(0, overflow)
  for (const set of removed) {
    await removeBackupDir(workspaceRoot, set.id)
  }
  return {
    version: INDEX_VERSION,
    changeSets: index.changeSets.slice(overflow)
  }
}

async function measureDirectory(
  dirPath: string
): Promise<{ bytes: number; files: number }> {
  let bytes = 0
  let files = 0
  const stack = [dirPath]

  while (stack.length > 0) {
    const current = stack.pop()!
    const entries = await readdir(current, { withFileTypes: true })
    for (const entry of entries) {
      const full = join(current, entry.name)
      if (entry.isDirectory()) {
        stack.push(full)
        continue
      }
      if (entry.isFile()) {
        files += 1
        if (files > MAX_DELETE_DIR_FILES) {
          return { bytes, files }
        }
        const info = await stat(full)
        bytes += info.size
        if (bytes > MAX_DELETE_DIR_BYTES) {
          return { bytes, files }
        }
      }
    }
  }

  return { bytes, files }
}

async function isDirectoryEmpty(dirPath: string): Promise<boolean> {
  try {
    const entries = await readdir(dirPath)
    return entries.length === 0
  } catch {
    return false
  }
}

/** Empty after accounting for wasNew files / new mkdirs that this undo will remove first. */
async function isDirectoryEmptyAfterUndo(
  dirPath: string,
  relativeDir: string,
  changeSet: WorkspaceChangeSet
): Promise<boolean> {
  const removableFiles = new Set(
    changeSet.entries
      .filter(
        (entry): entry is Extract<WorkspaceChangeEntry, { type: 'writeFile' }> =>
          entry.type === 'writeFile' && entry.wasNew
      )
      .map((entry) => toPosixRelative(entry.relativePath))
  )
  const removableDirs = new Set(
    changeSet.entries
      .filter(
        (entry): entry is Extract<WorkspaceChangeEntry, { type: 'mkdir' }> =>
          entry.type === 'mkdir' && !entry.alreadyExisted
      )
      .map((entry) => toPosixRelative(entry.relativePath))
  )

  async function walk(abs: string, rel: string): Promise<boolean> {
    let entries
    try {
      entries = await readdir(abs, { withFileTypes: true })
    } catch {
      return false
    }
    for (const entry of entries) {
      const childRel = toPosixRelative(`${rel}/${entry.name}`)
      const childAbs = join(abs, entry.name)
      if (entry.isDirectory()) {
        if (!removableDirs.has(childRel)) return false
        if (!(await walk(childAbs, childRel))) return false
        continue
      }
      if (entry.isFile() && !removableFiles.has(childRel)) return false
    }
    return true
  }

  return walk(dirPath, toPosixRelative(relativeDir))
}

/**
 * Capture before-state and back up deletes for a materialized action list.
 * Must run before disk mutations.
 */
export async function buildChangeSetEntries(
  workspaceRoot: string,
  changeSetId: string,
  actions: WorkspaceAction[]
): Promise<WorkspaceChangeEntry[]> {
  const entries: WorkspaceChangeEntry[] = []
  const backupBase = changeSetBackupDir(workspaceRoot, changeSetId)

  for (const action of actions) {
    const relativePath = toPosixRelative(action.path)

    if (action.type === 'mkdir') {
      const dirPath = resolveInsideWorkspace(workspaceRoot, relativePath)
      entries.push({
        type: 'mkdir',
        relativePath,
        alreadyExisted: await fileExists(dirPath)
      })
      continue
    }

    if (action.type === 'writeFile') {
      const filePath = resolveInsideWorkspace(workspaceRoot, relativePath)
      const exists = await fileExists(filePath)
      let before: string | null = null
      if (exists) {
        const info = await stat(filePath)
        if (!info.isFile()) {
          throw new Error(t('fs.notAFile', { path: relativePath }))
        }
        before = (await readFileContent(filePath)).content
      }
      entries.push({
        type: 'writeFile',
        relativePath,
        before,
        after: action.content,
        wasNew: !exists
      })
      continue
    }

    if (action.type === 'deleteFile') {
      const filePath = resolveInsideWorkspace(workspaceRoot, relativePath)
      if (!(await fileExists(filePath))) {
        // Apply is a no-op for missing deletes — nothing to undo.
        continue
      }
      const info = await stat(filePath)
      if (!info.isFile()) {
        throw new Error(t('fs.notAFile', { path: relativePath }))
      }
      const before = (await readFileContent(filePath)).content
      const backupRef = `files/${relativePath}`
      const backupPath = join(backupBase, ...backupRef.split('/'))
      await mkdir(dirname(backupPath), { recursive: true })
      await writeFile(backupPath, before, 'utf-8')
      entries.push({
        type: 'deleteFile',
        relativePath,
        before,
        backupRef
      })
      continue
    }

    if (action.type === 'deleteDir') {
      const dirPath = resolveInsideWorkspace(workspaceRoot, relativePath)
      if (!(await fileExists(dirPath))) {
        continue
      }
      const info = await stat(dirPath)
      if (!info.isDirectory()) {
        throw new Error(t('fs.notAFolder', { path: relativePath }))
      }

      const measure = await measureDirectory(dirPath)
      if (measure.files > MAX_DELETE_DIR_FILES || measure.bytes > MAX_DELETE_DIR_BYTES) {
        throw new Error(
          t('fs.undoDeleteDirTooLarge', {
            path: relativePath,
            maxMb: String(Math.round(MAX_DELETE_DIR_BYTES / (1024 * 1024)))
          })
        )
      }

      const backupRef = `tree/${relativePath}`
      const backupPath = join(backupBase, ...backupRef.split('/'))
      await mkdir(dirname(backupPath), { recursive: true })
      try {
        await cp(dirPath, backupPath, { recursive: true })
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        throw new Error(t('fs.undoBackupFailed', { path: relativePath, reason: message }))
      }
      entries.push({
        type: 'deleteDir',
        relativePath,
        backupRef
      })
    }
  }

  return entries
}

export async function persistChangeSet(
  workspaceRoot: string,
  changeSet: WorkspaceChangeSet
): Promise<void> {
  let index = await loadIndex(workspaceRoot)
  index.changeSets.push(changeSet)
  index = await pruneChangeSets(workspaceRoot, index)
  await saveIndex(workspaceRoot, index)
}

/** Allocate an id before backups so paths are known. */
export function allocateChangeSetId(): string {
  return createChangeSetId()
}

export function createChangeSetWithId(input: {
  id: string
  workspaceRoot: string
  chatId: string
  source: 'preview-all' | 'preview-file'
  entries: WorkspaceChangeEntry[]
}): WorkspaceChangeSet {
  return {
    id: input.id,
    chatId: input.chatId,
    createdAt: Date.now(),
    source: input.source,
    workspaceRoot: input.workspaceRoot,
    entries: input.entries,
    status: 'applied'
  }
}

async function assertWriteNotStale(
  filePath: string,
  expectedAfter: string,
  relativePath: string
): Promise<void> {
  if (!(await fileExists(filePath))) {
    throw new Error(t('fs.undoStale', { path: relativePath }))
  }
  const current = (await readFileContent(filePath)).content
  if (current !== expectedAfter) {
    throw new Error(t('fs.undoStale', { path: relativePath }))
  }
}

/**
 * Undo the newest applied Change Set (LIFO). All-or-nothing: validates first, then mutates.
 */
export async function undoLastChangeSet(workspaceRoot: string): Promise<UndoAiApplyResult> {
  const index = await loadIndex(workspaceRoot)
  let targetIndex = -1
  for (let i = index.changeSets.length - 1; i >= 0; i -= 1) {
    if (index.changeSets[i].status === 'applied') {
      targetIndex = i
      break
    }
  }
  if (targetIndex < 0) {
    throw new Error(t('fs.undoNothing'))
  }

  const changeSet = index.changeSets[targetIndex]
  const reverseEntries = [...changeSet.entries].reverse()

  // Validate all entries before mutating.
  for (const entry of reverseEntries) {
    const absolute = resolveInsideWorkspace(workspaceRoot, entry.relativePath)

    if (entry.type === 'writeFile') {
      await assertWriteNotStale(absolute, entry.after, entry.relativePath)
      continue
    }

    if (entry.type === 'mkdir') {
      if (entry.alreadyExisted) continue
      if (!(await fileExists(absolute))) {
        throw new Error(t('fs.undoStale', { path: entry.relativePath }))
      }
      const info = await stat(absolute)
      if (!info.isDirectory()) {
        throw new Error(t('fs.undoStale', { path: entry.relativePath }))
      }
      if (!(await isDirectoryEmptyAfterUndo(absolute, entry.relativePath, changeSet))) {
        throw new Error(t('fs.undoStale', { path: entry.relativePath }))
      }
      continue
    }

    if (entry.type === 'deleteFile') {
      if (await fileExists(absolute)) {
        throw new Error(t('fs.undoStale', { path: entry.relativePath }))
      }
      continue
    }

    if (entry.type === 'deleteDir') {
      if (await fileExists(absolute)) {
        throw new Error(t('fs.undoStale', { path: entry.relativePath }))
      }
      const backupPath = join(
        changeSetBackupDir(workspaceRoot, changeSet.id),
        ...entry.backupRef.split('/')
      )
      if (!(await fileExists(backupPath))) {
        throw new Error(t('fs.undoBackupMissing', { path: entry.relativePath }))
      }
    }
  }

  // Apply reverse mutations.
  for (const entry of reverseEntries) {
    const absolute = resolveInsideWorkspace(workspaceRoot, entry.relativePath)

    if (entry.type === 'writeFile') {
      if (entry.wasNew) {
        await deletePath(absolute)
      } else {
        await mkdir(dirname(absolute), { recursive: true })
        await writeFile(absolute, entry.before ?? '', 'utf-8')
      }
      continue
    }

    if (entry.type === 'mkdir') {
      if (!entry.alreadyExisted) {
        if (!(await isDirectoryEmpty(absolute))) {
          throw new Error(t('fs.undoStale', { path: entry.relativePath }))
        }
        await rm(absolute, { recursive: true, force: true })
      }
      continue
    }

    if (entry.type === 'deleteFile') {
      await mkdir(dirname(absolute), { recursive: true })
      const content =
        entry.backupRef != null
          ? await readFile(
              join(changeSetBackupDir(workspaceRoot, changeSet.id), ...entry.backupRef.split('/')),
              'utf-8'
            )
          : entry.before
      await writeFile(absolute, content, 'utf-8')
      continue
    }

    if (entry.type === 'deleteDir') {
      const backupPath = join(
        changeSetBackupDir(workspaceRoot, changeSet.id),
        ...entry.backupRef.split('/')
      )
      await mkdir(dirname(absolute), { recursive: true })
      await cp(backupPath, absolute, { recursive: true })
    }
  }

  const updated: WorkspaceChangeSet = { ...changeSet, status: 'undone' }
  index.changeSets[targetIndex] = updated
  await saveIndex(workspaceRoot, index)
  await removeBackupDir(workspaceRoot, changeSet.id)

  return { changeSet: updated }
}

/** Test helper: peek newest applied change set without mutating. */
export async function peekLastAppliedChangeSet(
  workspaceRoot: string
): Promise<WorkspaceChangeSet | null> {
  const index = await loadIndex(workspaceRoot)
  for (let i = index.changeSets.length - 1; i >= 0; i -= 1) {
    if (index.changeSets[i].status === 'applied') return index.changeSets[i]
  }
  return null
}

/**
 * Apply workspace actions and record a Change Set when `options.undo` is set.
 * Without undo meta, delegates to plain apply (no Change Set).
 */
export async function applyWorkspaceActionsRecordingUndo(
  workspaceRoot: string,
  actions: WorkspaceAction[],
  options?: ApplyWorkspaceOptions
): Promise<WorkspaceActionResult> {
  if (!options?.undo) {
    return applyWorkspaceActions(workspaceRoot, actions)
  }

  const materialized = await materializeWorkspaceActions(workspaceRoot, actions)
  const normalized = materialized.map((action) =>
    'path' in action
      ? { ...action, path: normalizeActionPath(workspaceRoot, action.path) }
      : action
  )
  const changeSetId = allocateChangeSetId()
  let entries: WorkspaceChangeEntry[] = []
  try {
    entries = await buildChangeSetEntries(workspaceRoot, changeSetId, normalized)
    const result = await applyWorkspaceActions(workspaceRoot, actions)
    if (entries.length === 0) {
      await removeBackupDir(workspaceRoot, changeSetId)
      return result
    }
    const changeSet = createChangeSetWithId({
      id: changeSetId,
      workspaceRoot,
      chatId: options.undo.chatId,
      source: options.undo.source,
      entries
    })
    await persistChangeSet(workspaceRoot, changeSet)
    return { ...result, changeSet }
  } catch (error) {
    await removeBackupDir(workspaceRoot, changeSetId)
    throw error
  }
}
