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

export function formatContextLabel(path: string, workspaceRoot: string | null): string {
  if (!workspaceRoot) return path
  const root = workspaceRoot.replace(/\\/g, '/')
  const normalized = path.replace(/\\/g, '/')
  // ワークスペース直下そのものは相対 "."（フォルダ名だと Agent がサブパスと誤認する）
  if (normalized === root || normalized === `${root}/`) {
    return '.'
  }
  if (normalized.startsWith(root)) {
    return normalized.slice(root.length).replace(/^\//, '') || '.'
  }
  return path
}

/** 指示文に埋め込むパス表記（フォルダは末尾 `/`） */
export function formatContextMention(
  path: string,
  isDirectory: boolean,
  workspaceRoot: string | null
): string {
  const label = formatContextLabel(path, workspaceRoot)
  return isDirectory ? formatFolderMention(label) : formatFileMention(label)
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
  // 選択行: path:12 / path:12-34（パス部分は Unicode 可）
  if (/^.+:\d+(-\d+)?$/.test(value)) return true
  // フォルダ（ルート直下の漢字名も含む）
  if (value.endsWith('/')) return true
  // ネストした相対パス
  if (/[\\/]/.test(value)) return true
  // ルート直下のファイル（拡張子あり）。\w だと漢字ファイル名が落ちるため basename は非空白・非区切りで許容
  if (/^[^\s\\/]+\.\w{1,12}$/.test(value)) return true
  return false
}
