import type { ChatContextRef } from '@/types'
import { basename } from '@/utils/path'

export const CHAT_CONTEXT_DRAG_MIME = 'application/x-compass-context-ref'

export type OsDroppedFilesResult = {
  files: ChatContextRef[]
  rejectedFolderNames: string[]
}

export type ResolveDroppedFilePath = (file: File) => string | null

export function toChatContextRef(node: {
  path: string
  name: string
  isDirectory: boolean
}): ChatContextRef {
  return {
    path: node.path,
    name: node.name,
    isDirectory: node.isDirectory
  }
}

function isChatContextRef(value: unknown): value is ChatContextRef {
  if (!value || typeof value !== 'object') return false
  const ref = value as ChatContextRef
  return (
    typeof ref.path === 'string' &&
    typeof ref.name === 'string' &&
    typeof ref.isDirectory === 'boolean'
  )
}

export function serializeChatContextRefs(refs: ChatContextRef[]): string {
  return JSON.stringify(refs)
}

export function serializeChatContextRef(ref: ChatContextRef): string {
  return serializeChatContextRefs([ref])
}

function parseChatContextRefsJson(raw: string): ChatContextRef[] {
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    const items = Array.isArray(parsed) ? parsed : [parsed]
    return items.filter(isChatContextRef)
  } catch {
    return []
  }
}

export function parseChatContextRefs(dataTransfer: DataTransfer): ChatContextRef[] {
  const fromMime = parseChatContextRefsJson(dataTransfer.getData(CHAT_CONTEXT_DRAG_MIME))
  if (fromMime.length > 0) return fromMime
  // 一部環境でカスタム MIME の Unicode が空になることがあるため text/plain をフォールバック
  return parseChatContextRefsJson(dataTransfer.getData('text/plain'))
}

export function parseChatContextRef(dataTransfer: DataTransfer): ChatContextRef | null {
  return parseChatContextRefs(dataTransfer)[0] ?? null
}

export function hasChatContextDrag(dataTransfer: DataTransfer): boolean {
  return dataTransfer.types.includes(CHAT_CONTEXT_DRAG_MIME)
}

/** OS / エクスプローラーからのファイルドロップ（Files） */
export function hasOsFileDrag(dataTransfer: DataTransfer): boolean {
  const types = dataTransfer.types
  if (!types) return false
  for (let i = 0; i < types.length; i++) {
    if (types[i] === 'Files') return true
  }
  return false
}

function resolveFileAbsolutePath(
  file: File,
  resolvePath?: ResolveDroppedFilePath
): string | null {
  if (resolvePath) {
    const resolved = resolvePath(file)
    if (typeof resolved === 'string' && resolved.trim()) return resolved.trim()
  }
  // Electron 32 未満のフォールバック（通常は到達しない）
  const legacy = (file as File & { path?: string }).path
  if (typeof legacy === 'string' && legacy.trim()) return legacy.trim()
  return null
}

function toOsFileRef(file: File, resolvePath?: ResolveDroppedFilePath): ChatContextRef | null {
  const absolutePath = resolveFileAbsolutePath(file, resolvePath)
  if (!absolutePath) return null
  return {
    path: absolutePath,
    name: file.name || basename(absolutePath),
    isDirectory: false
  }
}

/**
 * OS からドロップされたファイルを参照化する。
 * フォルダは拒否（チャット文脈の外部フォルダは非対応）。
 * Electron 32+ では `resolvePath` に webUtils.getPathForFile を渡すこと。
 */
export function parseOsDroppedFileRefs(
  dataTransfer: DataTransfer,
  resolvePath?: ResolveDroppedFilePath
): OsDroppedFilesResult {
  const files: ChatContextRef[] = []
  const rejectedFolderNames: string[] = []
  const seen = new Set<string>()

  const pushFile = (file: File): void => {
    const ref = toOsFileRef(file, resolvePath)
    if (!ref) return
    const key = ref.path.replace(/\\/g, '/')
    if (seen.has(key)) return
    seen.add(key)
    files.push(ref)
  }

  const items = dataTransfer.items
  if (items && items.length > 0) {
    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      if (item.kind !== 'file') continue
      const entry = item.webkitGetAsEntry?.() ?? null
      if (entry?.isDirectory) {
        rejectedFolderNames.push(entry.name || 'folder')
        continue
      }
      const file = item.getAsFile()
      if (file) pushFile(file)
    }
    return { files, rejectedFolderNames }
  }

  for (let i = 0; i < dataTransfer.files.length; i++) {
    pushFile(dataTransfer.files[i])
  }
  return { files, rejectedFolderNames }
}
