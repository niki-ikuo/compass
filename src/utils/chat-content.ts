import { CODE_FENCE_REGEX } from './code-fence'
import { getWorkspaceActionsLabel } from '@/utils/workspace-actions'
import { detectMentionKind, isStructuredMention } from '@/utils/chat-mentions'
import { t } from '../i18n/runtime'

export interface ChatTextSegment {
  type: 'text'
  content: string
}

export interface ChatCodeSegment {
  type: 'code'
  language: string
  code: string
  label: string
  meta: string
  isActions?: boolean
}

export type ChatSegment = ChatTextSegment | ChatCodeSegment

function inferFilePath(language: string, code: string): string | null {
  const langPath = language.match(/^[\w+-]+[:/](.+)$/)
  if (langPath) return langPath[1].replace(/\\/g, '/').trim()

  const firstLine = code.split('\n')[0]?.trim() ?? ''
  // スペース・Unicode を含むパスを許可（旧 [\w./\\-]+ では落ちる）
  const fileComment = firstLine.match(
    /^(?:\/\/|#|<!--)\s*(?:file:|filename:)?\s*(.+?\.\w{1,12})\s*(?:-->)?$/i
  )
  if (fileComment) return fileComment[1].replace(/\\/g, '/').trim()

  return null
}

function getActionsLabel(code: string): { label: string; meta: string } {
  return getWorkspaceActionsLabel(code)
}

function getCodeLabel(language: string, code: string): { label: string; meta: string } {
  const lang = language.toLowerCase()

  if (lang === 'compass-actions') {
    return getActionsLabel(code)
  }

  const lines = code.split('\n').length
  const filePath = inferFilePath(language, code)
  const langLabel = language.split(':')[0] || 'code'

  if (filePath) {
    return { label: filePath, meta: `${langLabel} · ${t('common.lines', { count: lines })}` }
  }

  return { label: langLabel, meta: t('common.lines', { count: lines }) }
}

export function parseChatSegments(content: string): ChatSegment[] {
  const segments: ChatSegment[] = []
  let lastIndex = 0
  let match: RegExpExecArray | null

  CODE_FENCE_REGEX.lastIndex = 0
  while ((match = CODE_FENCE_REGEX.exec(content)) !== null) {
    const before = content.slice(lastIndex, match.index).trim()
    if (before) {
      segments.push({ type: 'text', content: before })
    }

    const language = match[1] || 'plaintext'
    const code = match[2].trimEnd()
    const { label, meta } = getCodeLabel(language, code)

    segments.push({
      type: 'code',
      language,
      code,
      label,
      meta,
      isActions: language.toLowerCase() === 'compass-actions'
    })

    lastIndex = match.index + match[0].length
  }

  const tail = content.slice(lastIndex).trim()
  if (tail) {
    segments.push({ type: 'text', content: tail })
  }

  return segments
}

export { getCodeLabel }

export type InlineChatPart =
  | { type: 'text'; content: string }
  | { type: 'path'; content: string; kind: 'file' | 'folder' | 'selection' }
  | { type: 'code'; content: string }

/** バッククォート内がファイル/フォルダ/選択行の参照かどうか */
export function isPathMention(text: string): boolean {
  return isStructuredMention(text)
}

function pathMentionKind(text: string): 'file' | 'folder' | 'selection' {
  return detectMentionKind(text)
}

interface InlineMatch {
  start: number
  end: number
  part: InlineChatPart
}

/** テキスト内の `@[path]` とバッククォート参照を分割 */
export function parseInlineChatParts(text: string): InlineChatPart[] {
  const matches: InlineMatch[] = []

  const structuredRe = /@\[([^\]\n]+)\]/g
  let match: RegExpExecArray | null
  while ((match = structuredRe.exec(text)) !== null) {
    const inner = match[1]
    if (!isStructuredMention(inner)) continue
    matches.push({
      start: match.index,
      end: match.index + match[0].length,
      part: { type: 'path', content: inner, kind: pathMentionKind(inner) }
    })
  }

  const backtickRe = /`([^`\n]+)`/g
  while ((match = backtickRe.exec(text)) !== null) {
    const start = match.index
    const end = start + match[0].length
    if (matches.some((m) => start < m.end && end > m.start)) continue

    const inner = match[1]
    if (isPathMention(inner)) {
      matches.push({
        start,
        end,
        part: { type: 'path', content: inner, kind: pathMentionKind(inner) }
      })
    } else {
      matches.push({
        start,
        end,
        part: { type: 'code', content: inner }
      })
    }
  }

  matches.sort((a, b) => a.start - b.start)

  const parts: InlineChatPart[] = []
  let lastIndex = 0
  for (const item of matches) {
    if (item.start > lastIndex) {
      parts.push({ type: 'text', content: text.slice(lastIndex, item.start) })
    }
    parts.push(item.part)
    lastIndex = item.end
  }

  if (lastIndex < text.length) {
    parts.push({ type: 'text', content: text.slice(lastIndex) })
  }

  return parts.length > 0 ? parts : [{ type: 'text', content: text }]
}

export function hasOpenCodeFence(content: string): boolean {
  const fences = content.match(/```/g)
  return fences !== null && fences.length % 2 === 1
}

export function splitStreamingContent(content: string): {
  complete: string
  streamingCode: { language: string; code: string } | null
} {
  if (!hasOpenCodeFence(content)) {
    return { complete: content, streamingCode: null }
  }

  const lastFence = content.lastIndexOf('```')
  const complete = content.slice(0, lastFence)
  const after = content.slice(lastFence + 3)
  const newline = after.indexOf('\n')
  const language = newline >= 0 ? after.slice(0, newline).trim() : after.trim()
  const code = newline >= 0 ? after.slice(newline + 1) : ''

  return { complete, streamingCode: { language, code } }
}
