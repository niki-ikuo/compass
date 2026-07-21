import { mkdir, readdir, readFile, rename, rm, stat, writeFile, copyFile } from 'fs/promises'
import type { Dirent } from 'fs'
import { resolve, relative, dirname, join, basename, isAbsolute } from 'path'
import type {
  FileEncoding,
  FileTreeNode,
  WorkspaceAction,
  WorkspaceActionResult,
  ChatContextRef,
  ResolvedChatContext,
  ResolvedContextFile,
  ResolvedFolderContext,
  ActionPreviewItem,
  DecodedFileContent
} from '../../src/types'
import { t } from '../../src/i18n/runtime'
import { normalizeWorkspaceActionPath } from '../../src/utils/workspace-actions'
import { buildUniqueFileName } from '../../src/utils/unique-file-name'
import { ApplyPatchError, applyUnifiedDiff } from '../../src/utils/apply-patch'
import { decodeFileBuffer, encodeContent } from './encoding'
import { getImageMimeType, isImagePath, isPdfPath } from '../../src/utils/media-context'
import { extractPdfText } from '../../src/utils/pdf-text'
import { shouldSkipWorkspaceEntry } from './fs-ignore'

const PATHED_ACTION_TYPES = new Set([
  'mkdir',
  'writeFile',
  'applyPatch',
  'deleteFile',
  'deleteDir'
])

function isPathedAction(
  action: WorkspaceAction
): action is WorkspaceAction & { path: string } {
  return PATHED_ACTION_TYPES.has(action.type)
}

/**
 * Resolve applyPatch → writeFile using current disk contents so preview/apply
 * use the exact bytes the user approved.
 */
export async function materializeWorkspaceActions(
  workspaceRoot: string,
  actions: WorkspaceAction[]
): Promise<WorkspaceAction[]> {
  const out: WorkspaceAction[] = []

  for (const action of actions) {
    if (action.type !== 'applyPatch') {
      out.push(action)
      continue
    }

    const relativePath = normalizeWorkspaceActionPath(workspaceRoot, action.path)
    if (!relativePath) {
      throw new ApplyPatchError(t('fs.patchEmptyPath'))
    }
    if (typeof action.patch !== 'string' || !action.patch.trim()) {
      throw new ApplyPatchError(t('fs.patchEmpty', { path: relativePath }))
    }

    const filePath = resolveInsideWorkspace(workspaceRoot, relativePath)
    const exists = await fileExists(filePath)
    let oldContent = ''
    if (exists) {
      const info = await stat(filePath)
      if (!info.isFile()) {
        throw new Error(t('fs.notAFile', { path: relativePath }))
      }
      oldContent = (await readFileContent(filePath)).content
    }

    try {
      const newContent = applyUnifiedDiff(oldContent, action.patch)
      out.push({ type: 'writeFile', path: relativePath, content: newContent })
    } catch (err) {
      if (err instanceof ApplyPatchError) {
        throw new ApplyPatchError(t('fs.patchFailed', { path: relativePath, reason: err.message }))
      }
      throw err
    }
  }

  return out
}

const IGNORED_DIRS = new Set(['node_modules', '.git', 'dist', 'out', 'release', '.next', '.compass'])
const MAX_FILE_BYTES = 32 * 1024
const MAX_FOLDER_FILES = 25
/** Vision 向け画像の上限（バイト） */
const MAX_IMAGE_BYTES = 4 * 1024 * 1024
const MAX_IMAGES_PER_REQUEST = 6
const MAX_PDF_TEXT_CHARS = 48_000

export type ReadDirOptions = {
  /** ディレクトリが無いとき例外ではなく空配列を返す（任意フォルダの読み取り用） */
  missingOk?: boolean
}

export async function readDirectory(
  dirPath: string,
  options?: ReadDirOptions
): Promise<FileTreeNode[]> {
  let entries
  try {
    entries = await readdir(dirPath, { withFileTypes: true })
  } catch (err) {
    if (options?.missingOk && (err as NodeJS.ErrnoException).code === 'ENOENT') {
      return []
    }
    throw err
  }

  const nodes: FileTreeNode[] = []

  const sorted = entries.sort((a, b) => {
    if (a.isDirectory() && !b.isDirectory()) return -1
    if (!a.isDirectory() && b.isDirectory()) return 1
    return a.name.localeCompare(b.name)
  })

  for (const entry of sorted) {
    if (entry.isDirectory() && IGNORED_DIRS.has(entry.name)) continue
    if (shouldSkipWorkspaceEntry(entry.name, entry.isDirectory())) continue

    const fullPath = join(dirPath, entry.name)
    if (entry.isDirectory()) {
      const children = await readDirectory(fullPath)
      nodes.push({ name: entry.name, path: fullPath, isDirectory: true, children })
    } else {
      nodes.push({ name: entry.name, path: fullPath, isDirectory: false })
    }
  }

  return nodes
}

export async function readFileContent(
  filePath: string,
  encoding?: FileEncoding
): Promise<DecodedFileContent> {
  const buffer = await readFile(filePath)
  return decodeFileBuffer(buffer, encoding)
}

export async function writeFileContent(
  filePath: string,
  content: string,
  encoding: FileEncoding = 'utf8'
): Promise<void> {
  await writeFile(filePath, encodeContent(content, encoding))
}

/** base64 でバイナリを書き込む（親ディレクトリは必要なら作成） */
export async function writeBinaryFile(filePath: string, base64: string): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true })
  await writeFile(filePath, Buffer.from(base64, 'base64'))
}

const MAX_EDITOR_MEDIA_BYTES = 25 * 1024 * 1024
const MAX_IMPORT_BYTES = 100 * 1024 * 1024

export async function readBinaryFile(
  filePath: string
): Promise<{ base64: string; size: number }> {
  const info = await stat(filePath)
  if (!info.isFile()) {
    throw new Error(t('fs.notAFile', { path: filePath }))
  }
  if (info.size > MAX_EDITOR_MEDIA_BYTES) {
    throw new Error(
      t('editor.mediaTooLarge', {
        maxMb: Math.round(MAX_EDITOR_MEDIA_BYTES / (1024 * 1024))
      })
    )
  }
  const buffer = await readFile(filePath)
  return { base64: buffer.toString('base64'), size: buffer.length }
}

function validateName(name: string): void {
  if (!name.trim()) throw new Error(t('fs.nameRequired'))
  if (/[<>:"/\\|?*]/.test(name)) throw new Error(t('fs.invalidChars'))
}

/** パスがワークスペース内（または直下）かどうか */
export function isInsideWorkspace(workspaceRoot: string, targetPath: string): boolean {
  const root = resolve(workspaceRoot)
  const absolutePath = isAbsolute(targetPath) ? resolve(targetPath) : resolve(root, targetPath)
  const rel = relative(root, absolutePath)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

/** ワークスペース内パスへ解決。`allowRoot` でワークスペース直下自体を許可（listDir 用） */
export function resolveInsideWorkspace(
  workspaceRoot: string,
  targetPath: string,
  options?: { allowRoot?: boolean }
): string {
  const root = resolve(workspaceRoot)
  const absolutePath = resolve(root, targetPath)
  const rel = relative(root, absolutePath)
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error(t('fs.outsideWorkspace', { path: targetPath }))
  }
  if (rel === '' && !options?.allowRoot) {
    throw new Error(t('fs.outsideWorkspace', { path: targetPath }))
  }
  return absolutePath
}

export async function createFile(parentDir: string, name: string): Promise<string> {
  validateName(name)
  const filePath = join(parentDir, name)
  if (await fileExists(filePath)) {
    throw new Error(t('fs.fileExists', { name }))
  }
  await writeFile(filePath, '', 'utf-8')
  return filePath
}

export async function createDirectory(parentDir: string, name: string): Promise<string> {
  validateName(name)
  const dirPath = join(parentDir, name)
  if (await fileExists(dirPath)) {
    throw new Error(t('fs.folderExists', { name }))
  }
  await mkdir(dirPath)
  return dirPath
}

/** ワークスペース外のファイルを parentDir へコピーする */
export async function importFilesToWorkspace(
  parentDir: string,
  sourcePaths: string[]
): Promise<string[]> {
  if (sourcePaths.length === 0) return []

  let existingEntries: string[] = []
  try {
    existingEntries = await readdir(parentDir)
  } catch {
    throw new Error(t('fs.destMustBeFolder'))
  }

  const created: string[] = []
  const reservedNames = [...existingEntries]

  for (const sourcePath of sourcePaths) {
    const resolved = resolve(sourcePath)
    const info = await stat(resolved)
    if (!info.isFile()) {
      throw new Error(t('fs.notAFile', { path: basename(resolved) }))
    }
    if (info.size > MAX_IMPORT_BYTES) {
      throw new Error(
        t('fs.importTooLarge', {
          name: basename(resolved),
          maxMb: Math.round(MAX_IMPORT_BYTES / (1024 * 1024))
        })
      )
    }

    const fileName = buildUniqueFileName(basename(resolved), reservedNames)
    reservedNames.push(fileName)
    const destPath = join(parentDir, fileName)
    await copyFile(resolved, destPath)
    created.push(destPath)
  }

  return created
}

export async function renamePath(targetPath: string, newName: string): Promise<string> {
  validateName(newName)
  const parentDir = dirname(targetPath)
  const newPath = join(parentDir, newName)
  if (newPath === targetPath) return targetPath
  if (await fileExists(newPath)) {
    throw new Error(t('fs.itemExists', { name: newName }))
  }
  await rename(targetPath, newPath)
  return newPath
}

function normalizeComparePath(filePath: string): string {
  return resolve(filePath).replace(/\\/g, '/')
}

export async function movePath(sourcePath: string, destDir: string): Promise<string> {
  const sourceResolved = resolve(sourcePath)
  const destResolved = resolve(destDir)
  const destInfo = await stat(destResolved)
  if (!destInfo.isDirectory()) {
    throw new Error(t('fs.destMustBeFolder'))
  }

  const sourceNorm = normalizeComparePath(sourceResolved)
  const destNorm = normalizeComparePath(destResolved)
  const parentNorm = normalizeComparePath(dirname(sourceResolved))

  if (destNorm === parentNorm) return sourcePath
  if (destNorm === sourceNorm || destNorm.startsWith(`${sourceNorm}/`)) {
    throw new Error(t('fs.cannotMoveIntoSelf'))
  }

  const baseName = basename(sourceResolved)
  const newPath = join(destResolved, baseName)
  if (await fileExists(newPath)) {
    throw new Error(t('fs.itemExists', { name: baseName }))
  }

  await rename(sourceResolved, newPath)
  return newPath
}

export async function deletePath(targetPath: string): Promise<void> {
  const info = await stat(targetPath)
  if (info.isDirectory()) {
    await rm(targetPath, { recursive: true, force: true })
  } else {
    await rm(targetPath, { force: true })
  }
}

export async function applyWorkspaceActions(
  workspaceRoot: string,
  actions: WorkspaceAction[]
): Promise<WorkspaceActionResult> {
  const applied: WorkspaceAction[] = []
  const materialized = await materializeWorkspaceActions(workspaceRoot, actions)
  const normalizedActions = materialized.map((action) => {
    if (isPathedAction(action)) {
      return { ...action, path: normalizeWorkspaceActionPath(workspaceRoot, action.path) }
    }
    return action
  })

  // Apply creates first, then file deletes, then directory deletes
  // so nested deleteFile under a soon-to-be-removed dir still works.
  const ordered = [
    ...normalizedActions.filter((a) => a.type === 'mkdir' || a.type === 'writeFile'),
    ...normalizedActions.filter((a) => a.type === 'deleteFile'),
    ...normalizedActions.filter((a) => a.type === 'deleteDir')
  ]

  for (const action of ordered) {
    if (action.type === 'mkdir') {
      const dirPath = resolveInsideWorkspace(workspaceRoot, action.path)
      await mkdir(dirPath, { recursive: true })
      applied.push(action)
      continue
    }

    if (action.type === 'writeFile') {
      const filePath = resolveInsideWorkspace(workspaceRoot, action.path)
      await mkdir(dirname(filePath), { recursive: true })
      await writeFile(filePath, action.content, 'utf-8')
      applied.push(action)
      continue
    }

    if (action.type === 'deleteFile' || action.type === 'deleteDir') {
      const targetPath = resolveInsideWorkspace(workspaceRoot, action.path)
      if (await fileExists(targetPath)) {
        const info = await stat(targetPath)
        if (action.type === 'deleteFile' && info.isDirectory()) {
          throw new Error(t('fs.notAFile', { path: action.path }))
        }
        if (action.type === 'deleteDir' && !info.isDirectory()) {
          throw new Error(t('fs.notAFolder', { path: action.path }))
        }
        await deletePath(targetPath)
      }
      applied.push(action)
    }
  }

  return { applied }
}

export async function previewWorkspaceActions(
  workspaceRoot: string,
  actions: WorkspaceAction[]
): Promise<ActionPreviewItem[]> {
  const items: ActionPreviewItem[] = []

  const materialized = await materializeWorkspaceActions(workspaceRoot, actions)

  for (const action of materialized) {
    const relativeActionPath = normalizeWorkspaceActionPath(workspaceRoot, action.path)

    if (action.type === 'mkdir') {
      const dirPath = resolveInsideWorkspace(workspaceRoot, relativeActionPath)
      items.push({
        type: 'mkdir',
        path: dirPath,
        relativePath: relativeActionPath.replace(/\\/g, '/'),
        alreadyExists: await fileExists(dirPath)
      })
      continue
    }

    if (action.type === 'writeFile') {
      const filePath = resolveInsideWorkspace(workspaceRoot, relativeActionPath)
      const exists = await fileExists(filePath)
      let oldContent = ''
      if (exists) {
        try {
          oldContent = (await readFileContent(filePath)).content
        } catch {
          oldContent = ''
        }
      }

      items.push({
        type: 'writeFile',
        path: filePath,
        relativePath: relativeActionPath.replace(/\\/g, '/'),
        oldContent,
        newContent: action.content,
        isNew: !exists
      })
      continue
    }

    if (action.type === 'deleteFile' || action.type === 'deleteDir') {
      const targetPath = resolveInsideWorkspace(workspaceRoot, relativeActionPath)
      items.push({
        type: action.type,
        path: targetPath,
        relativePath: relativeActionPath.replace(/\\/g, '/'),
        exists: await fileExists(targetPath)
      })
    }
  }

  return items
}

export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath)
    return true
  } catch {
    return false
  }
}

/**
 * チャット文脈用のパス表記。
 * ワークスペース内は相対、外は絶対（`../..` 表記にしない）。
 */
function toContextPathLabel(workspaceRoot: string, filePath: string): string {
  const root = resolve(workspaceRoot)
  const absolute = resolve(filePath)
  const rel = relative(root, absolute)
  if (rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))) {
    return rel.replace(/\\/g, '/') || '.'
  }
  return absolute.replace(/\\/g, '/')
}

async function readTextFileSafe(
  filePath: string,
  workspaceRoot: string
): Promise<ResolvedContextFile | null> {
  try {
    const info = await stat(filePath)
    if (!info.isFile()) return null

    const truncated = info.size > MAX_FILE_BYTES
    const buffer = await readFile(filePath)
    const slice = truncated ? buffer.subarray(0, MAX_FILE_BYTES) : buffer
    // Skip likely-binary files (NUL in the sampled bytes), except UTF-16 which uses NUL padding
    const looksLikeUtf16 =
      (slice.length >= 2 && slice[0] === 0xff && slice[1] === 0xfe) ||
      (slice.length >= 2 && slice[0] === 0xfe && slice[1] === 0xff)
    if (!looksLikeUtf16 && slice.includes(0)) return null

    const decoded = decodeFileBuffer(slice)
    return {
      relativePath: toContextPathLabel(workspaceRoot, filePath),
      content: decoded.content,
      truncated,
      kind: 'text'
    }
  } catch {
    return null
  }
}

async function readPdfFileSafe(
  filePath: string,
  workspaceRoot: string
): Promise<ResolvedContextFile | null> {
  try {
    const info = await stat(filePath)
    if (!info.isFile()) return null
    const buffer = await readFile(filePath)
    const extracted = extractPdfText(buffer, MAX_PDF_TEXT_CHARS)
    const relativePath = toContextPathLabel(workspaceRoot, filePath)
    if (!extracted.text.trim()) {
      return {
        relativePath,
        content: t('ai.pdfNoText'),
        truncated: false,
        kind: 'pdf'
      }
    }
    return {
      relativePath,
      content: extracted.text,
      truncated: extracted.truncated,
      kind: 'pdf'
    }
  } catch {
    return null
  }
}

async function readImageFileSafe(
  filePath: string,
  workspaceRoot: string
): Promise<ResolvedContextFile | null> {
  try {
    const mimeType = getImageMimeType(filePath)
    if (!mimeType) return null
    const info = await stat(filePath)
    if (!info.isFile()) return null
    if (info.size > MAX_IMAGE_BYTES) {
      return {
        relativePath: toContextPathLabel(workspaceRoot, filePath),
        content: t('ai.imageTooLarge', {
          maxMb: Math.round(MAX_IMAGE_BYTES / (1024 * 1024))
        }),
        truncated: true,
        kind: 'text'
      }
    }
    const buffer = await readFile(filePath)
    return {
      relativePath: toContextPathLabel(workspaceRoot, filePath),
      content: '',
      truncated: false,
      kind: 'image',
      mimeType,
      base64: buffer.toString('base64')
    }
  } catch {
    return null
  }
}

async function readContextFile(
  filePath: string,
  workspaceRoot: string
): Promise<ResolvedContextFile | null> {
  if (isImagePath(filePath)) return readImageFileSafe(filePath, workspaceRoot)
  if (isPdfPath(filePath)) return readPdfFileSafe(filePath, workspaceRoot)
  return readTextFileSafe(filePath, workspaceRoot)
}

async function listFilesRecursive(dirPath: string): Promise<string[]> {
  const result: string[] = []
  let entries: Dirent[]
  try {
    entries = await readdir(dirPath, { withFileTypes: true })
  } catch {
    // Missing or unreadable directory (e.g. deleted after being attached to chat)
    return result
  }

  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name)) continue
      const subFiles = await listFilesRecursive(join(dirPath, entry.name))
      result.push(...subFiles)
    } else {
      if (shouldSkipWorkspaceEntry(entry.name, false)) continue
      result.push(join(dirPath, entry.name))
    }
  }

  return result.sort()
}

export async function resolveChatContext(
  workspaceRoot: string,
  references: ChatContextRef[]
): Promise<ResolvedChatContext> {
  const files: ResolvedContextFile[] = []
  const folders: ResolvedFolderContext[] = []
  let imageCount = 0

  const acceptFile = (file: ResolvedContextFile | null): void => {
    if (!file) return
    if (file.kind === 'image') {
      if (imageCount >= MAX_IMAGES_PER_REQUEST) {
        files.push({
          relativePath: file.relativePath,
          content: t('ai.imageLimitReached', { max: MAX_IMAGES_PER_REQUEST }),
          truncated: true,
          kind: 'text'
        })
        return
      }
      imageCount += 1
    }
    files.push(file)
  }

  for (const ref of references) {
    if (ref.isDirectory) {
      // フォルダ参照はワークスペース内のみ（外部フォルダはチャット文脈に載せない）
      if (!isInsideWorkspace(workspaceRoot, ref.path)) continue

      try {
        const info = await stat(ref.path)
        if (!info.isDirectory()) continue
      } catch {
        // Deleted or inaccessible folder ref — skip like missing files
        continue
      }

      const allFiles = await listFilesRecursive(ref.path)
      const structure = allFiles.map((f) => toContextPathLabel(workspaceRoot, f))
      const truncated = allFiles.length > MAX_FOLDER_FILES
      const selected = allFiles.slice(0, MAX_FOLDER_FILES)
      const folderFiles: ResolvedContextFile[] = []

      for (const filePath of selected) {
        const file = await readContextFile(filePath, workspaceRoot)
        if (!file) continue
        if (file.kind === 'image') {
          if (imageCount >= MAX_IMAGES_PER_REQUEST) {
            folderFiles.push({
              relativePath: file.relativePath,
              content: t('ai.imageLimitReached', { max: MAX_IMAGES_PER_REQUEST }),
              truncated: true,
              kind: 'text'
            })
            continue
          }
          imageCount += 1
        }
        folderFiles.push(file)
      }

      folders.push({
        relativePath: toContextPathLabel(workspaceRoot, ref.path) || '.',
        structure,
        files: folderFiles,
        truncated
      })
    } else {
      // 外部ファイルも読み取り専用の文脈として許可
      const file = await readContextFile(ref.path, workspaceRoot)
      acceptFile(file)
    }
  }

  return { files, folders }
}
