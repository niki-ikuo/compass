import iconv from 'iconv-lite'

export type FileEncoding =
  | 'utf8'
  | 'utf8bom'
  | 'shiftjis'
  | 'eucjp'
  | 'utf16le'
  | 'utf16be'
  | 'windows1252'

export interface DecodedFile {
  content: string
  encoding: FileEncoding
}

export const FILE_ENCODINGS: Array<{ id: FileEncoding; label: string }> = [
  { id: 'utf8', label: 'UTF-8' },
  { id: 'utf8bom', label: 'UTF-8 with BOM' },
  { id: 'shiftjis', label: 'Shift_JIS' },
  { id: 'eucjp', label: 'EUC-JP' },
  { id: 'utf16le', label: 'UTF-16 LE' },
  { id: 'utf16be', label: 'UTF-16 BE' },
  { id: 'windows1252', label: 'Windows-1252' }
]

const ICONV_NAMES: Record<FileEncoding, string> = {
  utf8: 'utf8',
  utf8bom: 'utf8',
  shiftjis: 'CP932',
  eucjp: 'EUC-JP',
  utf16le: 'UTF-16LE',
  utf16be: 'UTF-16BE',
  windows1252: 'windows-1252'
}

const UTF8_BOM = Buffer.from([0xef, 0xbb, 0xbf])
const UTF16LE_BOM = Buffer.from([0xff, 0xfe])
const UTF16BE_BOM = Buffer.from([0xfe, 0xff])

function detectBom(buffer: Buffer): FileEncoding | null {
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return 'utf8bom'
  }
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return 'utf16le'
  }
  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    return 'utf16be'
  }
  return null
}

function stripBom(buffer: Buffer, encoding: FileEncoding): Buffer {
  if (encoding === 'utf8bom' && buffer.length >= 3) return buffer.subarray(3)
  if ((encoding === 'utf16le' || encoding === 'utf16be') && buffer.length >= 2) {
    if (
      (encoding === 'utf16le' && buffer[0] === 0xff && buffer[1] === 0xfe) ||
      (encoding === 'utf16be' && buffer[0] === 0xfe && buffer[1] === 0xff)
    ) {
      return buffer.subarray(2)
    }
  }
  return buffer
}

function isValidUtf8(buffer: Buffer): boolean {
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(buffer)
    return true
  } catch {
    return false
  }
}

function scoreDecodedText(text: string): number {
  let score = 0
  let replacements = 0
  let controlChars = 0

  for (const char of text) {
    const code = char.codePointAt(0) ?? 0
    if (char === '\uFFFD') {
      replacements += 1
      continue
    }
    if (code === 0x09 || code === 0x0a || code === 0x0d) continue
    if (code < 0x20 || code === 0x7f) {
      controlChars += 1
      continue
    }
    // Hiragana / Katakana / CJK / half-width kana
    if (
      (code >= 0x3040 && code <= 0x30ff) ||
      (code >= 0x4e00 && code <= 0x9fff) ||
      (code >= 0xff66 && code <= 0xff9d)
    ) {
      score += 4
    } else if (code > 0x7f) {
      score += 1
    }
  }

  return score - replacements * 80 - controlChars * 20
}

export function decodeBuffer(buffer: Buffer, encoding: FileEncoding): string {
  const payload = stripBom(buffer, encoding)
  if (!iconv.encodingExists(ICONV_NAMES[encoding])) {
    throw new Error(`未対応の文字コードです: ${encoding}`)
  }
  return iconv.decode(payload, ICONV_NAMES[encoding])
}

export function encodeContent(content: string, encoding: FileEncoding): Buffer {
  if (!iconv.encodingExists(ICONV_NAMES[encoding])) {
    throw new Error(`未対応の文字コードです: ${encoding}`)
  }

  const body = iconv.encode(content, ICONV_NAMES[encoding])
  if (encoding === 'utf8bom') {
    return Buffer.concat([UTF8_BOM, body])
  }
  if (encoding === 'utf16le') {
    return Buffer.concat([UTF16LE_BOM, body])
  }
  if (encoding === 'utf16be') {
    return Buffer.concat([UTF16BE_BOM, body])
  }
  return body
}

function looksLikeUtf16(buffer: Buffer): boolean {
  if (buffer.length < 4 || buffer.length % 2 !== 0) return false

  let nulEven = 0
  let nulOdd = 0
  const pairs = Math.min(Math.floor(buffer.length / 2), 512)
  for (let i = 0; i < pairs; i++) {
    if (buffer[i * 2] === 0) nulEven += 1
    if (buffer[i * 2 + 1] === 0) nulOdd += 1
  }

  // ASCII-heavy UTF-16 has many NUL bytes on one side
  return nulEven / pairs > 0.25 || nulOdd / pairs > 0.25
}

export function detectEncoding(buffer: Buffer): FileEncoding {
  if (buffer.length === 0) return 'utf8'

  const bom = detectBom(buffer)
  if (bom) return bom

  // Valid UTF-8 wins unless the content is clearly better as something else
  if (isValidUtf8(buffer)) {
    const utf8Text = decodeBuffer(buffer, 'utf8')
    const utf8Score = scoreDecodedText(utf8Text) + 8

    // Only compare against Japanese legacy encodings when UTF-8 looks suspicious
    if (!utf8Text.includes('\uFFFD') && scoreDecodedText(utf8Text) >= 0) {
      return 'utf8'
    }

    let bestEncoding: FileEncoding = 'utf8'
    let bestScore = utf8Score
    for (const encoding of ['shiftjis', 'eucjp'] as const) {
      try {
        const score = scoreDecodedText(decodeBuffer(buffer, encoding))
        if (score > bestScore) {
          bestScore = score
          bestEncoding = encoding
        }
      } catch {
        // skip
      }
    }
    return bestEncoding
  }

  const candidates: FileEncoding[] = ['shiftjis', 'eucjp', 'windows1252']
  if (looksLikeUtf16(buffer)) {
    candidates.push('utf16le', 'utf16be')
  }

  let bestEncoding: FileEncoding = 'shiftjis'
  let bestScore = Number.NEGATIVE_INFINITY

  for (const encoding of candidates) {
    try {
      const score = scoreDecodedText(decodeBuffer(buffer, encoding))
      if (score > bestScore) {
        bestScore = score
        bestEncoding = encoding
      }
    } catch {
      // skip
    }
  }

  return bestEncoding
}

export function decodeFileBuffer(buffer: Buffer, encoding?: FileEncoding): DecodedFile {
  const resolved = encoding ?? detectEncoding(buffer)
  return {
    content: decodeBuffer(buffer, resolved),
    encoding: resolved
  }
}

export function getEncodingLabel(encoding: FileEncoding): string {
  return FILE_ENCODINGS.find((item) => item.id === encoding)?.label ?? encoding
}
