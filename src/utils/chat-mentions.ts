/** チャット指示文に埋め込むファイル/フォルダ/選択行のメンション */

export type ChatMentionKind = 'file' | 'folder' | 'selection'

export function formatFileMention(label: string): string {
  return `@[${label.replace(/\\/g, '/')}]`
}

export function formatFolderMention(label: string): string {
  const normalized = label.replace(/\\/g, '/')
  const withSlash = normalized.endsWith('/') ? normalized : `${normalized}/`
  return `@[${withSlash}]`
}

export function formatSelectionMentionLabel(
  label: string,
  startLine: number,
  endLine: number
): string {
  const path = label.replace(/\\/g, '/')
  const range = startLine === endLine ? `${startLine}` : `${startLine}-${endLine}`
  return `@[${path}:${range}]`
}

export function detectMentionKind(inner: string): ChatMentionKind {
  if (/:\d+(-\d+)?$/.test(inner)) return 'selection'
  if (inner.endsWith('/')) return 'folder'
  return 'file'
}

/** `@[path]` 形式のメンションかどうか（中身はパスらしい文字列） */
export function isStructuredMention(inner: string): boolean {
  const value = inner.trim()
  if (!value || /\s/.test(value) || value.length > 260) return false
  if (/^.+:\d+(-\d+)?$/.test(value)) return true
  if (value.endsWith('/') && /[\\/]/.test(value)) return true
  if (/[\\/]/.test(value)) return true
  if (/^[\w.@+-]+\.\w{1,12}$/.test(value)) return true
  return false
}
