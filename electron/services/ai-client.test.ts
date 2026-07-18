import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WebContents } from 'electron'
import { DEFAULT_SETTINGS } from '../../src/types'
import {
  acquireChatAbortController,
  buildApiHeaders,
  cancelChat,
  cancelInlineCompletion,
  isAbortError,
  releaseChatAbortController,
  sanitizeInlineCompletion,
  sendAiEvent
} from './ai-client'

afterEach(() => {
  cancelChat()
  cancelInlineCompletion()
})

describe('sanitizeInlineCompletion', () => {
  it('unwraps fenced completions and strips cursor markers', () => {
    expect(sanitizeInlineCompletion('```ts\nconst x = 1\n```')).toBe('const x = 1')
    expect(sanitizeInlineCompletion('hello<|cursor|>world')).toBe('helloworld')
  })

  it('empties bare acknowledgements', () => {
    for (const raw of ['OK', 'sure.', 'はい', 'Sorry', 'here you go']) {
      expect(sanitizeInlineCompletion(raw), raw).toBe('')
    }
  })

  it('strips a leading prose sentence before code-like body', () => {
    const raw = 'Here is the rest of the function:\n  return true;'
    expect(sanitizeInlineCompletion(raw)).toBe('  return true;')
  })

  it('preserves indentation and interior newlines', () => {
    expect(sanitizeInlineCompletion('  foo\n    bar\n')).toBe('  foo\n    bar\n')
  })
})

describe('buildApiHeaders', () => {
  it('sets JSON content type and bearer token when present', () => {
    expect(
      buildApiHeaders({
        ...DEFAULT_SETTINGS,
        apiKey: 'sk-test',
        providerId: 'openai'
      })
    ).toEqual({
      'Content-Type': 'application/json',
      Authorization: 'Bearer sk-test'
    })
  })

  it('adds OpenRouter attribution headers', () => {
    const headers = buildApiHeaders({
      ...DEFAULT_SETTINGS,
      providerId: 'openrouter',
      apiKey: 'or-key',
      apiBaseUrl: 'https://openrouter.ai/api/v1'
    })
    expect(headers.Authorization).toBe('Bearer or-key')
    expect(headers['HTTP-Referer']).toBe('https://github.com/compass-editor')
    expect(headers['X-Title']).toBe('Compass')
  })

  it('omits Authorization when api key is empty', () => {
    expect(buildApiHeaders({ ...DEFAULT_SETTINGS, apiKey: '' })).toEqual({
      'Content-Type': 'application/json'
    })
  })
})

describe('chat abort helpers', () => {
  it('acquires a controller and cancels by chatId', () => {
    const controller = acquireChatAbortController('chat-1')
    expect(controller.signal.aborted).toBe(false)
    expect(cancelChat('chat-1')).toBe(true)
    expect(controller.signal.aborted).toBe(true)
    // Controllers stay registered until release; cancel remains effective.
    expect(cancelChat('missing')).toBe(false)
  })

  it('cancelChat without id aborts all active chats', () => {
    const a = acquireChatAbortController('a')
    const b = acquireChatAbortController('b')
    expect(cancelChat()).toBe(true)
    expect(a.signal.aborted).toBe(true)
    expect(b.signal.aborted).toBe(true)
  })

  it('replaces an existing controller for the same chatId', () => {
    const first = acquireChatAbortController('same')
    const second = acquireChatAbortController('same')
    expect(first.signal.aborted).toBe(true)
    expect(second.signal.aborted).toBe(false)
    releaseChatAbortController('same', second)
    expect(cancelChat('same')).toBe(false)
  })

  it('releaseChatAbortController ignores stale controllers', () => {
    const stale = acquireChatAbortController('x')
    const current = acquireChatAbortController('x')
    releaseChatAbortController('x', stale)
    expect(cancelChat('x')).toBe(true)
    expect(current.signal.aborted).toBe(true)
  })
})

describe('isAbortError / sendAiEvent', () => {
  it('detects AbortError by name', () => {
    const err = new Error('aborted')
    err.name = 'AbortError'
    expect(isAbortError(err)).toBe(true)
    expect(isAbortError(new Error('nope'))).toBe(false)
    expect(isAbortError('AbortError')).toBe(false)
  })

  it('prefixes chatId when sending renderer events', () => {
    const send = vi.fn()
    const webContents = { send } as unknown as WebContents
    sendAiEvent(webContents, 'ai:chunk', 'chat-9', 'hello')
    expect(send).toHaveBeenCalledWith('ai:chunk', 'chat-9', 'hello')
  })
})
