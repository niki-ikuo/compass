import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WebContents } from 'electron'
import type { AppSettings, ChatRequest } from '../../src/types'
import { DEFAULT_SETTINGS } from '../../src/types'
import { parseAgentToolsUnsupportedError } from '../../src/utils/agent-tools'
import { cancelChat } from './ai-client'
import { resetAgentApprovalStateForTests, resolveAgentApproval } from './agent-approval'

vi.mock('./settings', () => ({
  getSettings: vi.fn()
}))

vi.mock('./project-indexer', () => ({
  ensureProjectIndex: vi.fn(async () => undefined),
  getProjectIndexContext: vi.fn(async () => null)
}))

import { getSettings } from './settings'
import {
  isToolsUnsupportedApiError,
  runAgent
} from './agent-runner'

const mockedGetSettings = vi.mocked(getSettings)

function makeTempRoot(name: string): string {
  const root = join(
    tmpdir(),
    `compass-agent-${name}-${Date.now()}-${Math.random().toString(36).slice(2)}`
  )
  mkdirSync(root, { recursive: true })
  return root
}

const tempRoots: string[] = []

function settingsWith(overrides: Partial<AppSettings> = {}): AppSettings {
  return {
    ...DEFAULT_SETTINGS,
    apiKey: 'sk-test',
    providerId: 'openai',
    apiBaseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    ...overrides
  }
}

function createWebContents() {
  const events: Array<{ channel: string; chatId: string; payload: unknown[] }> = []
  const webContents = {
    send: (channel: string, chatId: string, ...payload: unknown[]) => {
      events.push({ channel, chatId, payload })
    }
  } as unknown as WebContents
  return { webContents, events }
}

function sseChunk(obj: unknown): string {
  return `data: ${JSON.stringify(obj)}\n\n`
}

function sseResponse(parts: string[]): Response {
  const body = `${parts.join('')}data: [DONE]\n\n`
  return new Response(body, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' }
  })
}

function toolCallTurn(name: string, args: Record<string, unknown>, id = 'call_1'): string[] {
  return [
    sseChunk({
      choices: [
        {
          delta: {
            tool_calls: [
              {
                index: 0,
                id,
                function: { name, arguments: JSON.stringify(args) }
              }
            ]
          }
        }
      ]
    }),
    sseChunk({ choices: [{ finish_reason: 'tool_calls', delta: {} }] })
  ]
}

function textTurn(content: string): string[] {
  return [
    sseChunk({ choices: [{ delta: { content } }] }),
    sseChunk({ choices: [{ finish_reason: 'stop', delta: {} }] })
  ]
}

function baseRequest(workspaceRoot: string, overrides: Partial<ChatRequest> = {}): ChatRequest {
  return {
    chatId: 'agent-test',
    mode: 'agent',
    workspaceRoot,
    messages: [{ role: 'user', content: 'List the workspace' }],
    ...overrides
  }
}

beforeEach(() => {
  mockedGetSettings.mockReset()
  mockedGetSettings.mockResolvedValue(settingsWith())
  vi.stubGlobal('fetch', vi.fn())
})

afterEach(() => {
  cancelChat()
  resetAgentApprovalStateForTests()
  vi.unstubAllGlobals()
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe('isToolsUnsupportedApiError', () => {
  it('matches common provider error bodies on 400/404/422', () => {
    expect(isToolsUnsupportedApiError(400, 'tools are not supported')).toBe(true)
    expect(isToolsUnsupportedApiError(404, 'Model does not support tools')).toBe(true)
    expect(isToolsUnsupportedApiError(422, "Unknown parameter: 'tools'")).toBe(true)
    expect(isToolsUnsupportedApiError(422, 'tool_choice is not supported')).toBe(true)
    expect(isToolsUnsupportedApiError(400, 'does not support function calling')).toBe(true)
  })

  it('ignores unrelated statuses and bodies', () => {
    expect(isToolsUnsupportedApiError(500, 'tools are not supported')).toBe(false)
    expect(isToolsUnsupportedApiError(400, 'rate limit exceeded')).toBe(false)
  })
})

describe('runAgent early failures', () => {
  it('errors when workspace is missing', async () => {
    const { webContents, events } = createWebContents()
    await runAgent(webContents, baseRequest('', { workspaceRoot: undefined }))
    expect(events.some((e) => e.channel === 'ai:error')).toBe(true)
    expect(String(events.find((e) => e.channel === 'ai:error')?.payload[0])).toMatch(
      /open a folder/i
    )
    expect(fetch).not.toHaveBeenCalled()
  })

  it('rejects ollama (tools unsupported provider)', async () => {
    mockedGetSettings.mockResolvedValue(
      settingsWith({
        providerId: 'ollama',
        apiKey: '',
        apiBaseUrl: 'http://localhost:11434/v1'
      })
    )
    const root = makeTempRoot('ollama')
    tempRoots.push(root)
    const { webContents, events } = createWebContents()
    await runAgent(webContents, baseRequest(root))

    const error = String(events.find((e) => e.channel === 'ai:error')?.payload[0] ?? '')
    expect(parseAgentToolsUnsupportedError(error)).toMatch(/ollama/i)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('errors when API key is missing for key-required providers', async () => {
    mockedGetSettings.mockResolvedValue(settingsWith({ apiKey: '' }))
    const root = makeTempRoot('nokey')
    tempRoots.push(root)
    const { webContents, events } = createWebContents()
    await runAgent(webContents, baseRequest(root))
    expect(String(events.find((e) => e.channel === 'ai:error')?.payload[0])).toMatch(
      /api key/i
    )
  })

  it('errors when API base URL is blank', async () => {
    mockedGetSettings.mockResolvedValue(settingsWith({ apiBaseUrl: '   ' }))
    const root = makeTempRoot('nourl')
    tempRoots.push(root)
    const { webContents, events } = createWebContents()
    await runAgent(webContents, baseRequest(root))
    expect(String(events.find((e) => e.channel === 'ai:error')?.payload[0])).toMatch(
      /base url/i
    )
  })
})

describe('runAgent tool loop', () => {
  it('runs listDir then finishes on a text-only turn', async () => {
    const root = makeTempRoot('listdir')
    tempRoots.push(root)
    writeFileSync(join(root, 'readme.md'), '# hi\n', 'utf-8')
    mkdirSync(join(root, 'src'))

    const fetchMock = vi.mocked(fetch)
    fetchMock
      .mockResolvedValueOnce(sseResponse(toolCallTurn('listDir', { path: '.' })))
      .mockResolvedValueOnce(sseResponse(textTurn('Listed the workspace.')))

    const { webContents, events } = createWebContents()
    await runAgent(webContents, baseRequest(root))

    expect(events.some((e) => e.channel === 'ai:toolStart')).toBe(true)
    const toolResult = events.find((e) => e.channel === 'ai:toolResult')
    expect(toolResult?.payload[0]).toMatchObject({
      name: 'listDir',
      ok: true
    })
    expect(String((toolResult?.payload[0] as { observation?: string }).observation)).toMatch(
      /readme\.md/
    )
    expect(events.some((e) => e.channel === 'ai:done')).toBe(true)
    expect(events.some((e) => e.channel === 'ai:error')).toBe(false)
    expect(fetchMock).toHaveBeenCalledTimes(2)

    const firstBody = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)) as {
      tools: unknown[]
      max_tokens: number
    }
    expect(firstBody.tools.length).toBeGreaterThan(0)
    expect(firstBody.max_tokens).toBeGreaterThanOrEqual(32_768)
  })

  it('maps tools-unsupported API errors to the codec message', async () => {
    const root = makeTempRoot('tools-unsup')
    tempRoots.push(root)
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { message: 'tools are not supported' } }), {
        status: 400
      })
    )

    const { webContents, events } = createWebContents()
    await runAgent(webContents, baseRequest(root))

    const error = String(events.find((e) => e.channel === 'ai:error')?.payload[0] ?? '')
    expect(parseAgentToolsUnsupportedError(error)).toBeTruthy()
  })

  it('aborts when cancelChat fires during the model request', async () => {
    const root = makeTempRoot('abort')
    tempRoots.push(root)

    vi.mocked(fetch).mockImplementation((_url, init) => {
      return new Promise((_resolve, reject) => {
        const signal = init?.signal
        if (!signal) return
        if (signal.aborted) {
          const err = new Error('Aborted')
          err.name = 'AbortError'
          reject(err)
          return
        }
        signal.addEventListener('abort', () => {
          const err = new Error('Aborted')
          err.name = 'AbortError'
          reject(err)
        })
      })
    })

    const { webContents, events } = createWebContents()
    const running = runAgent(webContents, baseRequest(root, { chatId: 'abort-me' }))
    await Promise.resolve()
    await Promise.resolve()
    expect(cancelChat('abort-me')).toBe(true)
    await running

    expect(events.some((e) => e.channel === 'ai:aborted')).toBe(true)
    expect(events.some((e) => e.channel === 'ai:done')).toBe(false)
  })

  it('waits for proposeActions approval and reports rejection', async () => {
    const root = makeTempRoot('propose')
    tempRoots.push(root)

    vi.mocked(fetch)
      .mockResolvedValueOnce(
        sseResponse(
          toolCallTurn(
            'proposeActions',
            {
              actions: [{ type: 'writeFile', path: 'new.md', content: 'hello\n' }]
            },
            'call_propose'
          )
        )
      )
      .mockResolvedValueOnce(sseResponse(textTurn('Stopped after rejection.')))

    const { webContents, events } = createWebContents()
    const running = runAgent(webContents, baseRequest(root))

    await vi.waitFor(() => {
      expect(events.some((e) => e.channel === 'ai:needApproval')).toBe(true)
    })
    expect(resolveAgentApproval({ id: 'call_propose', approved: false, detail: 'nope' })).toBe(
      true
    )
    await running

    const toolResult = events.find((e) => e.channel === 'ai:toolResult')
    expect(toolResult?.payload[0]).toMatchObject({
      name: 'proposeActions',
      ok: false
    })
    expect(events.some((e) => e.channel === 'ai:done')).toBe(true)
  })

  it('reads a file via readFile tool', async () => {
    const root = makeTempRoot('read')
    tempRoots.push(root)
    writeFileSync(join(root, 'note.txt'), 'alpha beta\n', 'utf-8')

    vi.mocked(fetch)
      .mockResolvedValueOnce(sseResponse(toolCallTurn('readFile', { path: 'note.txt' })))
      .mockResolvedValueOnce(sseResponse(textTurn('Read complete.')))

    const { webContents, events } = createWebContents()
    await runAgent(webContents, baseRequest(root))

    const toolResult = events.find((e) => e.channel === 'ai:toolResult')
    expect(toolResult?.payload[0]).toMatchObject({ name: 'readFile', ok: true })
    expect(String((toolResult?.payload[0] as { observation?: string }).observation)).toContain(
      'alpha beta'
    )
  })

  it('nudges and continues when finishing with open todos, then done after closing them', async () => {
    const root = makeTempRoot('open-todo-nudge')
    tempRoots.push(root)

    const fetchMock = vi.mocked(fetch)
    fetchMock
      .mockResolvedValueOnce(
        sseResponse(
          toolCallTurn(
            'updateTodo',
            {
              todos: [
                { id: '1', content: 'First ask', status: 'done' },
                { id: '2', content: 'Second ask', status: 'pending' }
              ]
            },
            'call_todo_1'
          )
        )
      )
      .mockResolvedValueOnce(sseResponse(textTurn('Finished the first ask only.')))
      .mockResolvedValueOnce(
        sseResponse(
          toolCallTurn(
            'updateTodo',
            {
              merge: true,
              todos: [{ id: '2', content: 'Second ask', status: 'done' }]
            },
            'call_todo_2'
          )
        )
      )
      .mockResolvedValueOnce(sseResponse(textTurn('Both asks are done.')))

    const { webContents, events } = createWebContents()
    await runAgent(
      webContents,
      baseRequest(root, { messages: [{ role: 'user', content: 'Do A and B' }] })
    )

    expect(events.some((e) => e.channel === 'ai:done')).toBe(true)
    expect(events.some((e) => e.channel === 'ai:error')).toBe(false)
    expect(fetchMock).toHaveBeenCalledTimes(4)

    const thirdBody = JSON.parse(String(fetchMock.mock.calls[2][1]?.body)) as {
      messages: Array<{ role: string; content: string | null }>
    }
    const nudgeMsg = thirdBody.messages.find(
      (m) => m.role === 'user' && typeof m.content === 'string' && m.content.includes('Open todos remain')
    )
    expect(nudgeMsg?.content).toContain('Second ask')
  })

  it('stops after max open-todo nudges even if todos remain open', async () => {
    const root = makeTempRoot('open-todo-nudge-cap')
    tempRoots.push(root)

    const fetchMock = vi.mocked(fetch)
    fetchMock
      .mockResolvedValueOnce(
        sseResponse(
          toolCallTurn(
            'updateTodo',
            {
              todos: [{ id: '1', content: 'Never finishes', status: 'pending' }]
            },
            'call_todo'
          )
        )
      )
      .mockResolvedValueOnce(sseResponse(textTurn('Stopping early 1.')))
      .mockResolvedValueOnce(sseResponse(textTurn('Stopping early 2.')))
      .mockResolvedValueOnce(sseResponse(textTurn('Stopping early 3.')))

    const { webContents, events } = createWebContents()
    await runAgent(webContents, baseRequest(root))

    expect(events.some((e) => e.channel === 'ai:done')).toBe(true)
    // updateTodo + 3 text-only attempts (2 nudges then forced done)
    expect(fetchMock).toHaveBeenCalledTimes(4)
  })
})
