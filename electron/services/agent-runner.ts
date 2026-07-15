import type { WebContents } from 'electron'
import { randomUUID } from 'crypto'
import { readdir, readFile, stat } from 'fs/promises'
import { basename, isAbsolute, join, relative, resolve } from 'path'
import type {
  AgentToolStep,
  ChatRequest,
  ChatRequestMessage,
  WorkspaceAction
} from '../../src/types'
import { t } from '../../src/i18n/runtime'
import { getLlmProvider, getProviderLabel } from '../../src/utils/llm-providers'
import { normalizeWorkspaceActions } from '../../src/utils/workspace-actions'
import { getSettings } from './settings'
import {
  acquireChatAbortController,
  buildApiHeaders,
  buildUserMessage,
  isAbortError,
  releaseChatAbortController
} from './ai-client'
import { previewWorkspaceActions, resolveInsideWorkspace } from './filesystem'
import { searchWorkspace } from './workspace-search'
import { runAgentExec, classifyAgentExecCommand } from './agent-exec'
import { redactSecrets, redactSecretsInArgs } from '../../src/utils/redact'
import { formatAgentToolsUnsupportedError } from '../../src/utils/agent-tools'

/** 初期ターン／ツール予算（続行で追加付与） */
const MAX_AGENT_TURNS = 16
const MAX_TOOL_CALLS = 40
const CONTINUE_TURN_GRANT = 12
const CONTINUE_TOOL_GRANT = 30
const MAX_READ_BYTES = 200 * 1024
const MAX_LIST_ENTRIES = 200
const MAX_SEARCH_RESULTS = 30
const MAX_TOOL_RESULT_CHARS = 80_000
/** 履歴に残すツール観測の上限（1 ステップ） */
const MAX_PERSISTED_OBSERVATION_CHARS = 4_000
/** フォローアップに載せる過去ツール文脈の合計上限 */
const MAX_PRIOR_CONTEXT_CHARS = 24_000
const MAX_PRIOR_STEP_OBSERVATION_CHARS = 3_000

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
  },
  {
    type: 'function',
    function: {
      name: 'proposeActions',
      description:
        'Propose workspace file/folder changes for the user to preview and approve. Paths must be relative to the workspace root. Changes are NOT applied until the user approves. Pass `actions` as a real JSON array (never a stringified JSON blob). Prefer one writeFile per file; for large rewrites, split into separate proposeActions calls instead of one huge payload.',
      parameters: {
        type: 'object',
        properties: {
          actions: {
            type: 'array',
            description:
              'Array of mkdir / writeFile / deleteFile / deleteDir objects. Must be an array, not a JSON string.',
            items: {
              type: 'object',
              properties: {
                type: {
                  type: 'string',
                  enum: ['mkdir', 'writeFile', 'deleteFile', 'deleteDir']
                },
                path: {
                  type: 'string',
                  description: 'Relative path from workspace root'
                },
                content: {
                  type: 'string',
                  description:
                    'File contents (required for writeFile). Keep each write reasonably sized; split large files across multiple proposeActions calls.'
                }
              },
              required: ['type', 'path']
            }
          }
        },
        required: ['actions']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'exec',
      description:
        'Run a short non-interactive shell command with cwd inside the workspace. Use for tests, lint, build, or similar feedback. Dangerous system/workspace-wipe commands are blocked. Destructive write commands (rm, git reset --hard, chmod, etc.) require the user to approve before running. Default timeout 30s (max 120s). Do not use for interactive programs.',
      parameters: {
        type: 'object',
        properties: {
          command: {
            type: 'string',
            description:
              'Shell command to run. On Windows uses Git Bash when available (else cmd.exe); elsewhere /bin/sh. Prefer POSIX-style commands when Git Bash is available.'
          },
          cwd: {
            type: 'string',
            description: 'Working directory relative to workspace root (default ".")'
          },
          timeoutMs: {
            type: 'number',
            description: 'Timeout in milliseconds (default 30000, max 120000)'
          }
        },
        required: ['command']
      }
    }
  }
] as const

type ApprovalDecision = { approved: boolean; detail?: string }
type ContinueDecision = { continue: boolean }

const pendingApprovals = new Map<
  string,
  {
    resolve: (decision: ApprovalDecision) => void
  }
>()

const pendingContinues = new Map<
  string,
  {
    resolve: (decision: ContinueDecision) => void
  }
>()

/** Renderer が preview 承認/却下後に呼ぶ */
export function resolveAgentApproval(payload: {
  id: string
  approved: boolean
  detail?: string
}): boolean {
  const pending = pendingApprovals.get(payload.id)
  if (!pending) return false
  pendingApprovals.delete(payload.id)
  pending.resolve({ approved: payload.approved, detail: payload.detail })
  return true
}

/** Renderer がターン上限の続行/停止後に呼ぶ */
export function resolveAgentContinue(payload: { id: string; continue: boolean }): boolean {
  const pending = pendingContinues.get(payload.id)
  if (!pending) return false
  pendingContinues.delete(payload.id)
  pending.resolve({ continue: payload.continue })
  return true
}

function waitForApproval(id: string, signal: AbortSignal): Promise<ApprovalDecision> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException('Aborted', 'AbortError'))
      return
    }

    const onAbort = (): void => {
      pendingApprovals.delete(id)
      signal.removeEventListener('abort', onAbort)
      reject(new DOMException('Aborted', 'AbortError'))
    }

    signal.addEventListener('abort', onAbort)
    pendingApprovals.set(id, {
      resolve: (decision) => {
        signal.removeEventListener('abort', onAbort)
        pendingApprovals.delete(id)
        resolve(decision)
      }
    })
  })
}

function waitForContinue(id: string, signal: AbortSignal): Promise<ContinueDecision> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException('Aborted', 'AbortError'))
      return
    }

    const onAbort = (): void => {
      pendingContinues.delete(id)
      signal.removeEventListener('abort', onAbort)
      reject(new DOMException('Aborted', 'AbortError'))
    }

    signal.addEventListener('abort', onAbort)
    pendingContinues.set(id, {
      resolve: (decision) => {
        signal.removeEventListener('abort', onAbort)
        pendingContinues.delete(id)
        resolve(decision)
      }
    })
  })
}

function truncatePersistedObservation(content: string): string {
  const redacted = redactSecrets(content)
  if (redacted.length <= MAX_PERSISTED_OBSERVATION_CHARS) return redacted
  return `${redacted.slice(0, MAX_PERSISTED_OBSERVATION_CHARS)}\n...(truncated for history)`
}

/**
 * 過去アシスタントの agentSteps から、モデルへ渡す調査文脈を組み立てる。
 */
function buildPriorAgentContext(steps: AgentToolStep[]): string | null {
  const usable = steps.filter(
    (step) => step.status === 'done' || step.status === 'error'
  )
  if (usable.length === 0) return null

  const header =
    '[Previous agent tool context from earlier in this chat. Prefer this over re-reading the same paths unless the files may have changed.]'
  const blocks: string[] = [header]
  let total = header.length

  for (const step of usable) {
    let argsJson = '{}'
    try {
      argsJson = JSON.stringify(step.args)
    } catch {
      argsJson = '{}'
    }
    const status = step.ok === false ? 'FAIL' : 'OK'
    const summary = step.summary?.trim() || '(no summary)'
    let block = `${status} ${step.name}(${argsJson}) — ${summary}`
    if (step.observation?.trim()) {
      let observation = step.observation.trim()
      if (observation.length > MAX_PRIOR_STEP_OBSERVATION_CHARS) {
        observation = `${observation.slice(0, MAX_PRIOR_STEP_OBSERVATION_CHARS)}\n...(truncated)`
      }
      block += `\n${observation}`
    }
    if (total + block.length + 2 > MAX_PRIOR_CONTEXT_CHARS) {
      blocks.push('...(older tool results omitted to fit context budget)')
      break
    }
    blocks.push(block)
    total += block.length + 2
  }

  return blocks.length > 1 ? blocks.join('\n\n') : null
}

function appendHistoryMessages(
  apiMessages: ApiMessage[],
  history: ChatRequestMessage[]
): void {
  for (let i = 0; i < history.length - 1; i++) {
    const msg = history[i]
    apiMessages.push({ role: msg.role, content: msg.content })
    if (msg.role !== 'assistant' || !msg.agentSteps?.length) continue
    const prior = buildPriorAgentContext(msg.agentSteps)
    if (prior) {
      apiMessages.push({ role: 'user', content: prior })
    }
  }
}

async function offerAgentContinue(
  webContents: WebContents,
  signal: AbortSignal,
  payload: {
    reason: 'turns' | 'tools'
    turnsUsed: number
    toolsUsed: number
  }
): Promise<boolean> {
  const id = randomUUID()
  webContents.send('ai:needContinue', {
    id,
    reason: payload.reason,
    turnsUsed: payload.turnsUsed,
    toolsUsed: payload.toolsUsed
  })
  webContents.send('ai:step', {
    label:
      payload.reason === 'tools'
        ? t('ai.agentStepNeedContinueTools')
        : t('ai.agentStepNeedContinueTurns')
  })
  const decision = await waitForContinue(id, signal)
  return decision.continue
}

function parseProposeActions(
  args: Record<string, unknown>
): { actions: WorkspaceAction[] } | { error: string } {
  if (!Array.isArray(args.actions) || args.actions.length === 0) {
    return {
      error: t('ai.agentProposeActionsFormatError', {
        reason: 'actions must be a non-empty array'
      })
    }
  }

  const actions: WorkspaceAction[] = []
  for (const item of args.actions) {
    if (!item || typeof item !== 'object') continue
    const action = item as Partial<WorkspaceAction> & { type?: string; path?: string; content?: string }
    if (typeof action.path !== 'string' || !action.path.trim()) continue
    if (action.type === 'mkdir') {
      actions.push({ type: 'mkdir', path: action.path })
    } else if (action.type === 'writeFile') {
      if (typeof action.content !== 'string') continue
      actions.push({ type: 'writeFile', path: action.path, content: action.content })
    } else if (action.type === 'deleteFile' || action.type === 'deleteDir') {
      actions.push({ type: action.type, path: action.path })
    }
  }

  if (actions.length === 0) {
    return {
      error: t('ai.agentProposeActionsFormatError', {
        reason: 'no valid actions in proposeActions'
      })
    }
  }
  return { actions }
}

function sanitizeProposeActionsArgs(args: Record<string, unknown>): Record<string, unknown> {
  const raw = Array.isArray(args.actions) ? args.actions : []
  const actions = raw.slice(0, 40).map((item) => {
    if (!item || typeof item !== 'object') return { type: 'unknown' }
    const a = item as { type?: string; path?: string; content?: string }
    if (a.type === 'writeFile') {
      const len = typeof a.content === 'string' ? a.content.length : 0
      return { type: 'writeFile', path: a.path, contentChars: len }
    }
    return { type: a.type, path: a.path }
  })
  return { actionCount: raw.length, actions }
}

function sanitizeArgs(args: Record<string, unknown>): Record<string, unknown> {
  if (Array.isArray(args.actions)) {
    return redactSecretsInArgs(sanitizeProposeActionsArgs(args))
  }
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(args)) {
    if (typeof value === 'string') {
      const limit = key === 'command' ? 300 : 200
      const truncated = value.length > limit ? `${value.slice(0, limit)}…` : value
      out[key] = redactSecrets(truncated)
    } else if (typeof value === 'number' || typeof value === 'boolean' || value === null) {
      out[key] = value
    } else {
      out[key] = '[complex]'
    }
  }
  return redactSecretsInArgs(out)
}

function truncateForModel(text: string): string {
  const redacted = redactSecrets(text)
  if (redacted.length <= MAX_TOOL_RESULT_CHARS) return redacted
  return `${redacted.slice(0, MAX_TOOL_RESULT_CHARS)}\n…(truncated)`
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

function buildJsonParseAttempts(raw: string): string[] {
  const trimmed = raw.trim()
  const attempts: string[] = []
  const pushUnique = (value: string) => {
    const v = value.trim()
    if (!v || attempts.includes(v)) return
    attempts.push(v)
  }

  pushUnique(trimmed)

  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fence?.[1]) pushUnique(fence[1])

  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  if (start >= 0 && end > start) {
    pushUnique(trimmed.slice(start, end + 1))
  }

  const arrayStart = trimmed.indexOf('[')
  const arrayEnd = trimmed.lastIndexOf(']')
  if (arrayStart >= 0 && arrayEnd > arrayStart) {
    pushUnique(trimmed.slice(arrayStart, arrayEnd + 1))
  }

  return attempts
}

function tryParseJsonValue(raw: string): unknown | undefined {
  for (const attempt of buildJsonParseAttempts(raw)) {
    try {
      let parsed: unknown = JSON.parse(attempt)
      // 二重エンコード: "\"{...}\"" → object
      if (typeof parsed === 'string') {
        try {
          parsed = JSON.parse(parsed)
        } catch {
          // keep string
        }
      }
      return parsed
    } catch {
      // try next
    }
  }
  return undefined
}

/**
 * LLM が actions を文字列化したり、壊れた JSON を _raw に落とした場合の回復。
 */
function coerceProposeActionsArgs(args: Record<string, unknown>): Record<string, unknown> {
  if (Array.isArray(args.actions) && args.actions.length > 0) {
    return args
  }

  const tryFromUnknown = (value: unknown): Record<string, unknown> | null => {
    if (Array.isArray(value) && value.length > 0) {
      return { actions: value }
    }
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const obj = value as Record<string, unknown>
      if (Array.isArray(obj.actions) && obj.actions.length > 0) {
        return obj
      }
      if (typeof obj.actions === 'string') {
        const nested = tryParseJsonValue(obj.actions)
        if (Array.isArray(nested) && nested.length > 0) {
          return { ...obj, actions: nested }
        }
      }
    }
    if (typeof value === 'string') {
      const nested = tryParseJsonValue(value)
      return nested === undefined ? null : tryFromUnknown(nested)
    }
    return null
  }

  if ('actions' in args) {
    const recovered = tryFromUnknown(args.actions)
    if (recovered) return recovered
  }

  if (typeof args._raw === 'string') {
    const recovered = tryFromUnknown(args._raw)
    if (recovered) return recovered
  }

  for (const value of Object.values(args)) {
    if (typeof value !== 'string') continue
    if (!value.includes('actions') && !value.includes('writeFile')) continue
    const recovered = tryFromUnknown(value)
    if (recovered) return recovered
  }

  return args
}

function parseToolArgs(raw: string): Record<string, unknown> {
  if (!raw.trim()) return {}
  const parsed = tryParseJsonValue(raw)
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    return parsed as Record<string, unknown>
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

async function executeProposeActions(
  webContents: WebContents,
  workspaceRoot: string,
  callId: string,
  args: Record<string, unknown>,
  signal: AbortSignal
): Promise<{ ok: boolean; summary: string; content: string }> {
  const parsed = parseProposeActions(args)
  if ('error' in parsed) {
    return {
      ok: false,
      summary: parsed.error,
      content: parsed.error.startsWith('Error:') ? parsed.error : `Error: ${parsed.error}`
    }
  }

  let normalized: WorkspaceAction[]
  try {
    normalized = normalizeWorkspaceActions(workspaceRoot, parsed.actions)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, summary: message, content: `Error: ${message}` }
  }

  if (normalized.length === 0) {
    return {
      ok: false,
      summary: t('ai.agentProposeActionsFormatError', {
        reason: 'no valid actions after normalization'
      }),
      content: t('ai.agentProposeActionsFormatError', {
        reason: 'no valid actions after path normalization'
      })
    }
  }

  let items
  try {
    items = await previewWorkspaceActions(workspaceRoot, normalized)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, summary: message, content: `Error building preview: ${message}` }
  }

  if (signal.aborted) {
    return { ok: false, summary: 'aborted', content: 'Error: aborted before approval' }
  }

  webContents.send('ai:needApproval', {
    id: callId,
    actions: normalized,
    items
  })
  webContents.send('ai:step', { label: t('ai.agentStepWaitingApproval') })

  try {
    const decision = await waitForApproval(callId, signal)
    if (decision.approved) {
      const detail =
        decision.detail ??
        `User approved and applied ${normalized.length} workspace action(s):\n${normalized
          .map((a) => `- ${a.type}: ${a.path}`)
          .join('\n')}`
      return {
        ok: true,
        summary: `Applied ${normalized.length} action(s)`,
        content: detail
      }
    }
    const detail =
      decision.detail ??
      'User rejected the proposed workspace actions. They were not applied. You may propose a revised set of actions or continue without changes.'
    return {
      ok: false,
      summary: 'User rejected',
      content: detail
    }
  } catch (err) {
    if (isAbortError(err) || signal.aborted) {
      throw err
    }
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, summary: message, content: `Error: ${message}` }
  }
}

async function executeExec(
  webContents: WebContents,
  workspaceRoot: string,
  callId: string,
  args: Record<string, unknown>,
  signal: AbortSignal
): Promise<{ ok: boolean; summary: string; content: string }> {
  const command = typeof args.command === 'string' ? args.command : ''
  const cwd = typeof args.cwd === 'string' ? args.cwd : undefined
  const timeoutMs = typeof args.timeoutMs === 'number' ? args.timeoutMs : undefined
  const risk = classifyAgentExecCommand(command)

  if (risk.level === 'blocked') {
    return {
      ok: false,
      summary: risk.reason,
      content: `Error: ${risk.reason}. Choose a safer command (for example delete a specific path, not the workspace root).`
    }
  }

  if (risk.level === 'needs_approval') {
    if (signal.aborted) {
      return { ok: false, summary: 'aborted', content: 'Error: aborted before exec approval' }
    }

    const cwdLabel = (cwd && cwd.trim()) || '.'
    webContents.send('ai:needExecApproval', {
      id: callId,
      command: redactSecrets(command),
      cwd: cwdLabel,
      reason: risk.reason,
      riskKind: risk.kind
    })
    webContents.send('ai:step', { label: t('ai.agentStepWaitingExecApproval') })

    try {
      const decision = await waitForApproval(callId, signal)
      if (!decision.approved) {
        const detail =
          decision.detail ??
          'User rejected this shell command. It was not executed. Propose a safer alternative or continue without it.'
        return {
          ok: false,
          summary: 'User rejected exec',
          content: detail
        }
      }
    } catch (err) {
      if (isAbortError(err) || signal.aborted) {
        throw err
      }
      const message = err instanceof Error ? err.message : String(err)
      return { ok: false, summary: message, content: `Error: ${message}` }
    }
  }

  const result = await runAgentExec({
    workspaceRoot,
    command,
    cwd,
    timeoutMs,
    signal,
    approvalGranted: risk.level === 'needs_approval'
  })
  return {
    ok: result.ok,
    summary: result.summary,
    content: truncateForModel(result.content)
  }
}

async function executeTool(
  webContents: WebContents,
  workspaceRoot: string,
  callId: string,
  name: string,
  args: Record<string, unknown>,
  signal: AbortSignal
): Promise<{ ok: boolean; summary: string; content: string }> {
  switch (name) {
    case 'readFile':
      return executeReadFile(workspaceRoot, args)
    case 'listDir':
      return executeListDir(workspaceRoot, args)
    case 'search':
      return executeSearch(workspaceRoot, args)
    case 'exec':
      return executeExec(webContents, workspaceRoot, callId, args, signal)
    default:
      return {
        ok: false,
        summary: `Unknown tool: ${name}`,
        content: `Error: unknown tool "${name}"`
      }
  }
}

function isToolsUnsupportedApiError(status: number, body: string): boolean {
  if (status !== 400 && status !== 404 && status !== 422) return false
  const b = body.toLowerCase()
  return (
    /tools?(?:\s+is|\s+are)?\s+not\s+supported/.test(b) ||
    /does not support (?:tools?|function)/.test(b) ||
    /function(?:s|\s+calling)? (?:is|are) not supported/.test(b) ||
    /tool_choice is not supported/.test(b) ||
    /unknown parameter[:\s]+['"]?tools/.test(b) ||
    /invalid parameter[:\s]+['"]?tools/.test(b) ||
    /tools are not enabled/.test(b) ||
    /model does not support tools/.test(b)
  )
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
    if (isToolsUnsupportedApiError(response.status, errorText)) {
      throw new Error(formatAgentToolsUnsupportedError(t('ai.agentToolsUnsupported')))
    }
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
 * Agent tool loop: read tools, proposeActions (preview approval), restricted exec.
 * Follow-up turns receive prior agentSteps as injected tool context.
 * Turn/tool budgets can be extended via user Continue.
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
    if (provider.agentToolsSupport === 'unsupported') {
      webContents.send(
        'ai:error',
        formatAgentToolsUnsupportedError(
          provider.id === 'ollama'
            ? t('ai.agentToolsUnsupportedOllama')
            : t('ai.agentToolsUnsupported')
        )
      )
      return
    }
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

    appendHistoryMessages(apiMessages, history)
    apiMessages.push({ role: 'user', content: await buildUserMessage(request) })

    const url = `${settings.apiBaseUrl.replace(/\/$/, '')}/chat/completions`
    const headers = buildApiHeaders(settings)
    let toolCallsUsed = 0
    let turnBudget = MAX_AGENT_TURNS
    let toolBudget = MAX_TOOL_CALLS
    let turn = 0

    while (true) {
      if (signal.aborted) {
        webContents.send('ai:aborted')
        return
      }

      if (turn >= turnBudget) {
        const shouldContinue = await offerAgentContinue(webContents, signal, {
          reason: 'turns',
          turnsUsed: turn,
          toolsUsed: toolCallsUsed
        })
        if (!shouldContinue) {
          webContents.send('ai:done')
          return
        }
        turnBudget += CONTINUE_TURN_GRANT
        toolBudget += CONTINUE_TOOL_GRANT
      }

      webContents.send('ai:step', {
        label: t('ai.agentStepThinking', { turn: String(turn + 1) })
      })

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

      while (toolCallsUsed + turnResult.toolCalls.length > toolBudget) {
        const shouldContinue = await offerAgentContinue(webContents, signal, {
          reason: 'tools',
          turnsUsed: turn + 1,
          toolsUsed: toolCallsUsed
        })
        if (!shouldContinue) {
          webContents.send('ai:done')
          return
        }
        turnBudget += CONTINUE_TURN_GRANT
        toolBudget += CONTINUE_TOOL_GRANT
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
        let rawArgs = parseToolArgs(call.function.arguments)
        if (call.function.name === 'proposeActions') {
          rawArgs = coerceProposeActionsArgs(rawArgs)
        }
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

        let result: { ok: boolean; summary: string; content: string }
        try {
          if (call.function.name === 'proposeActions') {
            result = await executeProposeActions(
              webContents,
              request.workspaceRoot,
              call.id,
              args,
              signal
            )
          } else {
            result = await executeTool(
              webContents,
              request.workspaceRoot,
              call.id,
              call.function.name,
              args,
              signal
            )
          }
        } catch (err) {
          if (isAbortError(err) || signal.aborted) {
            webContents.send('ai:aborted')
            return
          }
          throw err
        }

        const observation = truncatePersistedObservation(result.content)
        webContents.send('ai:toolResult', {
          id: call.id,
          name: call.function.name,
          ok: result.ok,
          summary: redactSecrets(result.summary),
          observation
        })

        apiMessages.push({
          role: 'tool',
          tool_call_id: call.id,
          name: call.function.name,
          content: truncateForModel(result.content)
        })
      }

      turn++
    }
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
