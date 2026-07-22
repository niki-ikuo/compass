import type { ChatSelectionRef } from '@/types'
import {
  detectMentionKind,
  formatSelectionMentionLabel,
  isStructuredMention
} from '@/utils/chat-mentions'

export const CHAT_SELECTION_DRAG_MIME = 'application/x-compass-selection-ref'

export interface ChatSelectionDragPayload {
  path: string
  startLine: number
  endLine: number
  text: string
  mention: string
}

/** Monaco の行末選択（次行 col1）を実選択行に正規化 */
export function normalizeSelectionLines(sel: {
  startLine: number
  endLine: number
  endColumn: number
}): { startLine: number; endLine: number } {
  let endLine = sel.endLine
  if (sel.endColumn === 1 && endLine > sel.startLine) {
    endLine -= 1
  }
  return { startLine: sel.startLine, endLine }
}

export function toRelativeLabel(path: string, workspaceRoot: string | null): string {
  if (!workspaceRoot) return path.replace(/\\/g, '/')
  const root = workspaceRoot.replace(/\\/g, '/').replace(/\/$/, '')
  const normalized = path.replace(/\\/g, '/')
  const underRoot =
    typeof process !== 'undefined' && process.platform === 'win32'
      ? normalized.toLowerCase() === root.toLowerCase() ||
        normalized.toLowerCase().startsWith(`${root.toLowerCase()}/`)
      : normalized === root || normalized.startsWith(`${root}/`)
  if (underRoot) {
    if (
      typeof process !== 'undefined' && process.platform === 'win32'
        ? normalized.toLowerCase() === root.toLowerCase()
        : normalized === root
    ) {
      return normalized
    }
    return normalized.slice(root.length).replace(/^\//, '') || normalized
  }
  return normalized
}

export function buildSelectionMention(
  path: string,
  startLine: number,
  endLine: number,
  workspaceRoot: string | null
): string {
  return formatSelectionMentionLabel(toRelativeLabel(path, workspaceRoot), startLine, endLine)
}

export function buildSelectionDragPayload(input: {
  path: string
  startLine: number
  endLine: number
  endColumn?: number
  text: string
  workspaceRoot: string | null
}): ChatSelectionDragPayload {
  const { startLine, endLine } = normalizeSelectionLines({
    startLine: input.startLine,
    endLine: input.endLine,
    endColumn: input.endColumn ?? 1
  })

  return {
    path: input.path,
    startLine,
    endLine,
    text: input.text,
    mention: buildSelectionMention(input.path, startLine, endLine, input.workspaceRoot)
  }
}

export function toChatSelectionRef(payload: ChatSelectionDragPayload): ChatSelectionRef {
  return {
    path: payload.path,
    startLine: payload.startLine,
    endLine: payload.endLine,
    text: payload.text
  }
}

export function serializeChatSelectionDrag(payload: ChatSelectionDragPayload): string {
  return JSON.stringify(payload)
}

export function parseChatSelectionDrag(dataTransfer: DataTransfer): ChatSelectionDragPayload | null {
  const raw = dataTransfer.getData(CHAT_SELECTION_DRAG_MIME)
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as ChatSelectionDragPayload
      if (
        typeof parsed.path === 'string' &&
        typeof parsed.startLine === 'number' &&
        typeof parsed.endLine === 'number' &&
        typeof parsed.text === 'string' &&
        typeof parsed.mention === 'string'
      ) {
        return parsed
      }
    } catch {
      // fall through to text/plain
    }
  }

  const plain = dataTransfer.getData('text/plain')?.trim()
  if (!plain) return null

  const mentionMatch = plain.match(/^@\[([^\]]+)\]$/)
  if (!mentionMatch || !isStructuredMention(mentionMatch[1])) return null
  if (detectMentionKind(mentionMatch[1]) !== 'selection') return null

  const inner = mentionMatch[1]
  const rangeMatch = inner.match(/^(.*):(\d+)(?:-(\d+))?$/)
  if (!rangeMatch) return null

  const startLine = Number(rangeMatch[2])
  const endLine = rangeMatch[3] ? Number(rangeMatch[3]) : startLine

  return {
    path: rangeMatch[1],
    startLine,
    endLine,
    text: '',
    mention: plain
  }
}

export function hasChatSelectionDrag(dataTransfer: DataTransfer): boolean {
  return dataTransfer.types.includes(CHAT_SELECTION_DRAG_MIME)
}

/** 通常コピー用: 他アプリにはコード本文、Compass 内では選択メタデータを保持 */
let lastCopiedSelection: ChatSelectionDragPayload | null = null

export function rememberCopiedSelection(payload: ChatSelectionDragPayload): void {
  lastCopiedSelection = payload
}

export function getLastCopiedSelection(): ChatSelectionDragPayload | null {
  return lastCopiedSelection
}

export function writeSelectionClipboard(
  dataTransfer: DataTransfer,
  payload: ChatSelectionDragPayload
): void {
  rememberCopiedSelection(payload)
  dataTransfer.setData(CHAT_SELECTION_DRAG_MIME, serializeChatSelectionDrag(payload))
  // 他エディタ向けには通常のコード本文
  dataTransfer.setData('text/plain', payload.text)
}

/**
 * チャット貼り付け時: カスタム MIME → 直前コピー → 完全一致の順で選択参照を復元
 */
export function resolveSelectionFromClipboard(
  dataTransfer: DataTransfer,
  options?: {
    liveSelectionText?: string | null
    livePayload?: ChatSelectionDragPayload | null
  }
): ChatSelectionDragPayload | null {
  const raw = dataTransfer.getData(CHAT_SELECTION_DRAG_MIME)
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as ChatSelectionDragPayload
      if (
        typeof parsed.path === 'string' &&
        typeof parsed.startLine === 'number' &&
        typeof parsed.endLine === 'number' &&
        typeof parsed.text === 'string' &&
        typeof parsed.mention === 'string'
      ) {
        return parsed
      }
    } catch {
      // continue
    }
  }

  const plain = dataTransfer.getData('text/plain')
  if (!plain) return null

  // 単一行の短い @[...] だけメンション復元の対象。大量ペーストでは trim/比較を避ける。
  if (plain.length <= 300 && !plain.includes('\n')) {
    const trimmed = plain.trim()
    const mentionMatch = trimmed.match(/^@\[([^\]]+)\]$/)
    if (mentionMatch && isStructuredMention(mentionMatch[1])) {
      const inner = mentionMatch[1]
      if (detectMentionKind(inner) === 'selection') {
        const rangeMatch = inner.match(/^(.*):(\d+)(?:-(\d+))?$/)
        if (rangeMatch) {
          const startLine = Number(rangeMatch[2])
          const endLine = rangeMatch[3] ? Number(rangeMatch[3]) : startLine
          return {
            path: rangeMatch[1],
            startLine,
            endLine,
            text: '',
            mention: trimmed
          }
        }
      }
    }
  }

  const last = lastCopiedSelection
  if (last && last.text.length === plain.length && last.text === plain) {
    const substantial = plain.length >= 40 || plain.includes('\n')
    const stillSelected = options?.liveSelectionText === plain
    if (substantial || stillSelected) {
      return last
    }
  }

  if (
    options?.livePayload &&
    options.liveSelectionText &&
    options.liveSelectionText.length === plain.length &&
    options.liveSelectionText === plain
  ) {
    return options.livePayload
  }

  return null
}

