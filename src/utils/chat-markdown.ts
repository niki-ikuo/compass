/** Safe http(s) / mailto links only for chat markdown rendering. */
export function isSafeChatHref(href: string | undefined | null): boolean {
  if (!href) return false
  const trimmed = href.trim()
  if (!/^(https?:|mailto:)/i.test(trimmed)) return false
  try {
    const url = new URL(trimmed)
    return url.protocol === 'http:' || url.protocol === 'https:' || url.protocol === 'mailto:'
  } catch {
    return false
  }
}

const STRUCTURED_MENTION_RE = /@\[([^\]\n]+)\]/g

export interface ChatMarkdownTextPiece {
  type: 'text' | 'path'
  content: string
}

/** Split plain text on `@[path]` mentions (backticks are handled by the markdown lexer). */
export function splitStructuredPathMentions(text: string): ChatMarkdownTextPiece[] {
  const pieces: ChatMarkdownTextPiece[] = []
  let lastIndex = 0
  STRUCTURED_MENTION_RE.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = STRUCTURED_MENTION_RE.exec(text)) !== null) {
    if (match.index > lastIndex) {
      pieces.push({ type: 'text', content: text.slice(lastIndex, match.index) })
    }
    pieces.push({ type: 'path', content: match[1] })
    lastIndex = match.index + match[0].length
  }
  if (lastIndex < text.length) {
    pieces.push({ type: 'text', content: text.slice(lastIndex) })
  }
  return pieces.length > 0 ? pieces : [{ type: 'text', content: text }]
}
