import {
  extractMarkdownSummary,
  parseMarkdownHeadings
} from './markdown-outline'

export interface TextChunk {
  id: string
  path: string
  heading?: string
  startLine: number
  endLine: number
  text: string
  summary: string
}

const MAX_CHUNKS_PER_FILE = 60
const MAX_CHUNK_CHARS = 2400
const LINE_WINDOW = 40
const LINE_OVERLAP = 8
const SNIPPET_CHARS = 240

export function snippetFromText(text: string, maxChars = SNIPPET_CHARS): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  if (!flat) return ''
  if (flat.length <= maxChars) return flat
  return `${flat.slice(0, Math.max(1, maxChars - 1))}…`
}

/** Split workspace file content into searchable chunks (ignore rules applied by caller). */
export function chunkFileContent(
  relativePath: string,
  content: string,
  language: string
): TextChunk[] {
  const normalized = relativePath.replace(/\\/g, '/')
  if (language === 'markdown') {
    return chunkMarkdown(normalized, content).slice(0, MAX_CHUNKS_PER_FILE)
  }
  return chunkByLines(normalized, content).slice(0, MAX_CHUNKS_PER_FILE)
}

function chunkMarkdown(path: string, content: string): TextChunk[] {
  const lines = content.split(/\r?\n/)
  const headings = parseMarkdownHeadings(content)
  const chunks: TextChunk[] = []

  if (headings.length === 0) {
    return chunkByLines(path, content)
  }

  // Preamble before first heading
  if (headings[0].line > 1) {
    const body = lines.slice(0, headings[0].line - 1).join('\n').trim()
    if (body) {
      chunks.push(
        makeChunk(path, chunks.length, undefined, 1, headings[0].line - 1, body)
      )
    }
  }

  for (let i = 0; i < headings.length; i++) {
    const start = headings[i]
    let endExclusive = lines.length
    for (let j = i + 1; j < headings.length; j++) {
      if (headings[j].level <= start.level) {
        endExclusive = headings[j].line - 1
        break
      }
    }
    const body = lines.slice(start.line - 1, endExclusive).join('\n').trim()
    if (!body) continue
    chunks.push(
      makeChunk(path, chunks.length, start.text, start.line, endExclusive, body)
    )
  }

  return chunks
}

function chunkByLines(path: string, content: string): TextChunk[] {
  const lines = content.split(/\r?\n/)
  if (lines.length === 0) return []

  const chunks: TextChunk[] = []
  let start = 0
  while (start < lines.length && chunks.length < MAX_CHUNKS_PER_FILE) {
    const end = Math.min(lines.length, start + LINE_WINDOW)
    const body = lines.slice(start, end).join('\n').trim()
    if (body) {
      chunks.push(makeChunk(path, chunks.length, undefined, start + 1, end, body))
    }
    if (end >= lines.length) break
    start = Math.max(start + 1, end - LINE_OVERLAP)
  }
  return chunks
}

function makeChunk(
  path: string,
  index: number,
  heading: string | undefined,
  startLine: number,
  endLine: number,
  text: string
): TextChunk {
  const clipped =
    text.length > MAX_CHUNK_CHARS
      ? `${text.slice(0, MAX_CHUNK_CHARS)}…`
      : text
  const summary =
    extractMarkdownSummary(clipped, 160) || snippetFromText(clipped, 160)
  return {
    id: `${path}#${index}`,
    path,
    heading,
    startLine,
    endLine,
    text: clipped,
    summary
  }
}
