import { isZipBuffer, readZipEntry } from './office-zip'

/**
 * Best-effort .docx text extraction without a full Office library.
 * Reads `word/document.xml` from the ZIP and collects `w:t` runs.
 * Legacy `.doc` / complex OLE packages are not supported.
 */
export function extractDocxText(
  buffer: Buffer,
  maxChars: number
): { text: string; truncated: boolean } {
  if (!isZipBuffer(buffer)) {
    return { text: '', truncated: false }
  }

  const entry = readZipEntry(buffer, 'word/document.xml')
  if (!entry) return { text: '', truncated: false }

  return collectDocxXmlText(entry.toString('utf8'), maxChars)
}

function collectDocxXmlText(
  xml: string,
  maxChars: number
): { text: string; truncated: boolean } {
  const parts: string[] = []
  let total = 0
  let truncated = false
  let paragraphBits: string[] = []

  const flushParagraph = (): boolean => {
    const line = paragraphBits.join('').replace(/[ \t]+/g, ' ').trim()
    paragraphBits = []
    if (!line) return true
    const remaining = maxChars - total
    if (remaining <= 0) {
      truncated = true
      return false
    }
    const piece = line.length > remaining ? line.slice(0, remaining) : line
    parts.push(piece)
    total += piece.length + (parts.length > 1 ? 1 : 0)
    if (piece.length < line.length) {
      truncated = true
      return false
    }
    return true
  }

  // Walk paragraph blocks so we keep readable newlines.
  const paragraphRe = /<w:p[\s>][\s\S]*?<\/w:p>/g
  let match: RegExpExecArray | null
  let matchedAny = false
  while ((match = paragraphRe.exec(xml)) !== null) {
    matchedAny = true
    const block = match[0]
    paragraphBits = []
    const textRe = /<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g
    let textMatch: RegExpExecArray | null
    while ((textMatch = textRe.exec(block)) !== null) {
      paragraphBits.push(decodeXmlEntities(textMatch[1]))
    }
    if (block.includes('<w:tab ') || block.includes('<w:tab/>') || block.includes('<w:tab>')) {
      // Keep simple spacing; tabs rarely matter for search / summarize.
      if (paragraphBits.length === 0) paragraphBits.push(' ')
    }
    if (!flushParagraph()) break
  }

  if (!matchedAny) {
    // Fallback: any w:t in the document
    const textRe = /<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g
    while ((match = textRe.exec(xml)) !== null) {
      const decoded = decodeXmlEntities(match[1]).trim()
      if (!decoded) continue
      const remaining = maxChars - total
      if (remaining <= 0) {
        truncated = true
        break
      }
      const piece = decoded.length > remaining ? decoded.slice(0, remaining) : decoded
      parts.push(piece)
      total += piece.length
      if (piece.length < decoded.length) {
        truncated = true
        break
      }
    }
  }

  return { text: parts.join('\n'), truncated }
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}
