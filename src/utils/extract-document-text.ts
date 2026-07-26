import { extractDocxText } from './docx-text'
import { extractPdfText } from './pdf-text'
import { extractXlsxText } from './xlsx-text'
import {
  getExtractableDocumentKind,
  MAX_EXTRACTED_TEXT_CHARS,
  type ExtractableDocumentKind
} from './extractable-document'

/**
 * PDF / .docx / .xlsx からテキストを抽出する（Node zlib 依存。Main プロセス専用）。
 * レンダラーからは import しないこと。
 */
export function extractDocumentText(
  filePath: string,
  buffer: Buffer,
  maxChars: number = MAX_EXTRACTED_TEXT_CHARS
): { text: string; truncated: boolean; kind: ExtractableDocumentKind } | null {
  const kind = getExtractableDocumentKind(filePath)
  if (!kind) return null
  if (kind === 'pdf') {
    const result = extractPdfText(buffer, maxChars)
    return { ...result, kind }
  }
  if (kind === 'xlsx') {
    const result = extractXlsxText(buffer, maxChars)
    return { ...result, kind }
  }
  const result = extractDocxText(buffer, maxChars)
  return { ...result, kind }
}
