import { describe, expect, it } from 'vitest'
import { withOpenWebUiChatCompat } from './open-webui-compat'

describe('withOpenWebUiChatCompat', () => {
  it('returns the same object when disabled', () => {
    const body = { model: 'llama', messages: [], stream: true }
    const next = withOpenWebUiChatCompat(body, false)
    expect(next).toBe(body)
    expect(next).not.toHaveProperty('chat_id')
    expect(next).not.toHaveProperty('parent_id')
  })

  it('adds chat_id and parent_id when enabled', () => {
    const body = { model: 'llama', messages: [], stream: true }
    const next = withOpenWebUiChatCompat(body, true)
    expect(next).toEqual({
      model: 'llama',
      messages: [],
      stream: true,
      chat_id: '',
      parent_id: null
    })
    expect(next).not.toBe(body)
  })

  it('does not overwrite existing chat_id / parent_id when enabled', () => {
    const body = {
      model: 'x',
      chat_id: 'local:abc',
      parent_id: 'p1' as string | null
    }
    const next = withOpenWebUiChatCompat(body, true)
    expect(next.chat_id).toBe('local:abc')
    expect(next.parent_id).toBe('p1')
  })
})
