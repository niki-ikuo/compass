import { getImageMimeType, isImagePath, isPdfPath } from '@/utils/media-context'

export type ClipboardMediaKind = 'image' | 'pdf'

export interface ClipboardMediaFile {
  kind: ClipboardMediaKind
  mimeType: string
  /** 元のファイル名（無い場合は空） */
  name: string
  file: File
}

const IMAGE_MIME_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/bmp': 'bmp'
}

/** MIME / ファイル名から画像・PDF を判定 */
export function classifyMediaFile(file: {
  name: string
  type: string
}): { kind: ClipboardMediaKind; mimeType: string; extension: string } | null {
  const type = (file.type || '').toLowerCase()
  if (type === 'application/pdf' || isPdfPath(file.name)) {
    return { kind: 'pdf', mimeType: 'application/pdf', extension: 'pdf' }
  }

  if (type.startsWith('image/')) {
    const ext = IMAGE_MIME_EXT[type] ?? getImageMimeType(file.name)?.split('/')[1]
    if (!ext && !isImagePath(file.name)) return null
    const mimeType =
      IMAGE_MIME_EXT[type] != null
        ? type === 'image/jpg'
          ? 'image/jpeg'
          : type
        : (getImageMimeType(file.name) ?? 'image/png')
    const extension =
      IMAGE_MIME_EXT[mimeType] ??
      (file.name.includes('.') ? file.name.split('.').pop()!.toLowerCase() : 'png')
    return { kind: 'image', mimeType, extension }
  }

  if (isImagePath(file.name)) {
    const mimeType = getImageMimeType(file.name)!
    return {
      kind: 'image',
      mimeType,
      extension: file.name.split('.').pop()!.toLowerCase()
    }
  }

  return null
}

function isGenericClipboardName(name: string): boolean {
  const base = name.trim().toLowerCase()
  return (
    !base ||
    base === 'image.png' ||
    base === 'image.jpg' ||
    base === 'image.jpeg' ||
    base === 'blob' ||
    base === 'untitled' ||
    /^image\.(png|jpe?g|webp|gif|bmp)$/i.test(base)
  )
}

export function buildPastedMediaFileName(
  classified: { kind: ClipboardMediaKind; extension: string },
  originalName: string,
  now: Date = new Date()
): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  const stamp = [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
    '-',
    pad(now.getHours()),
    pad(now.getMinutes()),
    pad(now.getSeconds())
  ].join('')

  if (originalName && !isGenericClipboardName(originalName)) {
    const safe = originalName.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').trim()
    if (safe) {
      const hasExt = /\.[a-z0-9]+$/i.test(safe)
      return hasExt ? safe : `${safe}.${classified.extension}`
    }
  }

  const prefix = classified.kind === 'pdf' ? 'paste' : 'screenshot'
  const ms = String(now.getMilliseconds()).padStart(3, '0')
  return `${prefix}-${stamp}${ms}.${classified.extension}`
}

/**
 * クリップボード / OS ファイル貼り付けから画像・PDF を収集する。
 * items と files の両方を見て重複は除く。
 */
export function collectClipboardMedia(data: DataTransfer): ClipboardMediaFile[] {
  const seen = new Set<string>()
  const out: ClipboardMediaFile[] = []

  const push = (file: File | null): void => {
    if (!file) return
    const classified = classifyMediaFile(file)
    if (!classified) return
    const key = `${file.name}:${file.size}:${file.type}:${file.lastModified}`
    if (seen.has(key)) return
    seen.add(key)
    out.push({
      kind: classified.kind,
      mimeType: classified.mimeType,
      name: file.name || '',
      file
    })
  }

  const items = data.items
  if (items) {
    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      if (item.kind !== 'file') continue
      push(item.getAsFile())
    }
  }

  const files = data.files
  if (files) {
    for (let i = 0; i < files.length; i++) {
      push(files[i] ?? null)
    }
  }

  return out
}

export function hasClipboardMedia(data: DataTransfer): boolean {
  return collectClipboardMedia(data).length > 0
}
