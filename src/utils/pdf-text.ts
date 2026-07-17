import { inflateSync } from 'zlib'

/**
 * Best-effort PDF text extraction without a full PDF library.
 * Works for many simple / FlateDecode text PDFs; scanned or CID-heavy
 * documents may yield little or no text.
 */
export function extractPdfText(buffer: Buffer, maxChars: number): {
  text: string
  truncated: boolean
} {
  if (buffer.length < 5 || buffer.subarray(0, 5).toString('latin1') !== '%PDF-') {
    return { text: '', truncated: false }
  }

  const chunks: string[] = []
  let total = 0
  let truncated = false

  const push = (raw: string): boolean => {
    const cleaned = cleanupPdfFragment(raw)
    if (!cleaned) return true
    const remaining = maxChars - total
    if (remaining <= 0) {
      truncated = true
      return false
    }
    if (cleaned.length > remaining) {
      chunks.push(cleaned.slice(0, remaining))
      total = maxChars
      truncated = true
      return false
    }
    chunks.push(cleaned)
    total += cleaned.length
    return true
  }

  // Inflate / read content streams and pull strings from them
  const latin = buffer.toString('latin1')
  const streamRe = /stream\r?\n([\s\S]*?)endstream/g
  let match: RegExpExecArray | null
  while ((match = streamRe.exec(latin)) !== null) {
    const rawStream = match[1]
    const headerStart = Math.max(0, match.index - 200)
    const header = latin.slice(headerStart, match.index)
    let payload: Buffer
    try {
      const bytes = Buffer.from(rawStream.replace(/^\r?\n/, '').replace(/\r?\n$/, ''), 'latin1')
      payload = /\/FlateDecode/.test(header) ? inflateSync(bytes) : bytes
    } catch {
      continue
    }
    if (!extractLiteralStrings(payload.toString('latin1'), push)) {
      break
    }
  }

  return { text: chunks.join('\n'), truncated }
}

function extractLiteralStrings(source: string, push: (s: string) => boolean): boolean {
  // PDF literal strings: ( ... ) with basic escape handling
  const re = /\((?:\\.|[^\\)])*\)/g
  let match: RegExpExecArray | null
  while ((match = re.exec(source)) !== null) {
    const inner = match[0].slice(1, -1)
    const decoded = decodePdfLiteral(inner)
    if (!push(decoded)) return false
  }

  // Hex strings: <48656C6C6F>
  const hexRe = /<([0-9A-Fa-f \r\n]+)>/g
  while ((match = hexRe.exec(source)) !== null) {
    const hex = match[1].replace(/\s+/g, '')
    if (hex.length < 2 || hex.length % 2 !== 0) continue
    try {
      const decoded = Buffer.from(hex, 'hex').toString('utf8')
      if (!push(decoded)) return false
    } catch {
      // ignore invalid hex
    }
  }

  return true
}

function decodePdfLiteral(input: string): string {
  return input
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
    .replace(/\\([0-7]{1,3})/g, (_, oct: string) =>
      String.fromCharCode(parseInt(oct, 8))
    )
    .replace(/\\([()\\])/g, '$1')
}

function cleanupPdfFragment(raw: string): string {
  const text = raw.replace(/\0/g, '').replace(/[^\S\n]+/g, ' ').trim()
  if (!text) return ''
  // Drop fragments that are almost entirely non-printable / control
  const printable = text.replace(/[^\x20-\x7E\u3040-\u30FF\u3400-\u9FFF\n]/g, '')
  if (printable.length < Math.min(2, text.length) && printable.length / Math.max(text.length, 1) < 0.4) {
    return ''
  }
  return text
}
