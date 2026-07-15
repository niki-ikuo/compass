import type { ChatMessage, ChatMode, ChatSession } from '@/types'
import { normalizeChatMode } from '@/types'

/** 全セッションから、最も最近送信された user メッセージのモードを返す */
export function resolveLastSentChatMode(
  sessions: Array<Pick<ChatSession, 'messages'>>
): ChatMode | undefined {
  let best: { mode: ChatMode; timestamp: number } | undefined

  for (const session of sessions) {
    for (const message of session.messages) {
      const mode = modeFromUserMessage(message)
      if (!mode) continue
      if (!best || message.timestamp >= best.timestamp) {
        best = { mode, timestamp: message.timestamp }
      }
    }
  }

  return best?.mode
}

function modeFromUserMessage(message: ChatMessage): ChatMode | undefined {
  if (message.role !== 'user') return undefined
  return normalizeChatMode(message.mode)
}
