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
  appendHistoryMessages,
  buildPriorAgentContext,
  isToolsUnsupportedApiError,
  runAgent
} from './agent-runner'
import type { AgentToolStep } from '../../src/types'

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
  return toolCallTurnRaw(name, JSON.stringify(args), id)
}

function toolCallTurnRaw(name: string, argumentsJson: string, id = 'call_1'): string[] {
  return [
    sseChunk({
      choices: [
        {
          delta: {
            tool_calls: [
              {
                index: 0,
                id,
                function: { name, arguments: argumentsJson }
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

  it('nudges when a change request finishes without proposeActions', async () => {
    const root = makeTempRoot('missing-propose-nudge')
    tempRoots.push(root)

    const fetchMock = vi.mocked(fetch)
    fetchMock
      .mockResolvedValueOnce(sseResponse(textTurn('I will update note.txt for you.')))
      .mockResolvedValueOnce(
        sseResponse(
          toolCallTurn(
            'proposeActions',
            {
              actions: [{ type: 'writeFile', path: 'note.txt', content: 'fixed\n' }]
            },
            'call_propose'
          )
        )
      )
      .mockResolvedValueOnce(sseResponse(textTurn('Applied after approval.')))

    const { webContents, events } = createWebContents()
    const running = runAgent(
      webContents,
      baseRequest(root, { messages: [{ role: 'user', content: 'Fix note.txt please' }] })
    )

    await vi.waitFor(() => {
      expect(events.some((e) => e.channel === 'ai:needApproval')).toBe(true)
    })

    const secondBody = JSON.parse(String(fetchMock.mock.calls[1][1]?.body)) as {
      messages: Array<{ role: string; content: string | null }>
    }
    const nudgeMsg = secondBody.messages.find(
      (m) =>
        m.role === 'user' &&
        typeof m.content === 'string' &&
        m.content.includes('proposeActions was not called')
    )
    expect(nudgeMsg).toBeTruthy()

    expect(resolveAgentApproval({ id: 'call_propose', approved: true })).toBe(true)
    await running

    expect(events.some((e) => e.channel === 'ai:done')).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('does not nudge missing proposeActions for read-only asks', async () => {
    const root = makeTempRoot('no-propose-nudge-readonly')
    tempRoots.push(root)

    const fetchMock = vi.mocked(fetch)
    fetchMock.mockResolvedValueOnce(sseResponse(textTurn('Here is what I found.')))

    const { webContents, events } = createWebContents()
    await runAgent(webContents, baseRequest(root))

    expect(events.some((e) => e.channel === 'ai:done')).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('nudges after truncated proposeActions when finishing in text', async () => {
    const root = makeTempRoot('truncated-propose-nudge')
    tempRoots.push(root)

    const fetchMock = vi.mocked(fetch)
    fetchMock
      .mockResolvedValueOnce(
        sseResponse(
          toolCallTurnRaw(
            'proposeActions',
            '{"actions":[{"type":"writeFile","path":"big.md","content":"partial',
            'call_truncated'
          )
        )
      )
      .mockResolvedValueOnce(sseResponse(textTurn('Done without retry.')))
      .mockResolvedValueOnce(sseResponse(textTurn('Still done.')))
      .mockResolvedValueOnce(sseResponse(textTurn('Forced stop.')))

    const { webContents, events } = createWebContents()
    await runAgent(
      webContents,
      baseRequest(root, { messages: [{ role: 'user', content: 'Update big.md' }] })
    )

    expect(events.some((e) => e.channel === 'ai:needApproval')).toBe(false)
    const toolResult = events.find((e) => e.channel === 'ai:toolResult')
    expect(toolResult?.payload[0]).toMatchObject({ name: 'proposeActions', ok: false })

    const thirdBody = JSON.parse(String(fetchMock.mock.calls[2][1]?.body)) as {
      messages: Array<{ role: string; content: string | null }>
    }
    const nudgeMsg = thirdBody.messages.find(
      (m) =>
        m.role === 'user' &&
        typeof m.content === 'string' &&
        m.content.includes('truncated')
    )
    expect(nudgeMsg).toBeTruthy()
    expect(events.some((e) => e.channel === 'ai:done')).toBe(true)
    // truncated propose + 3 text-only (2 nudges then forced done)
    expect(fetchMock).toHaveBeenCalledTimes(4)
  })

  it('nudges when assistant dumps compass-actions instead of proposeActions', async () => {
    const root = makeTempRoot('fake-compass-actions-nudge')
    tempRoots.push(root)

    const fetchMock = vi.mocked(fetch)
    fetchMock
      .mockResolvedValueOnce(
        sseResponse(
          textTurn(
            'Please approve:\n\n```compass-actions\n{"actions":[{"type":"writeFile","path":"a.md","content":"x"}]}\n```'
          )
        )
      )
      .mockResolvedValueOnce(sseResponse(textTurn('Stopping without tool.')))
      .mockResolvedValueOnce(sseResponse(textTurn('Forced done.')))

    const { webContents, events } = createWebContents()
    await runAgent(
      webContents,
      baseRequest(root, { messages: [{ role: 'user', content: 'What is in this folder?' }] })
    )

    const secondBody = JSON.parse(String(fetchMock.mock.calls[1][1]?.body)) as {
      messages: Array<{ role: string; content: string | null }>
    }
    expect(
      secondBody.messages.some(
        (m) =>
          m.role === 'user' &&
          typeof m.content === 'string' &&
          m.content.includes('proposeActions was not called')
      )
    ).toBe(true)
    expect(events.some((e) => e.channel === 'ai:done')).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('injects historical tool context once before the new ask on follow-ups', async () => {
    const root = makeTempRoot('followup-context')
    tempRoots.push(root)
    writeFileSync(join(root, 'a.ts'), 'export const a = 1\n', 'utf-8')

    const fetchMock = vi.mocked(fetch)
    // Change-request follow-up may nudge missing proposeActions up to twice.
    fetchMock
      .mockResolvedValueOnce(sseResponse(textTurn('Will update b.ts next.')))
      .mockResolvedValueOnce(sseResponse(textTurn('Still explaining.')))
      .mockResolvedValueOnce(sseResponse(textTurn('Stopping.')))

    const priorSteps: AgentToolStep[] = [
      {
        id: 's1',
        name: 'readFile',
        args: { path: 'a.ts' },
        status: 'done',
        ok: true,
        summary: 'Read a.ts (18 chars)',
        observation: 'export const a = 1'
      },
      {
        id: 's2',
        name: 'proposeActions',
        args: {
          actions: [{ type: 'writeFile', path: 'a.ts', content: 'export const a = 2\n' }]
        },
        status: 'done',
        ok: true,
        summary: 'Applied 1 action(s)',
        observation:
          'User approved and applied 1 workspace action(s):\n- writeFile: a.ts\n\nPlease call verify.'
      }
    ]

    const { webContents, events } = createWebContents()
    await runAgent(
      webContents,
      baseRequest(root, {
        messages: [
          { role: 'user', content: 'Update a.ts' },
          {
            role: 'assistant',
            content: 'Updated a.ts.',
            agentSteps: priorSteps
          },
          { role: 'user', content: '同様に b.ts も' }
        ]
      })
    )

    expect(events.some((e) => e.channel === 'ai:done')).toBe(true)
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)) as {
      messages: Array<{ role: string; content: string | null }>
    }
    const userTexts = body.messages
      .filter((m) => m.role === 'user' && typeof m.content === 'string')
      .map((m) => m.content as string)

    const historical = userTexts.filter((text) => text.includes('Historical agent tool context'))
    expect(historical).toHaveLength(1)
    expect(historical[0]).toContain('does NOT mean the latest user request is already done')
    expect(historical[0]).toContain('HISTORICAL proposeActions (applied) paths: a.ts')
    expect(historical[0]).not.toContain('User approved and applied')
    expect(userTexts.some((text) => text.includes('同様に b.ts も'))).toBe(true)

    // Must not interleave Applied-style context after every prior assistant turn.
    const appliedUserMsgs = userTexts.filter((text) =>
      /OK proposeActions[\s\S]*Applied 1 action/.test(text)
    )
    expect(appliedUserMsgs).toHaveLength(0)
  })
})

describe('buildPriorAgentContext / appendHistoryMessages', () => {
  it('rewrites proposeActions as HISTORICAL without approval observations', () => {
    const ctx = buildPriorAgentContext([
      {
        id: '1',
        name: 'proposeActions',
        args: {
          actions: [{ type: 'applyPatch', path: 'src/foo.ts', patch: '@@\n-a\n+b\n' }]
        },
        status: 'done',
        ok: true,
        summary: 'Applied 1 action(s)',
        observation: 'User approved and applied 1 workspace action(s):\n- applyPatch: src/foo.ts'
      }
    ])
    expect(ctx).toContain('HISTORICAL proposeActions (applied) paths: src/foo.ts')
    expect(ctx).toContain('call proposeActions again')
    expect(ctx).not.toContain('User approved and applied')
  })

  it('appends one consolidated prior-context user message at the end', () => {
    const apiMessages: Array<{ role: string; content?: string | null }> = [
      { role: 'system', content: 'sys' }
    ]
    appendHistoryMessages(apiMessages, [
      { role: 'user', content: 'first' },
      {
        role: 'assistant',
        content: 'done1',
        agentSteps: [
          {
            id: '1',
            name: 'listDir',
            args: { path: '.' },
            status: 'done',
            ok: true,
            summary: 'Listed .'
          }
        ]
      },
      { role: 'user', content: 'second' },
      {
        role: 'assistant',
        content: 'done2',
        agentSteps: [
          {
            id: '2',
            name: 'proposeActions',
            args: { actions: [{ type: 'writeFile', path: 'x.md', content: 'x' }] },
            status: 'done',
            ok: true,
            summary: 'Applied 1 action(s)',
            observation: 'User approved and applied 1 workspace action(s)'
          }
        ]
      },
      { role: 'user', content: 'third ask' }
    ])

    expect(apiMessages.map((m) => m.role)).toEqual([
      'system',
      'user',
      'assistant',
      'user',
      'assistant',
      'user'
    ])
    const prior = apiMessages[apiMessages.length - 1]
    expect(prior.content).toContain('Historical agent tool context')
    expect(prior.content).toContain('HISTORICAL proposeActions')
    expect(prior.content).not.toContain('User approved and applied')
  })
})
