import { fileExtension, isPdfPath } from './media-context'

/** Chat / index / search で抽出テキストを載せる上限（文字） */
export const MAX_EXTRACTED_TEXT_CHARS = 48_000

/** 抽出対象バイナリの読み込み上限（バイト） */
export const MAX_EXTRACTABLE_FILE_BYTES = 20 * 1024 * 1024

export type ExtractableDocumentKind = 'pdf' | 'docx'

export function isDocxPath(filePath: string): boolean {
  return fileExtension(filePath) === 'docx'
}

/** アプリ内編集せず、抽出テキストとして索引・検索・参照できる文書 */
export function isExtractableDocumentPath(filePath: string): boolean {
  return isPdfPath(filePath) || isDocxPath(filePath)
}

export function getExtractableDocumentKind(
  filePath: string
): ExtractableDocumentKind | null {
  if (isPdfPath(filePath)) return 'pdf'
  if (isDocxPath(filePath)) return 'docx'
  return null
}

/**
 * 抽出文書の要約サイドカー相対パス。
 * `docs/report.pdf` → `docs/report.summary.md`
 */
export function sidecarSummaryMarkdownPath(relativePath: string): string {
  const normalized = relativePath.replace(/\\/g, '/')
  const slash = normalized.lastIndexOf('/')
  const dir = slash >= 0 ? normalized.slice(0, slash + 1) : ''
  const base = slash >= 0 ? normalized.slice(slash + 1) : normalized
  const dot = base.lastIndexOf('.')
  const stem = dot > 0 ? base.slice(0, dot) : base
  return `${dir}${stem}.summary.md`
}
