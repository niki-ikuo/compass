import type { ChatContextRef } from '@/types'

export const CHAT_CONTEXT_DRAG_MIME = 'application/x-compass-context-ref'

export function toChatContextRef(node: {
  path: string
  name: string
  isDirectory: boolean
}): ChatContextRef {
  return {
    path: node.path,
    name: node.name,
    isDirectory: node.isDirectory
  }
}

function isChatContextRef(value: unknown): value is ChatContextRef {
  if (!value || typeof value !== 'object') return false
  const ref = value as ChatContextRef
  return (
    typeof ref.path === 'string' &&
    typeof ref.name === 'string' &&
    typeof ref.isDirectory === 'boolean'
  )
}

export function serializeChatContextRefs(refs: ChatContextRef[]): string {
  return JSON.stringify(refs)
}

export function serializeChatContextRef(ref: ChatContextRef): string {
  return serializeChatContextRefs([ref])
}

export function parseChatContextRefs(dataTransfer: DataTransfer): ChatContextRef[] {
  const raw = dataTransfer.getData(CHAT_CONTEXT_DRAG_MIME)
  if (!raw) return []

  try {
    const parsed: unknown = JSON.parse(raw)
    const items = Array.isArray(parsed) ? parsed : [parsed]
    return items.filter(isChatContextRef)
  } catch {
    return []
  }
}

export function parseChatContextRef(dataTransfer: DataTransfer): ChatContextRef | null {
  return parseChatContextRefs(dataTransfer)[0] ?? null
}

export function hasChatContextDrag(dataTransfer: DataTransfer): boolean {
  return dataTransfer.types.includes(CHAT_CONTEXT_DRAG_MIME)
}
