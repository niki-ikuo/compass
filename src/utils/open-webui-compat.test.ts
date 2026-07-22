import { describe, expect, it } from 'vitest'
import { isOpenWebUiBaseUrl, withOpenWebUiChatCompat } from './open-webui-compat'

describe('isOpenWebUiBaseUrl', () => {
  it('matches typical Open WebUI bases', () => {
    expect(isOpenWebUiBaseUrl('http://localhost:3000/api')).toBe(true)
    expect(isOpenWebUiBaseUrl('http://localhost:3000/api/')).toBe(true)
    expect(isOpenWebUiBaseUrl('http://127.0.0.1:8080/api/v1')).toBe(true)
    expect(isOpenWebUiBaseUrl('https://ai.example.com/api/v1/')).toBe(true)
  })

  it('matches open-webui hostnames regardless of path', () => {
    expect(isOpenWebUiBaseUrl('https://open-webui.example.com/v1')).toBe(true)
    expect(isOpenWebUiBaseUrl('http://my-open-webui.local')).toBe(true)
  })

  it('rejects common non-Open-WebUI bases', () => {
    expect(isOpenWebUiBaseUrl('https://api.openai.com/v1')).toBe(false)
    expect(isOpenWebUiBaseUrl('http://localhost:11434/v1')).toBe(false)
    expect(isOpenWebUiBaseUrl('https://api.groq.com/openai/v1')).toBe(false)
    expect(isOpenWebUiBaseUrl('https://openrouter.ai/api/v1')).toBe(false)
    expect(isOpenWebUiBaseUrl('https://api.deepseek.com')).toBe(false)
    expect(isOpenWebUiBaseUrl('')).toBe(false)
    expect(isOpenWebUiBaseUrl('not-a-url')).toBe(false)
  })
})

describe('withOpenWebUiChatCompat', () => {
  it('adds chat_id and parent_id for Open WebUI bases', () => {
    const body = { model: 'llama', messages: [], stream: true }
    const next = withOpenWebUiChatCompat(body, 'http://localhost:3000/api')
    expect(next).toEqual({
      model: 'llama',
      messages: [],
      stream: true,
      chat_id: '',
      parent_id: null
    })
    expect(next).not.toBe(body)
  })

  it('does not overwrite existing chat_id / parent_id', () => {
    const body = {
      model: 'x',
      chat_id: 'local:abc',
      parent_id: 'p1' as string | null
    }
    const next = withOpenWebUiChatCompat(body, 'http://localhost:3000/api/v1')
    expect(next.chat_id).toBe('local:abc')
    expect(next.parent_id).toBe('p1')
  })

  it('returns the same object for non-Open-WebUI bases', () => {
    const body = { model: 'gpt-4o-mini', messages: [] }
    const next = withOpenWebUiChatCompat(body, 'https://api.openai.com/v1')
    expect(next).toBe(body)
    expect(next).not.toHaveProperty('chat_id')
  })
})
