import type { WebContents } from 'electron'
import { readdir, readFile, stat } from 'fs/promises'
import { basename, isAbsolute, join, relative, resolve } from 'path'
import type { ChatRequest } from '../../src/types'
import { t } from '../../src/i18n/runtime'
import { getLlmProvider, getProviderLabel } from '../../src/utils/llm-providers'
import { getSettings } from './settings'
import {
  acquireChatAbortController,
  buildApiHeaders,
  buildUserMessage,
  isAbortError,
  releaseChatAbortController
} from './ai-client'
import { resolveInsideWorkspace } from './filesystem'
import { searchWorkspace } from './workspace-search'

const MAX_AGENT_TURNS = 8
const MAX_TOOL_CALLS = 20
const MAX_READ_BYTES = 200 * 1024
const MAX_LIST_ENTRIES = 200
const MAX_SEARCH_RESULTS = 30
const MAX_TOOL_RESULT_CHARS = 80_000

type ApiMessage = {
  role: string
  content?: string | null
  tool_calls?: ToolCall[]
  tool_call_id?: string
  name?: string
}

type ToolCall = {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

type StreamTurnResult = {
  content: string
  toolCalls: ToolCall[]
  finishReason: string | null
}

const AGENT_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'readFile',
      description: 'Read a text file under the workspace. Path is relative to the workspace root.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relative path from workspace root' }
        },
        required: ['path']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'listDir',
      description:
        'List files and folders in a directory (one level). Path is relative to the workspace root; use "." for the root. Never pass the workspace folder name as if it were a child folder.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Directory path relative to workspace root (default ".")'
          }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'search',
      description: 'Search file contents in the workspace for a text query.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search string' },
          path: {
            type: 'string',
            description: 'Optional subdirectory or file to scope the search'
          },
          caseSensitive: { type: 'boolean' }
        },
        required: ['query']
      }
    }
  }
] as const

function sanitizeArgs(args: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(args)) {
    if (typeof value === 'string') {
      out[key] = value.length > 200 ? `${value.slice(0, 200)}…` : value
    } else if (typeof value === 'number' || typeof value === 'boolean' || value === null) {
      out[key] = value
    } else {
      out[key] = '[complex]'
    }
  }
  return out
}

function truncateForModel(text: string): string {
  if (text.length <= MAX_TOOL_RESULT_CHARS) return text
  return `${text.slice(0, MAX_TOOL_RESULT_CHARS)}\n…(truncated)`
}

function normalizeSlashes(path: string): string {
  return path.replace(/\\/g, '/')
}

/**
 * ツール引数のパスをワークスペース相対に正規化する。
 * ワークスペース名そのもの（例: ルートが .../aaa なのに path="aaa"）は、
 * 同名サブフォルダが無い限りルート "." として扱う。
 */
async function normalizeAgentRelativePath(
  workspaceRoot: string,
  pathArg: string | undefined,
  options?: { defaultToRoot?: boolean }
): Promise<string> {
  const root = resolve(workspaceRoot)
  let raw = (pathArg ?? '').trim().replace(/\\/g, '/')
  while (raw.length > 1 && raw.endsWith('/')) {
    raw = raw.slice(0, -1)
  }

  if (!raw || raw === '.' || raw === './') {
    return options?.defaultToRoot === false ? '' : '.'
  }

  // 絶対パスがワークスペース直下を指す場合
  if (isAbsolute(raw) || /^[a-zA-Z]:/.test(raw)) {
    const abs = resolve(raw)
    const rel = relative(root, abs)
    if (!rel || rel === '') return '.'
    if (rel.startsWith('..') || isAbsolute(rel)) {
      return raw
    }
    return normalizeSlashes(rel)
  }

  const rootName = basename(root)
  const sameName =
    raw === rootName || (process.platform === 'win32' && raw.toLowerCase() === rootName.toLowerCase())

  if (sameName) {
    try {
      await stat(join(root, raw))
      // 同名サブフォルダ/ファイルが実在するならそのまま
    } catch {
      return '.'
    }
  }

  return raw
}

async function resolveAgentToolPath(
  workspaceRoot: string,
  pathArg: string | undefined,
  options?: { allowRoot?: boolean; defaultToRoot?: boolean }
): Promise<{ relativePath: string; absolutePath: string }> {
  const relativePath = await normalizeAgentRelativePath(workspaceRoot, pathArg, {
    defaultToRoot: options?.defaultToRoot
  })
  if (!relativePath || relativePath === '.') {
    const absolutePath = resolveInsideWorkspace(workspaceRoot, '.', { allowRoot: true })
    return { relativePath: '.', absolutePath }
  }
  const absolutePath = resolveInsideWorkspace(workspaceRoot, relativePath, {
    allowRoot: options?.allowRoot
  })
  return { relativePath, absolutePath }
}

function parseToolArgs(raw: string): Record<string, unknown> {
  if (!raw.trim()) return {}
  try {
    const parsed = JSON.parse(raw) as unknown
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
  } catch {
    // fall through
  }
  return { _raw: raw }
}

/** UI / 次ターン用に path 引数を正規化してから返す */
async function normalizeToolArgsForCall(
  workspaceRoot: string,
  name: string,
  args: Record<string, unknown>
): Promise<Record<string, unknown>> {
  if (name === 'readFile' || name === 'listDir') {
    const relativePath = await normalizeAgentRelativePath(
      workspaceRoot,
      typeof args.path === 'string' ? args.path : undefined,
      { defaultToRoot: name === 'listDir' }
    )
    if (name === 'readFile' && !relativePath) {
      return { ...args, path: typeof args.path === 'string' ? args.path : '' }
    }
    return { ...args, path: relativePath || '.' }
  }
  if (name === 'search' && typeof args.path === 'string' && args.path.trim()) {
    const relativePath = await normalizeAgentRelativePath(workspaceRoot, args.path, {
      defaultToRoot: true
    })
    return { ...args, path: relativePath === '.' ? '' : relativePath }
  }
  return args
}

async function executeReadFile(
  workspaceRoot: string,
  args: Record<string, unknown>
): Promise<{ ok: boolean; summary: string; content: string }> {
  const pathArg = typeof args.path === 'string' ? args.path : ''
  if (!pathArg.trim() || pathArg === '.') {
    return { ok: false, summary: 'path is required', content: 'Error: path is required' }
  }

  try {
    const { relativePath, absolutePath } = await resolveAgentToolPath(workspaceRoot, pathArg)
    if (relativePath === '.') {
      return {
        ok: false,
        summary: 'path is a directory; use listDir',
        content: 'Error: path is a directory; use listDir'
      }
    }
    const info = await stat(absolutePath)
    if (info.isDirectory()) {
      return {
        ok: false,
        summary: 'path is a directory; use listDir',
        content: 'Error: path is a directory; use listDir'
      }
    }
    if (info.size > MAX_READ_BYTES) {
      const buffer = await readFile(absolutePath)
      const text = buffer.subarray(0, MAX_READ_BYTES).toString('utf8')
      return {
        ok: true,
        summary: `Read ${relativePath} (truncated to ${MAX_READ_BYTES} bytes)`,
        content: truncateForModel(`# ${relativePath} (truncated)\n${text}`)
      }
    }
    const text = (await readFile(absolutePath)).toString('utf8')
    return {
      ok: true,
      summary: `Read ${relativePath} (${text.length} chars)`,
      content: truncateForModel(`# ${relativePath}\n${text}`)
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, summary: message, content: `Error: ${message}` }
  }
}

async function executeListDir(
  workspaceRoot: string,
  args: Record<string, unknown>
): Promise<{ ok: boolean; summary: string; content: string }> {
  const pathArg = typeof args.path === 'string' && args.path.trim() ? args.path : '.'

  try {
    const { relativePath, absolutePath } = await resolveAgentToolPath(workspaceRoot, pathArg, {
      allowRoot: true,
      defaultToRoot: true
    })
    const info = await stat(absolutePath)
    if (!info.isDirectory()) {
      return {
        ok: false,
        summary: 'path is not a directory',
        content: 'Error: path is not a directory'
      }
    }

    const entries = await readdir(absolutePath, { withFileTypes: true })
    const sorted = entries.sort((a, b) => {
      if (a.isDirectory() && !b.isDirectory()) return -1
      if (!a.isDirectory() && b.isDirectory()) return 1
      return a.name.localeCompare(b.name)
    })

    const lines: string[] = []
    let truncated = false
    for (const entry of sorted) {
      if (lines.length >= MAX_LIST_ENTRIES) {
        truncated = true
        break
      }
      lines.push(`${entry.isDirectory() ? 'dir' : 'file'}\t${entry.name}`)
    }

    const displayRel = relativePath || '.'
    const summary = truncated
      ? `Listed ${lines.length}+ entries in ${displayRel}`
      : `Listed ${lines.length} entries in ${displayRel}`
    const body = [`# ${displayRel}`, ...lines, truncated ? '…(truncated)' : ''].filter(Boolean).join('\n')
    return { ok: true, summary, content: body }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, summary: message, content: `Error: ${message}` }
  }
}

async function executeSearch(
  workspaceRoot: string,
  args: Record<string, unknown>
): Promise<{ ok: boolean; summary: string; content: string }> {
  const query = typeof args.query === 'string' ? args.query : ''
  if (!query.trim()) {
    return { ok: false, summary: 'query is required', content: 'Error: query is required' }
  }

  try {
    let scopedPath: string | undefined
    if (typeof args.path === 'string' && args.path.trim()) {
      const resolved = await resolveAgentToolPath(workspaceRoot, args.path, {
        allowRoot: true,
        defaultToRoot: true
      })
      scopedPath = resolved.absolutePath
    }
    const result = await searchWorkspace(workspaceRoot, {
      query,
      caseSensitive: Boolean(args.caseSensitive),
      rootPath: scopedPath,
      maxResults: MAX_SEARCH_RESULTS
    })

    const lines: string[] = [
      `# search: ${query}`,
      `matches: ${result.totalMatches}${result.truncated ? ' (truncated)' : ''}`,
      `filesSearched: ${result.filesSearched}`
    ]
    for (const file of result.files) {
      lines.push(`## ${file.relativePath}`)
      for (const match of file.matches.slice(0, 5)) {
        lines.push(`L${match.line}: ${match.preview.trim()}`)
      }
    }

    return {
      ok: true,
      summary: `${result.totalMatches} matches in ${result.files.length} files`,
      content: truncateForModel(lines.join('\n'))
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, summary: message, content: `Error: ${message}` }
  }
}

async function executeTool(
  workspaceRoot: string,
  name: string,
  args: Record<string, unknown>
): Promise<{ ok: boolean; summary: string; content: string }> {
  switch (name) {
    case 'readFile':
      return executeReadFile(workspaceRoot, args)
    case 'listDir':
      return executeListDir(workspaceRoot, args)
    case 'search':
      return executeSearch(workspaceRoot, args)
    default:
      return {
        ok: false,
        summary: `Unknown tool: ${name}`,
        content: `Error: unknown tool "${name}"`
      }
  }
}

async function streamAgentTurn(
  webContents: WebContents,
  url: string,
  headers: Record<string, string>,
  body: Record<string, unknown>,
  signal: AbortSignal
): Promise<StreamTurnResult> {
  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(t('ai.apiError', { status: response.status, body: errorText }))
  }

  if (!response.body) {
    throw new Error(t('ai.noResponseBody'))
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let content = ''
  let finishReason: string | null = null
  const toolCallParts = new Map<number, { id: string; name: string; arguments: string }>()

  try {
    while (true) {
      if (signal.aborted) {
        await reader.cancel()
        break
      }

      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed || !trimmed.startsWith('data:')) continue
        const data = trimmed.slice(5).trim()
        if (data === '[DONE]') continue

        try {
          const parsed = JSON.parse(data) as {
            choices?: Array<{
              delta?: {
                content?: string | null
                tool_calls?: Array<{
                  index?: number
                  id?: string
                  function?: { name?: string; arguments?: string }
                }>
              }
              finish_reason?: string | null
            }>
          }
          const choice = parsed.choices?.[0]
          if (!choice) continue

          if (choice.finish_reason) {
            finishReason = choice.finish_reason
          }

          const delta = choice.delta
          if (!delta) continue

          if (typeof delta.content === 'string' && delta.content) {
            content += delta.content
            webContents.send('ai:chunk', delta.content)
          }

          if (Array.isArray(delta.tool_calls)) {
            for (const part of delta.tool_calls) {
              const index = part.index ?? 0
              const existing = toolCallParts.get(index) ?? { id: '', name: '', arguments: '' }
              if (part.id) existing.id = part.id
              if (part.function?.name) existing.name += part.function.name
              if (part.function?.arguments) existing.arguments += part.function.arguments
              toolCallParts.set(index, existing)
            }
          }
        } catch {
          // skip malformed SSE chunks
        }
      }
    }
  } catch (err) {
    if (!isAbortError(err) && !signal.aborted) throw err
  }

  const toolCalls: ToolCall[] = [...toolCallParts.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, part], i) => ({
      id: part.id || `call_${i}`,
      type: 'function' as const,
      function: {
        name: part.name || 'unknown',
        arguments: part.arguments || '{}'
      }
    }))

  return { content, toolCalls, finishReason }
}

/**
 * Phase 1 Agent: read-only tool loop (readFile / listDir / search).
 * Shares cancel with Ask/Edit via `cancelChat`.
 */
export async function runAgent(webContents: WebContents, request: ChatRequest): Promise<void> {
  const abortController = acquireChatAbortController()
  const { signal } = abortController

  try {
    if (!request.workspaceRoot) {
      webContents.send('ai:error', t('ai.agentNeedsWorkspace'))
      return
    }

    const settings = await getSettings()
    if (signal.aborted) {
      webContents.send('ai:aborted')
      return
    }

    const provider = getLlmProvider(settings.providerId)
    if (provider.requiresApiKey && !settings.apiKey) {
      webContents.send('ai:error', t('ai.missingApiKey', { provider: getProviderLabel(provider.id) }))
      return
    }
    if (!settings.apiBaseUrl.trim()) {
      webContents.send('ai:error', t('ai.missingBaseUrl'))
      return
    }

    const history = request.messages.filter((m) => m.role !== 'system')
    const apiMessages: ApiMessage[] = [
      { role: 'system', content: t('ai.agentSystemPrompt') }
    ]

    for (let i = 0; i < history.length - 1; i++) {
      apiMessages.push({ role: history[i].role, content: history[i].content })
    }
    apiMessages.push({ role: 'user', content: await buildUserMessage(request) })

    const url = `${settings.apiBaseUrl.replace(/\/$/, '')}/chat/completions`
    const headers = buildApiHeaders(settings)
    let toolCallsUsed = 0

    for (let turn = 0; turn < MAX_AGENT_TURNS; turn++) {
      if (signal.aborted) {
        webContents.send('ai:aborted')
        return
      }

      webContents.send('ai:step', { label: t('ai.agentStepThinking', { turn: turn + 1 }) })

      const body: Record<string, unknown> = {
        model: settings.model,
        messages: apiMessages,
        temperature: settings.temperature,
        max_tokens: settings.maxTokens,
        stream: true,
        tools: AGENT_TOOLS,
        tool_choice: 'auto'
      }

      let turnResult: StreamTurnResult
      try {
        turnResult = await streamAgentTurn(webContents, url, headers, body, signal)
      } catch (err) {
        if (isAbortError(err) || signal.aborted) {
          webContents.send('ai:aborted')
          return
        }
        const message = err instanceof Error ? err.message : t('common.unknownError')
        webContents.send('ai:error', message)
        return
      }

      if (signal.aborted) {
        webContents.send('ai:aborted')
        return
      }

      if (turnResult.toolCalls.length === 0) {
        webContents.send('ai:done')
        return
      }

      if (toolCallsUsed + turnResult.toolCalls.length > MAX_TOOL_CALLS) {
        webContents.send('ai:error', t('ai.agentToolLimit'))
        return
      }

      apiMessages.push({
        role: 'assistant',
        content: turnResult.content || null,
        tool_calls: turnResult.toolCalls
      })

      for (const call of turnResult.toolCalls) {
        if (signal.aborted) {
          webContents.send('ai:aborted')
          return
        }

        toolCallsUsed++
        const rawArgs = parseToolArgs(call.function.arguments)
        const args = await normalizeToolArgsForCall(
          request.workspaceRoot,
          call.function.name,
          rawArgs
        )
        const sanitized = sanitizeArgs(args)

        webContents.send('ai:toolStart', {
          id: call.id,
          name: call.function.name,
          args: sanitized
        })

        const result = await executeTool(request.workspaceRoot, call.function.name, args)

        webContents.send('ai:toolResult', {
          id: call.id,
          name: call.function.name,
          ok: result.ok,
          summary: result.summary
        })

        apiMessages.push({
          role: 'tool',
          tool_call_id: call.id,
          name: call.function.name,
          content: result.content
        })
      }
    }

    webContents.send('ai:error', t('ai.agentTurnLimit'))
  } catch (err) {
    if (isAbortError(err) || signal.aborted) {
      webContents.send('ai:aborted')
      return
    }
    const message = err instanceof Error ? err.message : t('common.unknownError')
    webContents.send('ai:error', message)
  } finally {
    releaseChatAbortController(abortController)
  }
}
