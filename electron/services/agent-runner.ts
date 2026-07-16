import type { WebContents } from 'electron'
import { randomUUID } from 'crypto'
import { readdir, readFile, stat } from 'fs/promises'
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
import {
  resolveAgentApproval,
  resolveAgentContinue,
  waitForApproval,
  waitForContinue
} from './agent-approval'
import {
  coerceProposeActionsArgs,
  isIncompleteJson,
  parseToolArgs
} from './agent-propose-actions'
import { normalizeAgentRelativePath } from './agent-paths'
import {
  applyCheckpoint,
  applyUpdateTodo,
  formatAgentPlanForModel,
  rebuildPlanFromSteps,
  sanitizeCheckpointArgs,
  sanitizeUpdateTodoArgs,
  type AgentPlanState
} from './agent-plan'
import {
  applyRemember,
  formatAgentMemoryForModel,
  rebuildMemoryFromSteps,
  recordToolObservation,
  sanitizeRememberArgs,
  type AgentMemoryState
} from './agent-memory'
import {
  buildFileOutline,
  createAgentReadCache,
  formatCacheHit,
  getCachedRead,
  invalidateCachedPaths,
  putCachedRead,
  type AgentReadCache
} from './agent-read-cache'
import {
  normalizeVerifyChecks,
  runAgentVerify,
  VERIFY_AFTER_APPLY_NUDGE
} from './agent-verify'
import { redactSecrets, redactSecretsInArgs } from '../../src/utils/redact'
import { formatAgentToolsUnsupportedError } from '../../src/utils/agent-tools'

export { resolveAgentApproval, resolveAgentContinue }

/** 初期ターン／ツール予算（続行で追加付与） */
const MAX_AGENT_TURNS = 16
const MAX_TOOL_CALLS = 40
const CONTINUE_TURN_GRANT = 12
const CONTINUE_TOOL_GRANT = 30
const MAX_READ_BYTES = 200 * 1024
const MAX_LIST_ENTRIES = 200
const MAX_SEARCH_RESULTS = 30
const MAX_TOOL_RESULT_CHARS = 80_000
/**
 * Agent tool-call arguments (especially writeFile content) need more headroom than
 * chat answers. Settings default (4096) cuts ~300-line rewrites mid-JSON.
 */
const AGENT_OUTPUT_TOKENS_FLOOR = 32_768
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
      description:
        'Read a text file under the workspace. Path is relative to the workspace root. Re-reads of an unchanged file return a cache hit (outline only); pass force=true to reload full contents from disk.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relative path from workspace root' },
          force: {
            type: 'boolean',
            description: 'If true, bypass the in-run read cache and reload from disk'
          }
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
        'Propose workspace file/folder changes for the user to preview and approve. Paths must be relative to the workspace root. Changes are NOT applied until the user approves. Pass `actions` as a real JSON array (never a stringified JSON blob). Prefer applyPatch (unified diff with @@ -start,count +start,count @@ hunks) for edits to existing files—send only the changed hunks, not the whole file. Never use Cursor/OpenAI *** Begin Patch / *** Update File: wrappers. Combine all edits to the same file into one applyPatch action. Use writeFile for new files or tiny full rewrites. Truncated writeFile/applyPatch payloads are rejected.',
      parameters: {
        type: 'object',
        properties: {
          actions: {
            type: 'array',
            description:
              'Array of mkdir / writeFile / applyPatch / deleteFile / deleteDir objects. Must be an array, not a JSON string.',
            items: {
              type: 'object',
              properties: {
                type: {
                  type: 'string',
                  enum: ['mkdir', 'writeFile', 'applyPatch', 'deleteFile', 'deleteDir']
                },
                path: {
                  type: 'string',
                  description: 'Relative path from workspace root'
                },
                content: {
                  type: 'string',
                  description:
                    'Full file contents (required for writeFile). Prefer applyPatch for existing files instead of large rewrites.'
                },
                patch: {
                  type: 'string',
                  description:
                    'Unified diff for applyPatch (required). Use @@ -start,count +start,count @@ hunks with enough context lines (space/-/+ prefixes). ---/+++ headers optional when path is set. Do NOT wrap in *** Begin Patch / *** Update File:. Prefer small hunks; put all hunks for one file in a single patch string.'
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
        'Run a short non-interactive shell command with cwd inside the workspace. Prefer the verify tool for standard test/lint/typecheck. Use exec for builds, ad-hoc commands, or when verify has no matching script. Dangerous system/workspace-wipe commands are blocked. Destructive write commands (rm, git reset --hard, chmod, etc.) require the user to approve before running. Default timeout 30s (max 120s). Do not use for interactive programs.',
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
  },
  {
    type: 'function',
    function: {
      name: 'verify',
      description:
        'Standard post-edit verification loop: run project test / lint / typecheck via known package scripts or safe fallbacks (e.g. tsc --noEmit, cargo test). Prefer this after proposeActions is applied. Pass checks to limit which suites run; default runs all that can be resolved. If a check is missing, fall back to exec with an explicit command. On failure, fix with proposeActions and verify again before finishing. If all checks are skipped because scripts are missing, do not narrate that skip in the final user-facing reply.',
      parameters: {
        type: 'object',
        properties: {
          checks: {
            type: 'array',
            description:
              'Which checks to run. Default: test, lint, and typecheck (skips any that cannot be resolved).',
            items: {
              type: 'string',
              enum: ['test', 'lint', 'typecheck']
            }
          },
          cwd: {
            type: 'string',
            description: 'Working directory relative to workspace root (default ".")'
          },
          timeoutMs: {
            type: 'number',
            description:
              'Per-check timeout in milliseconds (default 30000, max 120000). Applied to each resolved command.'
          }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'updateTodo',
      description:
        'Maintain an explicit checklist for multi-step work. Call early with the plan, then update statuses as you progress (especially before hitting turn/tool limits). Pass todos as a JSON array of { id, content, status }. status is pending | in_progress | done | cancelled. Default replaces the full list; set merge=true to patch by id.',
      parameters: {
        type: 'object',
        properties: {
          todos: {
            type: 'array',
            description: 'Checklist items',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string', description: 'Stable item id' },
                content: { type: 'string', description: 'Short task description' },
                status: {
                  type: 'string',
                  enum: ['pending', 'in_progress', 'done', 'cancelled']
                }
              },
              required: ['id', 'content', 'status']
            }
          },
          merge: {
            type: 'boolean',
            description: 'If true, merge/update by id; otherwise replace the whole list'
          }
        },
        required: ['todos']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'checkpoint',
      description:
        'Save a short resume summary of what you have done and what remains. Call before long work bursts and whenever you approach turn/tool limits so Continue (or a follow-up) stays oriented.',
      parameters: {
        type: 'object',
        properties: {
          summary: {
            type: 'string',
            description:
              'Compact resume note: done so far, remaining steps, key paths/findings (a few sentences)'
          }
        },
        required: ['summary']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'remember',
      description:
        'Store an important finding in durable working memory (kept as conversation state across Continue and follow-ups). Use for conclusions, bug causes, API contracts, or other facts that must not be lost when tool observations are truncated. Prefer short notes.',
      parameters: {
        type: 'object',
        properties: {
          note: {
            type: 'string',
            description: 'Short durable fact to remember'
          },
          path: {
            type: 'string',
            description: 'Optional workspace-relative path this note is about'
          }
        },
        required: ['note']
      }
    }
  }
] as const

function truncatePersistedObservation(content: string): string {
  const redacted = redactSecrets(content)
  if (redacted.length <= MAX_PERSISTED_OBSERVATION_CHARS) return redacted
  return `${redacted.slice(0, MAX_PERSISTED_OBSERVATION_CHARS)}\n...(truncated for history)`
}

/**
 * 過去アシスタントの agentSteps から、モデルへ渡す調査文脈を組み立てる。
 * 計画レイヤ + 作業メモリを先頭に再注入し、個別ツール観測は予算内で付与する。
 */
function buildPriorAgentContext(steps: AgentToolStep[]): string | null {
  const usable = steps.filter(
    (step) => step.status === 'done' || step.status === 'error'
  )
  if (usable.length === 0) return null

  const planBlock = formatAgentPlanForModel(rebuildPlanFromSteps(usable))
  const memoryBlock = formatAgentMemoryForModel(rebuildMemoryFromSteps(usable))
  const header =
    '[Previous agent tool context from earlier in this chat. Prefer working memory and this summary over re-reading the same paths unless the files may have changed.]'
  const toolBlocks: string[] = []
  let total =
    (planBlock?.length ?? 0) + (memoryBlock?.length ?? 0) + header.length

  for (const step of usable) {
    // Plan / memory tools already summarized in dedicated blocks
    if (
      step.name === 'updateTodo' ||
      step.name === 'checkpoint' ||
      step.name === 'remember'
    ) {
      continue
    }
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
      toolBlocks.push('...(older tool results omitted to fit context budget)')
      break
    }
    toolBlocks.push(block)
    total += block.length + 2
  }

  if (!planBlock && !memoryBlock && toolBlocks.length === 0) return null

  const parts: string[] = []
  if (planBlock) parts.push(planBlock)
  if (memoryBlock) parts.push(memoryBlock)
  if (toolBlocks.length > 0) {
    parts.push(header)
    parts.push(...toolBlocks)
  }
  return parts.join('\n\n')
}

/** 履歴上の assistant agentSteps から計画状態を復元する */
function rebuildPlanFromHistory(history: ChatRequestMessage[]): AgentPlanState {
  const steps: AgentToolStep[] = []
  for (const msg of history) {
    if (msg.role === 'assistant' && msg.agentSteps?.length) {
      steps.push(...msg.agentSteps)
    }
  }
  return rebuildPlanFromSteps(steps)
}

function rebuildMemoryFromHistory(history: ChatRequestMessage[]): AgentMemoryState {
  const steps: AgentToolStep[] = []
  for (const msg of history) {
    if (msg.role === 'assistant' && msg.agentSteps?.length) {
      steps.push(...msg.agentSteps)
    }
  }
  return rebuildMemoryFromSteps(steps)
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
    const action = item as Partial<WorkspaceAction> & {
      type?: string
      path?: string
      content?: string
      patch?: string
    }
    if (typeof action.path !== 'string' || !action.path.trim()) continue
    if (action.type === 'mkdir') {
      actions.push({ type: 'mkdir', path: action.path })
    } else if (action.type === 'writeFile') {
      if (typeof action.content !== 'string') continue
      actions.push({ type: 'writeFile', path: action.path, content: action.content })
    } else if (action.type === 'applyPatch') {
      if (typeof action.patch !== 'string' || !action.patch.trim()) continue
      actions.push({ type: 'applyPatch', path: action.path, patch: action.patch })
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
    const a = item as { type?: string; path?: string; content?: string; patch?: string }
    if (a.type === 'writeFile') {
      const len = typeof a.content === 'string' ? a.content.length : 0
      return { type: 'writeFile', path: a.path, contentChars: len }
    }
    if (a.type === 'applyPatch') {
      const len = typeof a.patch === 'string' ? a.patch.length : 0
      return { type: 'applyPatch', path: a.path, patchChars: len }
    }
    return { type: a.type, path: a.path }
  })
  return { actionCount: raw.length, actions }
}

function sanitizeArgs(
  args: Record<string, unknown>,
  toolName?: string
): Record<string, unknown> {
  if (toolName === 'proposeActions' || Array.isArray(args.actions)) {
    return redactSecretsInArgs(sanitizeProposeActionsArgs(args))
  }
  if (toolName === 'updateTodo' || Array.isArray(args.todos)) {
    return redactSecretsInArgs(sanitizeUpdateTodoArgs(args))
  }
  if (toolName === 'checkpoint') {
    return redactSecretsInArgs(sanitizeCheckpointArgs(args))
  }
  if (toolName === 'remember') {
    return redactSecretsInArgs(sanitizeRememberArgs(args))
  }
  if (toolName === 'verify') {
    const checks = Array.isArray(args.checks)
      ? args.checks.filter(
          (c): c is string => c === 'test' || c === 'lint' || c === 'typecheck'
        )
      : undefined
    return redactSecretsInArgs({
      ...(checks && checks.length > 0 ? { checks } : {}),
      ...(typeof args.cwd === 'string' ? { cwd: args.cwd.slice(0, 200) } : {}),
      ...(typeof args.timeoutMs === 'number' ? { timeoutMs: args.timeoutMs } : {})
    })
  }
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(args)) {
    if (typeof value === 'string') {
      const limit =
        key === 'command' || key === 'summary' || key === 'note' ? 300 : 200
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

async function resolveAgentToolPath(
  workspaceRoot: string,
  pathArg: string | undefined,
  options?: { allowRoot?: boolean; defaultToRoot?: boolean }
): Promise<{ relativePath: string; absolutePath: string }> {
  const relativePath = normalizeAgentRelativePath(workspaceRoot, pathArg, {
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

/** UI / 次ターン用に path 引数を正規化してから返す */
function normalizeToolArgsForCall(
  workspaceRoot: string,
  name: string,
  args: Record<string, unknown>
): Record<string, unknown> {
  if (name === 'readFile' || name === 'listDir') {
    const relativePath = normalizeAgentRelativePath(
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
    const relativePath = normalizeAgentRelativePath(workspaceRoot, args.path, {
      defaultToRoot: true
    })
    return { ...args, path: relativePath === '.' ? '' : relativePath }
  }
  return args
}

async function executeReadFile(
  workspaceRoot: string,
  args: Record<string, unknown>,
  readCache: AgentReadCache
): Promise<{ ok: boolean; summary: string; content: string }> {
  const pathArg = typeof args.path === 'string' ? args.path : ''
  if (!pathArg.trim() || pathArg === '.') {
    return { ok: false, summary: 'path is required', content: 'Error: path is required' }
  }
  const force = args.force === true

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

    if (!force) {
      const cached = getCachedRead(readCache, relativePath)
      if (cached && cached.mtimeMs === info.mtimeMs && cached.size === info.size) {
        return formatCacheHit(cached)
      }
    }

    let text: string
    let truncated = false
    if (info.size > MAX_READ_BYTES) {
      const buffer = await readFile(absolutePath)
      text = buffer.subarray(0, MAX_READ_BYTES).toString('utf8')
      truncated = true
    } else {
      text = (await readFile(absolutePath)).toString('utf8')
    }

    const outline = buildFileOutline(relativePath, text)
    const body = truncated
      ? `# ${relativePath} (truncated)\nOutline: ${outline || '(none)'}\n${text}`
      : `# ${relativePath}\nOutline: ${outline || '(none)'}\n${text}`
    const content = truncateForModel(body)

    putCachedRead(readCache, {
      relativePath,
      mtimeMs: info.mtimeMs,
      size: info.size,
      charCount: text.length,
      outline,
      content
    })

    return {
      ok: true,
      summary: truncated
        ? `Read ${relativePath} (truncated to ${MAX_READ_BYTES} bytes)`
        : `Read ${relativePath} (${text.length} chars)`,
      content
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

function truncatedProposeActionsResult(): { ok: false; summary: string; content: string } {
  const message = t('ai.agentProposeActionsTruncated')
  return {
    ok: false,
    summary: message,
    content: message.startsWith('Error:') ? message : `Error: ${message}`
  }
}

function summarizeProposeActionsRejection(detail: string): string {
  if (!detail.toLowerCase().includes('apply failed')) {
    return 'User rejected'
  }

  const applyFailedLine = detail
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.toLowerCase().startsWith('apply failed:'))

  if (!applyFailedLine) {
    return 'Apply failed — re-propose'
  }

  return applyFailedLine.replace(/^Apply failed:\s*/i, '').trim() || 'Apply failed — re-propose'
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
        content: `${detail}\n\n${VERIFY_AFTER_APPLY_NUDGE}`
      }
    }
    const detail =
      decision.detail ??
      'User rejected the proposed workspace actions. They were not applied. You may propose a revised set of actions or continue without changes.'
    return {
      ok: false,
      summary: summarizeProposeActionsRejection(detail),
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

async function executeVerify(
  workspaceRoot: string,
  args: Record<string, unknown>,
  signal: AbortSignal
): Promise<{ ok: boolean; summary: string; content: string }> {
  const checks = normalizeVerifyChecks(args.checks)
  const cwd = typeof args.cwd === 'string' ? args.cwd : undefined
  const timeoutMs = typeof args.timeoutMs === 'number' ? args.timeoutMs : undefined
  const result = await runAgentVerify({
    workspaceRoot,
    checks,
    cwd,
    timeoutMs,
    signal
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
  signal: AbortSignal,
  plan: AgentPlanState,
  memory: AgentMemoryState,
  readCache: AgentReadCache
): Promise<{ ok: boolean; summary: string; content: string }> {
  switch (name) {
    case 'readFile':
      return executeReadFile(workspaceRoot, args, readCache)
    case 'listDir':
      return executeListDir(workspaceRoot, args)
    case 'search':
      return executeSearch(workspaceRoot, args)
    case 'exec':
      return executeExec(webContents, workspaceRoot, callId, args, signal)
    case 'verify':
      return executeVerify(workspaceRoot, args, signal)
    case 'updateTodo':
      return applyUpdateTodo(plan, args)
    case 'checkpoint':
      return applyCheckpoint(plan, args)
    case 'remember':
      return applyRemember(memory, args)
    default:
      return {
        ok: false,
        summary: `Unknown tool: ${name}`,
        content: `Error: unknown tool "${name}"`
      }
  }
}

function injectOrientationAfterContinue(
  apiMessages: ApiMessage[],
  plan: AgentPlanState,
  memory: AgentMemoryState
): void {
  const planBlock = formatAgentPlanForModel(plan)
  const memoryBlock = formatAgentMemoryForModel(memory)
  const parts = [planBlock, memoryBlock].filter(Boolean) as string[]
  if (parts.length === 0) return
  apiMessages.push({ role: 'user', content: parts.join('\n\n') })
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
 * Agent tool loop: read tools, proposeActions (preview approval), restricted exec,
 * verify (test/lint/typecheck templates), plus updateTodo / checkpoint / remember
 * for durable mid-run orientation.
 * Follow-up turns receive prior agentSteps as injected tool context + working memory.
 * Turn/tool budgets can be extended via user Continue (re-injects plan + memory).
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

    const plan = rebuildPlanFromHistory(history)
    const memory = rebuildMemoryFromHistory(history)
    const readCache = createAgentReadCache()

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
        injectOrientationAfterContinue(apiMessages, plan, memory)
      }

      webContents.send('ai:step', {
        label: t('ai.agentStepThinking', { turn: String(turn + 1) })
      })

      const body: Record<string, unknown> = {
        model: settings.model,
        messages: apiMessages,
        temperature: settings.temperature,
        max_tokens: Math.max(settings.maxTokens, AGENT_OUTPUT_TOKENS_FLOOR),
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
        injectOrientationAfterContinue(apiMessages, plan, memory)
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
        const rawArgumentText = call.function.arguments || ''
        let rawArgs = parseToolArgs(rawArgumentText)
        if (call.function.name === 'proposeActions') {
          rawArgs = coerceProposeActionsArgs(rawArgs)
        }
        const args = normalizeToolArgsForCall(
          request.workspaceRoot,
          call.function.name,
          rawArgs
        )
        const sanitized = sanitizeArgs(args, call.function.name)

        webContents.send('ai:toolStart', {
          id: call.id,
          name: call.function.name,
          args: sanitized
        })

        let result: { ok: boolean; summary: string; content: string }
        try {
          if (call.function.name === 'proposeActions') {
            // Incomplete JSON (often max_tokens cut mid-writeFile) must not become a preview.
            const incompleteArgs = isIncompleteJson(rawArgumentText)
            const hasRecoveredActions =
              Array.isArray(args.actions) && args.actions.length > 0
            if (incompleteArgs && !hasRecoveredActions) {
              result = truncatedProposeActionsResult()
            } else {
              result = await executeProposeActions(
                webContents,
                request.workspaceRoot,
                call.id,
                args,
                signal
              )
              if (result.ok) {
                const paths = extractActionPaths(args)
                invalidateCachedPaths(readCache, paths)
              }
            }
          } else {
            result = await executeTool(
              webContents,
              request.workspaceRoot,
              call.id,
              call.function.name,
              args,
              signal,
              plan,
              memory,
              readCache
            )
          }
        } catch (err) {
          if (isAbortError(err) || signal.aborted) {
            webContents.send('ai:aborted')
            return
          }
          throw err
        }

        if (call.function.name !== 'remember') {
          recordToolObservation(memory, call.function.name, args, result)
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

function extractActionPaths(args: Record<string, unknown>): string[] {
  const actions = Array.isArray(args.actions) ? args.actions : []
  const paths: string[] = []
  for (const action of actions) {
    if (!action || typeof action !== 'object') continue
    const path = (action as { path?: unknown }).path
    if (typeof path === 'string' && path.trim()) {
      paths.push(path.replace(/\\/g, '/'))
    }
  }
  return paths
}
