import { describe, expect, it } from 'vitest'
import { resolveLastSentChatMode } from '@/utils/chat-mode'
import type { ChatMessage } from '@/types'

function user(mode: ChatMessage['mode'], timestamp: number): ChatMessage {
  return {
    id: `u-${timestamp}`,
    role: 'user',
    content: 'hi',
    timestamp,
    ...(mode ? { mode } : {})
  }
}

function assistant(timestamp: number): ChatMessage {
  return {
    id: `a-${timestamp}`,
    role: 'assistant',
    content: 'ok',
    timestamp
  }
}

describe('resolveLastSentChatMode', () => {
  it('returns undefined when there are no user messages with mode', () => {
    expect(resolveLastSentChatMode([])).toBeUndefined()
    expect(
      resolveLastSentChatMode([
        { messages: [assistant(1), user(undefined, 2)] }
      ])
    ).toBeUndefined()
  })

  it('returns the mode from the most recent user send across sessions', () => {
    expect(
      resolveLastSentChatMode([
        {
          messages: [user('edit', 10), assistant(11), user('ask', 20)]
        },
        {
          messages: [user('agent', 15)]
        }
      ])
    ).toBe('ask')
  })

  it('ignores assistant messages when picking the latest mode', () => {
    expect(
      resolveLastSentChatMode([
        {
          messages: [user('ask', 5), assistant(100)]
        }
      ])
    ).toBe('ask')
  })
})
