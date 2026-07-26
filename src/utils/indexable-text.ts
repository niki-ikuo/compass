import { isBinaryExtensionPath } from './binary-file'
import { isExternalOpenPath } from './external-open'
import { isExtractableDocumentPath } from './extractable-document'
import { isImagePath } from './media-context'

/**
 * テキスト索引 / RAG からパス段階で除外する（拡張子ベース）。
 * PDF / .docx は抽出テキストとして候補に含める。
 * 最終判定は内容のバイナリスニフ（抽出対象以外）と併用する。
 */
export function isExcludedFromTextIndex(filePath: string): boolean {
  if (isExtractableDocumentPath(filePath)) return false
  return (
    isBinaryExtensionPath(filePath) ||
    isImagePath(filePath) ||
    isExternalOpenPath(filePath)
  )
}

/** 索引候補になりうるテキスト／抽出可能文書パスか（拡張子のみ。内容は未確認）。 */
export function isTextIndexCandidatePath(filePath: string): boolean {
  return !isExcludedFromTextIndex(filePath)
}
