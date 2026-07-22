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
  const normalized = path.replace(/\\/g, '/')
  if (!workspaceRoot) return normalized
  const root = workspaceRoot.replace(/\\/g, '/').replace(/\/$/, '')
  const equalsRoot =
    typeof process !== 'undefined' && process.platform === 'win32'
      ? normalized.toLowerCase() === root.toLowerCase() ||
        normalized.toLowerCase() === `${root.toLowerCase()}/`
      : normalized === root || normalized === `${root}/`
  // ワークスペース直下そのものは相対 "."（フォルダ名だと Agent がサブパスと誤認する）
  if (equalsRoot) {
    return '.'
  }
  const underRoot =
    typeof process !== 'undefined' && process.platform === 'win32'
      ? normalized.toLowerCase().startsWith(`${root.toLowerCase()}/`)
      : normalized.startsWith(`${root}/`)
  if (underRoot) {
    return normalized.slice(root.length + 1) || '.'
  }
  // 外部ファイルは絶対パス（スラッシュ統一）でメンションする
  return normalized
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
  // Windows の長い絶対パス＋日本語を見越し、狭すぎる 260 は避ける
  if (!value || value.length > 1024) return false
  // 改行・制御文字は @[...] を壊す。半角/全角スペースはフォルダ名に現れうるので許可
  if (/[\n\r\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(value)) return false
  // 選択行: path:12 / path:12-34（パス部分は Unicode・スペース可）
  if (/^.+:\d+(-\d+)?$/.test(value)) return true
  // フォルダ（ルート直下の漢字名・スペース付き名も含む）
  if (value.endsWith('/')) return true
  // ネストした相対 / 絶対パス
  if (/[\\/]/.test(value)) return true
  // ルート直下のファイル（拡張子あり）。basename にスペース・漢字を許容
  if (/^[^\\/]+\.\w{1,12}$/.test(value)) return true
  return false
}

const STRUCTURED_MENTION_IN_TEXT_RE = /@\[([^\]\n]+)\]/g

/** 文字列中にパスらしい `@[...]` が1つでもあるか */
export function hasStructuredMention(text: string): boolean {
  STRUCTURED_MENTION_IN_TEXT_RE.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = STRUCTURED_MENTION_IN_TEXT_RE.exec(text)) !== null) {
    if (isStructuredMention(match[1])) return true
  }
  return false
}
