import { isBinaryExtensionPath } from './binary-file'
import { isExternalOpenPath } from './external-open'
import { isMediaPath } from './media-context'

/**
 * テキスト索引 / RAG からパス段階で除外する（拡張子ベース）。
 * 最終判定は内容のバイナリスニフと併用する。
 */
export function isExcludedFromTextIndex(filePath: string): boolean {
  return (
    isBinaryExtensionPath(filePath) ||
    isMediaPath(filePath) ||
    isExternalOpenPath(filePath)
  )
}

/** 索引候補になりうるテキストパスか（拡張子のみ。内容は未確認）。 */
export function isTextIndexCandidatePath(filePath: string): boolean {
  return !isExcludedFromTextIndex(filePath)
}
