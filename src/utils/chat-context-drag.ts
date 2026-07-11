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

export function serializeChatContextRef(ref: ChatContextRef): string {
  return JSON.stringify(ref)
}

export function parseChatContextRef(dataTransfer: DataTransfer): ChatContextRef | null {
  const raw = dataTransfer.getData(CHAT_CONTEXT_DRAG_MIME)
  if (!raw) return null

  try {
    const parsed = JSON.parse(raw) as ChatContextRef
    if (
      typeof parsed.path === 'string' &&
      typeof parsed.name === 'string' &&
      typeof parsed.isDirectory === 'boolean'
    ) {
      return parsed
    }
  } catch {
    // ignore
  }
  return null
}

export function hasChatContextDrag(dataTransfer: DataTransfer): boolean {
  return dataTransfer.types.includes(CHAT_CONTEXT_DRAG_MIME)
}
