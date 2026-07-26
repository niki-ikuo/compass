import { isZipBuffer, listZipEntryNames, readZipEntry } from './office-zip'

/**
 * Best-effort .xlsx text extraction without a spreadsheet library.
 * Reads shared strings + worksheet cells into TSV-like sheet blocks.
 * Legacy `.xls` / macros-only packages are not supported.
 */
export function extractXlsxText(
  buffer: Buffer,
  maxChars: number
): { text: string; truncated: boolean } {
  if (!isZipBuffer(buffer)) {
    return { text: '', truncated: false }
  }

  const sharedStrings = parseSharedStrings(
    readZipEntry(buffer, 'xl/sharedStrings.xml')?.toString('utf8') ?? ''
  )

  const sheetPaths = listZipEntryNames(buffer)
    .filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(name))
    .sort((a, b) => sheetIndex(a) - sheetIndex(b))

  if (sheetPaths.length === 0) {
    return { text: '', truncated: false }
  }

  const parts: string[] = []
  let total = 0
  let truncated = false

  for (let i = 0; i < sheetPaths.length; i++) {
    const xml = readZipEntry(buffer, sheetPaths[i])?.toString('utf8')
    if (!xml) continue
    const sheetName = `Sheet${i + 1}`
    const body = sheetXmlToTsv(xml, sharedStrings)
    if (!body.trim()) continue

    const block = parts.length === 0 ? `## ${sheetName}\n${body}` : `\n\n## ${sheetName}\n${body}`
    const remaining = maxChars - total
    if (remaining <= 0) {
      truncated = true
      break
    }
    if (block.length > remaining) {
      parts.push(block.slice(0, remaining))
      total += remaining
      truncated = true
      break
    }
    parts.push(block)
    total += block.length
  }

  return { text: parts.join(''), truncated }
}

function sheetIndex(path: string): number {
  const match = path.match(/sheet(\d+)\.xml$/i)
  return match ? Number(match[1]) : 0
}

function parseSharedStrings(xml: string): string[] {
  if (!xml) return []
  const strings: string[] = []
  const siRe = /<si[\s>][\s\S]*?<\/si>/g
  let match: RegExpExecArray | null
  while ((match = siRe.exec(xml)) !== null) {
    const parts: string[] = []
    const textRe = /<t(?:\s[^>]*)?>([^<]*)<\/t>/g
    let textMatch: RegExpExecArray | null
    while ((textMatch = textRe.exec(match[0])) !== null) {
      parts.push(decodeXmlEntities(textMatch[1]))
    }
    strings.push(parts.join(''))
  }
  return strings
}

function sheetXmlToTsv(xml: string, sharedStrings: string[]): string {
  const rows: string[] = []
  const rowRe = /<row\b[^>]*>([\s\S]*?)<\/row>/g
  let rowMatch: RegExpExecArray | null
  while ((rowMatch = rowRe.exec(xml)) !== null) {
    const cells = new Map<number, string>()
    let maxCol = -1
    const cellRe = /<c\b([^>]*)>([\s\S]*?)<\/c>|<c\b([^>]*)\/>/g
    let cellMatch: RegExpExecArray | null
    while ((cellMatch = cellRe.exec(rowMatch[1] ?? '')) !== null) {
      const attrs = cellMatch[1] || cellMatch[3] || ''
      const inner = cellMatch[2] ?? ''
      const ref = attrValue(attrs, 'r')
      const col = ref ? columnIndexFromRef(ref) : maxCol + 1
      if (col < 0) continue
      maxCol = Math.max(maxCol, col)
      const type = attrValue(attrs, 't')
      const raw = inner.match(/<v(?:\s[^>]*)?>([^<]*)<\/v>/)?.[1] ?? ''
      cells.set(col, cellDisplayValue(type, decodeXmlEntities(raw), sharedStrings))
    }
    if (maxCol < 0) continue
    const cols: string[] = []
    for (let c = 0; c <= maxCol; c++) {
      cols.push(cells.get(c) ?? '')
    }
    // Skip fully empty rows
    if (cols.every((c) => !c.trim())) continue
    rows.push(cols.join('\t'))
  }
  return rows.join('\n')
}

function cellDisplayValue(type: string | null, raw: string, sharedStrings: string[]): string {
  if (!raw && type !== 's') return ''
  if (type === 's') {
    const idx = Number(raw)
    if (!Number.isFinite(idx) || idx < 0 || idx >= sharedStrings.length) return ''
    return sharedStrings[idx]
  }
  if (type === 'b') return raw === '1' ? 'TRUE' : 'FALSE'
  if (type === 'inlineStr') return raw
  return raw
}

function attrValue(attrs: string, name: string): string | null {
  const match = attrs.match(new RegExp(`\\b${name}="([^"]*)"`))
  return match ? match[1] : null
}

/** A1 / AA12 → 0-based column index */
function columnIndexFromRef(ref: string): number {
  const match = ref.match(/^([A-Z]+)/i)
  if (!match) return -1
  let n = 0
  for (const ch of match[1].toUpperCase()) {
    n = n * 26 + (ch.charCodeAt(0) - 64)
  }
  return n - 1
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}
