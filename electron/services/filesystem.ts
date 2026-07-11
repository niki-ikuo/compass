import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'fs/promises'
import { resolve, relative, dirname, join, basename } from 'path'
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
import { normalizeWorkspaceActionPath } from '../../src/utils/workspace-actions'
import { decodeFileBuffer, encodeContent } from './encoding'

const IGNORED_DIRS = new Set(['node_modules', '.git', 'dist', 'out', 'release', '.next', '.compass'])
const MAX_FILE_BYTES = 32 * 1024
const MAX_FOLDER_FILES = 25

export async function readDirectory(dirPath: string): Promise<FileTreeNode[]> {
  const entries = await readdir(dirPath, { withFileTypes: true })
  const nodes: FileTreeNode[] = []

  const sorted = entries.sort((a, b) => {
    if (a.isDirectory() && !b.isDirectory()) return -1
    if (!a.isDirectory() && b.isDirectory()) return 1
    return a.name.localeCompare(b.name)
  })

  for (const entry of sorted) {
    if (entry.isDirectory() && IGNORED_DIRS.has(entry.name)) continue

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

function validateName(name: string): void {
  if (!name.trim()) throw new Error('名前を入力してください')
  if (/[<>:"/\\|?*]/.test(name)) throw new Error('名前に使えない文字が含まれています')
}

function resolveInsideWorkspace(workspaceRoot: string, targetPath: string): string {
  const absolutePath = resolve(workspaceRoot, targetPath)
  const rel = relative(workspaceRoot, absolutePath)
  if (rel.startsWith('..') || rel === '') {
    throw new Error(`ワークスペース外のパスは許可されていません: ${targetPath}`)
  }
  return absolutePath
}

export async function createFile(parentDir: string, name: string): Promise<string> {
  validateName(name)
  const filePath = join(parentDir, name)
  if (await fileExists(filePath)) {
    throw new Error('同じ名前のファイルが既に存在します')
  }
  await writeFile(filePath, '', 'utf-8')
  return filePath
}

export async function createDirectory(parentDir: string, name: string): Promise<string> {
  validateName(name)
  const dirPath = join(parentDir, name)
  if (await fileExists(dirPath)) {
    throw new Error('同じ名前のフォルダが既に存在します')
  }
  await mkdir(dirPath)
  return dirPath
}

export async function renamePath(targetPath: string, newName: string): Promise<string> {
  validateName(newName)
  const parentDir = dirname(targetPath)
  const newPath = join(parentDir, newName)
  if (newPath === targetPath) return targetPath
  if (await fileExists(newPath)) {
    throw new Error('同じ名前の項目が既に存在します')
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
    throw new Error('移動先はフォルダである必要があります')
  }

  const sourceNorm = normalizeComparePath(sourceResolved)
  const destNorm = normalizeComparePath(destResolved)
  const parentNorm = normalizeComparePath(dirname(sourceResolved))

  if (destNorm === parentNorm) return sourcePath
  if (destNorm === sourceNorm || destNorm.startsWith(`${sourceNorm}/`)) {
    throw new Error('フォルダを自分自身またはその中には移動できません')
  }

  const newPath = join(destResolved, basename(sourceResolved))
  if (await fileExists(newPath)) {
    throw new Error('同じ名前の項目が既に存在します')
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
  const normalizedActions = actions.map((action) => {
    if (
      action.type === 'mkdir' ||
      action.type === 'writeFile' ||
      action.type === 'deleteFile' ||
      action.type === 'deleteDir'
    ) {
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
          throw new Error(`ファイルではありません: ${action.path}`)
        }
        if (action.type === 'deleteDir' && !info.isDirectory()) {
          throw new Error(`フォルダではありません: ${action.path}`)
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

  for (const action of actions) {
    const relativeActionPath =
      action.type === 'mkdir' ||
      action.type === 'writeFile' ||
      action.type === 'deleteFile' ||
      action.type === 'deleteDir'
        ? normalizeWorkspaceActionPath(workspaceRoot, action.path)
        : action.path

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

function toRelativePath(workspaceRoot: string, filePath: string): string {
  return relative(workspaceRoot, filePath).replace(/\\/g, '/')
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
      relativePath: toRelativePath(workspaceRoot, filePath),
      content: decoded.content,
      truncated
    }
  } catch {
    return null
  }
}

async function listFilesRecursive(dirPath: string): Promise<string[]> {
  const result: string[] = []
  const entries = await readdir(dirPath, { withFileTypes: true })

  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name)) continue
      const subFiles = await listFilesRecursive(join(dirPath, entry.name))
      result.push(...subFiles)
    } else {
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

  for (const ref of references) {
    if (ref.isDirectory) {
      const allFiles = await listFilesRecursive(ref.path)
      const structure = allFiles.map((f) => toRelativePath(workspaceRoot, f))
      const truncated = allFiles.length > MAX_FOLDER_FILES
      const selected = allFiles.slice(0, MAX_FOLDER_FILES)
      const folderFiles: ResolvedContextFile[] = []

      for (const filePath of selected) {
        const file = await readTextFileSafe(filePath, workspaceRoot)
        if (file) folderFiles.push(file)
      }

      folders.push({
        relativePath: toRelativePath(workspaceRoot, ref.path),
        structure,
        files: folderFiles,
        truncated
      })
    } else {
      const file = await readTextFileSafe(ref.path, workspaceRoot)
      if (file) files.push(file)
    }
  }

  return { files, folders }
}
