import { inflateRawSync } from 'zlib'

/**
 * Best-effort .docx text extraction without a full Office library.
 * Reads `word/document.xml` from the ZIP and collects `w:t` runs.
 * Legacy `.doc` / complex OLE packages are not supported.
 */
export function extractDocxText(
  buffer: Buffer,
  maxChars: number
): { text: string; truncated: boolean } {
  if (buffer.length < 4 || buffer.readUInt32LE(0) !== 0x04034b50) {
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

/** Read one stored/deflated ZIP entry by exact path (forward slashes). */
function readZipEntry(buffer: Buffer, entryName: string): Buffer | null {
  const eocd = findEndOfCentralDirectory(buffer)
  if (!eocd) return null

  const entryCount = buffer.readUInt16LE(eocd + 10)
  let offset = buffer.readUInt32LE(eocd + 16)

  for (let i = 0; i < entryCount; i++) {
    if (offset + 46 > buffer.length) return null
    if (buffer.readUInt32LE(offset) !== 0x02014b50) return null

    const compression = buffer.readUInt16LE(offset + 10)
    const compressedSize = buffer.readUInt32LE(offset + 20)
    const nameLen = buffer.readUInt16LE(offset + 28)
    const extraLen = buffer.readUInt16LE(offset + 30)
    const commentLen = buffer.readUInt16LE(offset + 32)
    const localHeaderOffset = buffer.readUInt32LE(offset + 42)
    const nameStart = offset + 46
    const name = buffer.subarray(nameStart, nameStart + nameLen).toString('utf8')
    offset = nameStart + nameLen + extraLen + commentLen

    if (name !== entryName) continue
    return inflateZipLocalEntry(buffer, localHeaderOffset, compression, compressedSize)
  }

  return null
}

function findEndOfCentralDirectory(buffer: Buffer): number | null {
  // EOCD is at the end; comment may be up to 64KiB.
  const min = Math.max(0, buffer.length - (22 + 0xffff))
  for (let i = buffer.length - 22; i >= min; i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) return i
  }
  return null
}

function inflateZipLocalEntry(
  buffer: Buffer,
  localHeaderOffset: number,
  compression: number,
  compressedSize: number
): Buffer | null {
  if (localHeaderOffset + 30 > buffer.length) return null
  if (buffer.readUInt32LE(localHeaderOffset) !== 0x04034b50) return null

  const nameLen = buffer.readUInt16LE(localHeaderOffset + 26)
  const extraLen = buffer.readUInt16LE(localHeaderOffset + 28)
  const dataStart = localHeaderOffset + 30 + nameLen + extraLen
  const dataEnd = dataStart + compressedSize
  if (dataEnd > buffer.length) return null

  const compressed = buffer.subarray(dataStart, dataEnd)
  if (compression === 0) return Buffer.from(compressed)
  if (compression === 8) {
    try {
      return inflateRawSync(compressed)
    } catch {
      return null
    }
  }
  return null
}
