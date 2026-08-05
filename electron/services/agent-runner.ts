import type { WebContents } from 'electron'
import { randomUUID } from 'crypto'
import { existsSync } from 'fs'
import { readdir, readFile, stat } from 'fs/promises'
import type {
  AgentToolStep,
  ChatRequest,
  ChatRequestMessage,
  WorkspaceAction
} from '../../src/types'
import { t } from '../../src/i18n/runtime'
import { getLlmProvider, getProviderLabel } from '../../src/utils/llm-providers'
import { withOpenWebUiChatCompat } from '../../src/utils/open-webui-compat'
import { jsonStringifyUtf8Safe } from '../../src/utils/utf8-text'
import { normalizeWorkspaceActions } from '../../src/utils/workspace-actions'
import { getSettings } from './settings'
import { recordChatCompletionUsageFireAndForget } from './usage'
import {
  acquireChatAbortController,
  buildApiHeaders,
  buildUserMessagePayload,
  getSystemPrompt,
  isAbortError,
  releaseChatAbortController,
  sendAiEvent,
  toApiUserContent
} from './ai-client'
import type { ChatContentPart } from '../../src/utils/chat-content-parts'
import { decodeFileBuffer } from './encoding'
import { previewWorkspaceActions, resolveInsideWorkspace } from './filesystem'
import { extractDocumentText } from '../../src/utils/extract-document-text'
import {
  isExtractableDocumentPath,
  MAX_EXTRACTABLE_FILE_BYTES,
  MAX_EXTRACTED_TEXT_CHARS
} from '../../src/utils/extractable-document'
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
  formatMissingProposeActionsNudge,
  formatOpenTodosNudge,
  formatTruncatedProposeActionsNudge,
  rebuildPlanFromSteps,
  sanitizeCheckpointArgs,
  sanitizeUpdateTodoArgs,
  countOpenTodos,
  countActiveTodos,
  formatOversizedTodoPlanNudge,
  formatInitialTodoPlanNudge,
  shouldPlanFirstAgentTask,
  shouldNudgeOversizedTodoPlan,
  shouldNudgeMissingProposeActions,
  shouldNudgeMissingTodoPlan,
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
  getVerifyAfterApplyNudge,
  normalizeVerifyChecks,
  runAgentVerify
} from './agent-verify'
import {
  createAgentDataSandbox,
  disposeAgentDataSandbox,
  invalidateDataSandboxPaths,
  profileDataFile,
  queryDataFiles,
  type AgentDataSandbox
} from './agent-data-sandbox'
import { redactSecrets, redactSecretsInArgs } from '../../src/utils/redact'
import { formatAgentToolsUnsupportedError } from '../../src/utils/agent-tools'
import { extractMarkdownSection } from '../../src/utils/markdown-outline'
import { normalizeUseCasePreset } from '../../src/types'
import {
  CONTEXT_BUDGET,
  fitHistoryMessages,
  pruneMessagesToTokenBudget,
  truncateToTokenBudget
} from '../../src/utils/context-budget'
import { parseChatCompletionUsage } from '../../src/utils/usage-period'

export { resolveAgentApproval, resolveAgentContinue }

/** 初期ターン／ツール予算（続行で追加付与） */
const MAX_AGENT_TURNS = 16
const MAX_TOOL_CALLS = 40
const CONTINUE_TURN_GRANT = 12
const CONTINUE_TOOL_GRANT = 30
const MAX_READ_BYTES = 200 * 1024
const MAX_LIST_ENTRIES = 200
const MAX_SEARCH_RESULTS = 30
const MAX_TOOL_RESULT_CHARS = 24_000
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
/** text-only 終了時に open todo がある場合の再促し上限（無限ループ防止） */
const MAX_OPEN_TODO_NUDGES = 2
/** multi-part なのに updateTodo 未使用の再促し上限 */
const MAX_MISSING_TODO_PLAN_NUDGES = 2
/** 過大な計画（>5）へのまとめ直し促し上限（1ラン1回） */
const MAX_OVERSIZED_TODO_PLAN_NUDGES = 1
/** text-only 終了時に proposeActions 欠落／途中切れの再促し上限 */
const MAX_PROPOSE_ACTIONS_NUDGES = 2

type ApiMessage = {
  role: string
  content?: string | ChatContentPart[] | null
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
  usage: ReturnType<typeof parseChatCompletionUsage>
}

const AGENT_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'readFile',
      description:
        'Read a text file under the workspace. Path is relative to the workspace root. PDF, .docx, and .xlsx return extracted text (not binary). Re-reads of an unchanged file return a cache hit (outline only); pass force=true to reload full contents from disk. For Markdown, optional heading returns only that section (from the heading through the next same-or-higher-level heading). When the use-case is data and the path is a tabular CSV/TSV/JSON array, prefer profileData / queryData instead of reading the whole file.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relative path from workspace root' },
          force: {
            type: 'boolean',
            description: 'If true, bypass the in-run read cache and reload from disk'
          },
          heading: {
            type: 'string',
            description:
              'Markdown only: heading text (with or without #) to read a single section instead of the whole file'
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
      description:
        'Exact/keyword search of file contents (literal text). Prefer searchMeaning for “where is X?” or topic/meaning questions.',
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
      name: 'searchMeaning',
      description:
        'Hybrid semantic search over workspace text chunks (local embeddings). Returns path, heading, and snippet citations. Use for finding relevant sections by meaning without knowing exact wording.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Natural-language or keyword query describing what to find'
          },
          path: {
            type: 'string',
            description: 'Optional subdirectory or file to scope the search'
          },
          maxResults: {
            type: 'number',
            description: 'Max hits to return (default 12, max 30)'
          }
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
        'Propose workspace file/folder changes for the user to preview and approve. Paths must be relative to the workspace root. Changes are NOT applied until the user approves. Pass `actions` as a real JSON array (never a stringified JSON blob). Prefer applyPatch (unified diff with @@ -start,count +start,count @@ hunks) for edits to existing files—send only the changed hunks, not the whole file. For Markdown section rewrites, prefer replaceSection (path + heading + section content) so other chapters stay untouched. Never use Cursor/OpenAI *** Begin Patch / *** Update File: wrappers. Combine all edits to the same file into one applyPatch action (or one replaceSection per heading). Use writeFile for new files or tiny full rewrites. Truncated writeFile/applyPatch/replaceSection payloads are rejected.',
      parameters: {
        type: 'object',
        properties: {
          actions: {
            type: 'array',
            description:
              'Array of mkdir / writeFile / applyPatch / replaceSection / deleteFile / deleteDir objects. Must be an array, not a JSON string.',
            items: {
              type: 'object',
              properties: {
                type: {
                  type: 'string',
                  enum: [
                    'mkdir',
                    'writeFile',
                    'applyPatch',
                    'replaceSection',
                    'deleteFile',
                    'deleteDir'
                  ]
                },
                path: {
                  type: 'string',
                  description: 'Relative path from workspace root'
                },
                content: {
                  type: 'string',
                  description:
                    'Full file contents (writeFile) or Markdown section body (replaceSection). Prefer applyPatch/replaceSection for existing files instead of large rewrites.'
                },
                heading: {
                  type: 'string',
                  description:
                    'Markdown heading text for replaceSection (without leading #). Replaces that heading subtree only.'
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
        'Post-edit verification. In code use-case: run project test / lint / typecheck via package scripts or safe fallbacks. In document use-case: check markdown heading structure, duplicate headings, broken relative .md links, and glossary term mismatches (`.compass/glossary.md`) on edited files. In data use-case: check CSV column counts, duplicate first-column keys, mixed column types, and JSON/YAML shape. Prefer after proposeActions is applied. Pass paths to limit which files are checked for document/data; otherwise the last applied paths are used. On failure, fix with proposeActions and verify again. If all checks are skipped because scripts/files are missing, do not narrate that skip in the final user-facing reply.',
      parameters: {
        type: 'object',
        properties: {
          checks: {
            type: 'array',
            description:
              'Code use-case only: which shell checks to run. Default: test, lint, and typecheck (skips any that cannot be resolved). Ignored for document/data light verify.',
            items: {
              type: 'string',
              enum: ['test', 'lint', 'typecheck']
            }
          },
          paths: {
            type: 'array',
            description:
              'Relative file paths to check for document/data light verify. Defaults to paths from the last applied proposeActions.',
            items: { type: 'string' }
          },
          cwd: {
            type: 'string',
            description: 'Working directory relative to workspace root (default ".")'
          },
          timeoutMs: {
            type: 'number',
            description:
              'Per-check timeout in milliseconds (default 30000, max 120000). Applied to each resolved shell command.'
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
        'Maintain a short outcome-level checklist for multi-step work and multi-ask user messages. Call early for non-trivial asks (about 3–5 verifiable deliverables; avoid phase-only labels like investigate/implement/test, and avoid micro-step over-splitting that burns turns). Hard cap is 8 items. Include acceptance-criteria clarification when unclear. Update statuses as you progress (especially before turn/tool limits); after investigation changes assumptions, revise with merge=true. Do not finish with text while any item is pending or in_progress. Pass todos as a JSON array of { id, content, status }. status is pending | in_progress | done | cancelled. Default replaces the full list; set merge=true to patch by id.',
      parameters: {
        type: 'object',
        properties: {
          todos: {
            type: 'array',
            description:
              'Checklist items. Prefer 3–5 outcome-level items for non-trivial work (hard max 8); each content should be a verifiable deliverable.',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string', description: 'Stable item id' },
                content: {
                  type: 'string',
                  description:
                    'Verifiable outcome (what to deliver or check)—not a vague phase label, and not a tiny sub-step.'
                },
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

/** Data use-case only: profile + read-only SQLite SELECT sandbox. */
const DATA_AGENT_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'profileData',
      description:
        'Default entry point for CSV / TSV / JSON (array of objects): column profile (types, null rates, uniques, samples). Always prefer this over readFile for tabular files of any size. Imports into the in-run temporary SQLite sandbox and sets alias `t` for queryData. Call this before answering schema/quality questions about a table.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Relative path to a data file from the workspace root'
          }
        },
        required: ['path']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'queryData',
      description:
        'Run a read-only SELECT (or WITH … SELECT) on tabular files in the in-memory SQLite sandbox. Imports path/paths first (or reuses tables already imported by profileData). Table names come from file basenames; alias `t` always refers to the first path. Use this for counts, filters, aggregates, and JOINs instead of reading whole files into context. Do not use DDL/DML. Prefer aggregates and LIMIT over dumping whole tables. File changes still go through proposeActions — never write back via SQL.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Primary data file to import (sets alias t)'
          },
          paths: {
            type: 'array',
            description: 'Additional data files to import (for JOINs)',
            items: { type: 'string' }
          },
          sql: {
            type: 'string',
            description: 'Single read-only SELECT statement'
          }
        },
        required: ['sql']
      }
    }
  }
] as const

function getAgentTools(preset?: import('../../src/types').UseCasePreset | null) {
  const resolved = normalizeUseCasePreset(preset)
  if (resolved === 'data') {
    return [...AGENT_TOOLS, ...DATA_AGENT_TOOLS]
  }
  return [...AGENT_TOOLS]
}

function truncatePersistedObservation(content: string): string {
  const redacted = redactSecrets(content)
  if (redacted.length <= MAX_PERSISTED_OBSERVATION_CHARS) return redacted
  return `${redacted.slice(0, MAX_PERSISTED_OBSERVATION_CHARS)}\n...(truncated for history)`
}

/** Summarize a past proposeActions step without sounding like the current request is done. */
function formatHistoricalProposeActionsStep(step: AgentToolStep): string {
  const paths = extractActionPaths(step.args ?? {})
  const pathPart = paths.length > 0 ? paths.join(', ') : '(paths unknown)'
  const outcome =
    step.ok === false
      ? step.summary?.toLowerCase().includes('reject')
        ? 'rejected'
        : 'failed'
      : 'applied'
  return `HISTORICAL proposeActions (${outcome}) paths: ${pathPart} — earlier turn only; does not fulfill the latest user request`
}

/**
 * 過去アシスタントの agentSteps から、モデルへ渡す調査文脈を組み立てる。
 * 計画レイヤ + 作業メモリを先頭に再注入し、個別ツール観測は予算内で付与する。
 * proposeActions の Applied 文は「現依頼の完了」と誤読されないよう HISTORICAL に言い換える。
 */
export function buildPriorAgentContext(steps: AgentToolStep[]): string | null {
  const usable = steps.filter(
    (step) => step.status === 'done' || step.status === 'error'
  )
  if (usable.length === 0) return null

  const planBlock = formatAgentPlanForModel(rebuildPlanFromSteps(usable))
  const memoryBlock = formatAgentMemoryForModel(rebuildMemoryFromSteps(usable))
  const header =
    '[Historical agent tool context from earlier turns in this chat. Prefer working memory and this summary over re-reading the same paths unless the files may have changed. IMPORTANT: This does NOT mean the latest user request is already done. For a new multi-part or longer ask, call updateTodo first with a fresh checklist, then work items in order. If the latest user message needs file changes, call proposeActions again — prior Applied/approved results do not satisfy a new request.]'
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

    let block: string
    if (step.name === 'proposeActions') {
      // Never re-inject "User approved and applied…" observations — they bias
      // follow-up turns into text-only finishes without a fresh proposeActions.
      block = formatHistoricalProposeActionsStep(step)
    } else {
      let argsJson = '{}'
      try {
        argsJson = JSON.stringify(step.args)
      } catch {
        argsJson = '{}'
      }
      const status = step.ok === false ? 'FAIL' : 'OK'
      const summary = step.summary?.trim() || '(no summary)'
      block = `${status} ${step.name}(${argsJson}) — ${summary}`
      if (step.observation?.trim()) {
        let observation = step.observation.trim()
        if (observation.length > MAX_PRIOR_STEP_OBSERVATION_CHARS) {
          observation = `${observation.slice(0, MAX_PRIOR_STEP_OBSERVATION_CHARS)}\n...(truncated)`
        }
        block += `\n${observation}`
      }
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
  } else if (planBlock || memoryBlock) {
    // Still remind the model that plan/memory are historical when no tool blocks.
    parts.push(header)
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

/**
 * Append prior chat turns, then a single consolidated historical tool context
 * immediately before the current user payload (added by the caller).
 * Avoids interleaving "Applied N action(s)" fake user messages after each
 * assistant reply — that pattern made follow-ups look already completed.
 */
export function appendHistoryMessages(
  apiMessages: ApiMessage[],
  history: ChatRequestMessage[]
): void {
  const prior = history.slice(0, -1)
  const fitted = fitHistoryMessages(
    prior.map((msg) => ({
      role: msg.role,
      content: msg.content,
      agentSteps: msg.agentSteps
    })),
    {
      totalTokens: CONTEXT_BUDGET.historyTokens,
      perMessageTokens: CONTEXT_BUDGET.perHistoryMessageTokens
    }
  )

  const allSteps: AgentToolStep[] = []
  for (const msg of fitted) {
    apiMessages.push({ role: msg.role, content: msg.content })
    if (msg.role === 'assistant' && msg.agentSteps?.length) {
      allSteps.push(...msg.agentSteps)
    }
  }

  const priorCtx = buildPriorAgentContext(allSteps)
  if (priorCtx) {
    apiMessages.push({
      role: 'user',
      content: truncateToTokenBudget(
        priorCtx,
        Math.floor(CONTEXT_BUDGET.perHistoryMessageTokens)
      )
    })
  }
}

async function offerAgentContinue(
  webContents: WebContents,
  chatId: string,
  signal: AbortSignal,
  payload: {
    reason: 'turns' | 'tools'
    turnsUsed: number
    toolsUsed: number
  }
): Promise<boolean> {
  const id = randomUUID()
  sendAiEvent(webContents, 'ai:needContinue', chatId, {
    id,
    reason: payload.reason,
    turnsUsed: payload.turnsUsed,
    toolsUsed: payload.toolsUsed
  })
  sendAiEvent(webContents, 'ai:step', chatId, {
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
      heading?: string
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
    } else if (action.type === 'replaceSection') {
      if (typeof action.heading !== 'string' || !action.heading.trim()) continue
      if (typeof action.content !== 'string') continue
      actions.push({
        type: 'replaceSection',
        path: action.path,
        heading: action.heading,
        content: action.content
      })
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
    const a = item as {
      type?: string
      path?: string
      content?: string
      patch?: string
      heading?: string
    }
    if (a.type === 'writeFile') {
      const len = typeof a.content === 'string' ? a.content.length : 0
      return { type: 'writeFile', path: a.path, contentChars: len }
    }
    if (a.type === 'applyPatch') {
      const len = typeof a.patch === 'string' ? a.patch.length : 0
      return { type: 'applyPatch', path: a.path, patchChars: len }
    }
    if (a.type === 'replaceSection') {
      const len = typeof a.content === 'string' ? a.content.length : 0
      return { type: 'replaceSection', path: a.path, heading: a.heading, contentChars: len }
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
    const paths = Array.isArray(args.paths)
      ? args.paths
          .filter((p): p is string => typeof p === 'string')
          .map((p) => p.slice(0, 200))
          .slice(0, 40)
      : undefined
    return redactSecretsInArgs({
      ...(checks && checks.length > 0 ? { checks } : {}),
      ...(paths && paths.length > 0 ? { paths } : {}),
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
  if (name === 'readFile' || name === 'listDir' || name === 'profileData') {
    const relativePath = normalizeAgentRelativePath(
      workspaceRoot,
      typeof args.path === 'string' ? args.path : undefined,
      { defaultToRoot: name === 'listDir' }
    )
    if ((name === 'readFile' || name === 'profileData') && !relativePath) {
      return { ...args, path: typeof args.path === 'string' ? args.path : '' }
    }
    return { ...args, path: relativePath || '.' }
  }
  if (name === 'queryData') {
    const next: Record<string, unknown> = { ...args }
    if (typeof args.path === 'string' && args.path.trim()) {
      next.path = normalizeAgentRelativePath(workspaceRoot, args.path, {
        defaultToRoot: false
      })
    }
    if (Array.isArray(args.paths)) {
      next.paths = args.paths
        .filter((p): p is string => typeof p === 'string' && p.trim().length > 0)
        .map((p) =>
          normalizeAgentRelativePath(workspaceRoot, p, { defaultToRoot: false })
        )
    }
    return next
  }
  if (
    (name === 'search' || name === 'searchMeaning') &&
    typeof args.path === 'string' &&
    args.path.trim()
  ) {
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
  const headingArg = typeof args.heading === 'string' ? args.heading.trim() : ''

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

    // Full-file cache hits only (heading slices need fresh section extract from disk text).
    if (!force && !headingArg) {
      const cached = getCachedRead(readCache, relativePath)
      if (cached && cached.mtimeMs === info.mtimeMs && cached.size === info.size) {
        return formatCacheHit(cached)
      }
    }

    let text: string
    let truncated = false
    if (isExtractableDocumentPath(relativePath)) {
      if (info.size > MAX_EXTRACTABLE_FILE_BYTES) {
        return {
          ok: false,
          summary: `file too large to extract (${relativePath})`,
          content: `Error: ${relativePath} is larger than ${MAX_EXTRACTABLE_FILE_BYTES} bytes`
        }
      }
      const buffer = await readFile(absolutePath)
      const extracted = extractDocumentText(relativePath, buffer, MAX_EXTRACTED_TEXT_CHARS)
      if (!extracted?.text.trim()) {
        return {
          ok: false,
          summary: `no extractable text (${relativePath})`,
          content: `Error: could not extract text from ${relativePath}`
        }
      }
      text = extracted.text
      truncated = extracted.truncated
    } else {
      const buffer = await readFile(absolutePath)
      if (info.size > MAX_READ_BYTES) {
        text = decodeFileBuffer(buffer.subarray(0, MAX_READ_BYTES)).content
        truncated = true
      } else {
        text = decodeFileBuffer(buffer).content
      }
    }

    const outline = buildFileOutline(relativePath, text)
    putCachedRead(readCache, {
      relativePath,
      mtimeMs: info.mtimeMs,
      size: info.size,
      charCount: text.length,
      outline,
      content: truncated
        ? `# ${relativePath} (truncated)\nOutline: ${outline || '(none)'}\n${text}`
        : `# ${relativePath}\nOutline: ${outline || '(none)'}\n${text}`
    })

    if (headingArg) {
      const section = extractMarkdownSection(text, headingArg)
      if (section === null) {
        return {
          ok: false,
          summary: `heading not found: ${headingArg}`,
          content: `Error: heading "${headingArg}" not found in ${relativePath}\nOutline: ${outline || '(none)'}`
        }
      }
      const body = `# ${relativePath} § ${headingArg}\nOutline: ${outline || '(none)'}\n${section}`
      return {
        ok: true,
        summary: `Read ${relativePath} section "${headingArg}" (${section.length} chars)`,
        content: truncateForModel(body)
      }
    }

    const body = truncated
      ? `# ${relativePath} (truncated)\nOutline: ${outline || '(none)'}\n${text}`
      : `# ${relativePath}\nOutline: ${outline || '(none)'}\n${text}`

    return {
      ok: true,
      summary: truncated
        ? `Read ${relativePath} (truncated to ${MAX_READ_BYTES} bytes)`
        : `Read ${relativePath} (${text.length} chars)`,
      content: truncateForModel(body)
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
      mode: 'keyword',
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
        const heading = match.heading ? ` [${match.heading}]` : ''
        lines.push(`L${match.line}${heading}: ${match.preview.trim()}`)
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

async function executeSearchMeaning(
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

    const requested =
      typeof args.maxResults === 'number' && Number.isFinite(args.maxResults)
        ? Math.floor(args.maxResults)
        : 12
    const maxResults = Math.min(MAX_SEARCH_RESULTS, Math.max(1, requested))

    const result = await searchWorkspace(workspaceRoot, {
      query,
      mode: 'hybrid',
      rootPath: scopedPath,
      maxResults
    })

    const lines: string[] = [
      `# searchMeaning: ${query}`,
      `hits: ${result.totalMatches}${result.truncated ? ' (truncated)' : ''}`,
      `chunksSearched: ${result.filesSearched}`,
      'Cite path + heading + line when answering.'
    ]
    for (const file of result.files) {
      for (const match of file.matches) {
        const heading = match.heading ? ` — ${match.heading}` : ''
        const score =
          typeof match.score === 'number' ? ` score=${match.score.toFixed(3)}` : ''
        lines.push(`## ${file.relativePath}${heading} (L${match.line})${score}`)
        lines.push(match.preview.trim())
      }
    }

    return {
      ok: true,
      summary: `${result.totalMatches} meaning hits in ${result.files.length} files`,
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
  chatId: string,
  workspaceRoot: string,
  callId: string,
  args: Record<string, unknown>,
  signal: AbortSignal,
  preset?: import('../../src/types').UseCasePreset | null
): Promise<{
  ok: boolean
  summary: string
  content: string
  appliedPaths?: string[]
  previewed?: boolean
}> {
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
    normalized = normalizeWorkspaceActions(workspaceRoot, parsed.actions, {
      pathExists: (absolutePath) => existsSync(absolutePath)
    })
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

  sendAiEvent(webContents, 'ai:needApproval', chatId, {
    id: callId,
    actions: normalized,
    items
  })
  sendAiEvent(webContents, 'ai:step', chatId, { label: t('ai.agentStepWaitingApproval') })

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
        content: `${detail}\n\n${getVerifyAfterApplyNudge(preset)}`,
        appliedPaths: normalized.map((a) => a.path),
        previewed: true
      }
    }
    const detail =
      decision.detail ??
      'User rejected the proposed workspace actions. They were not applied. You may propose a revised set of actions or continue without changes.'
    return {
      ok: false,
      summary: summarizeProposeActionsRejection(detail),
      content: detail,
      previewed: true
    }
  } catch (err) {
    if (isAbortError(err) || signal.aborted) {
      throw err
    }
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, summary: message, content: `Error: ${message}`, previewed: true }
  }
}

async function executeExec(
  webContents: WebContents,
  chatId: string,
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
    sendAiEvent(webContents, 'ai:needExecApproval', chatId, {
      id: callId,
      command: redactSecrets(command),
      cwd: cwdLabel,
      reason: risk.reason,
      riskKind: risk.kind
    })
    sendAiEvent(webContents, 'ai:step', chatId, { label: t('ai.agentStepWaitingExecApproval') })

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
  if (signal.aborted) {
    const err = new Error('Aborted')
    err.name = 'AbortError'
    throw err
  }
  return {
    ok: result.ok,
    summary: result.summary,
    content: truncateForModel(result.content)
  }
}

async function executeVerify(
  workspaceRoot: string,
  args: Record<string, unknown>,
  signal: AbortSignal,
  preset?: import('../../src/types').UseCasePreset | null,
  fallbackPaths?: string[]
): Promise<{ ok: boolean; summary: string; content: string }> {
  const checks = normalizeVerifyChecks(args.checks)
  const cwd = typeof args.cwd === 'string' ? args.cwd : undefined
  const timeoutMs = typeof args.timeoutMs === 'number' ? args.timeoutMs : undefined
  const argPaths = Array.isArray(args.paths)
    ? args.paths.filter((p): p is string => typeof p === 'string')
    : undefined
  const result = await runAgentVerify({
    workspaceRoot,
    checks,
    cwd,
    timeoutMs,
    signal,
    preset,
    paths: argPaths && argPaths.length > 0 ? argPaths : fallbackPaths
  })
  return {
    ok: result.ok,
    summary: result.summary,
    content: truncateForModel(result.content)
  }
}

async function executeTool(
  webContents: WebContents,
  chatId: string,
  workspaceRoot: string,
  callId: string,
  name: string,
  args: Record<string, unknown>,
  signal: AbortSignal,
  plan: AgentPlanState,
  memory: AgentMemoryState,
  readCache: AgentReadCache,
  preset?: import('../../src/types').UseCasePreset | null,
  lastAppliedPaths?: string[],
  dataSandbox?: AgentDataSandbox | null
): Promise<{ ok: boolean; summary: string; content: string }> {
  switch (name) {
    case 'readFile':
      return executeReadFile(workspaceRoot, args, readCache)
    case 'listDir':
      return executeListDir(workspaceRoot, args)
    case 'search':
      return executeSearch(workspaceRoot, args)
    case 'searchMeaning':
      return executeSearchMeaning(workspaceRoot, args)
    case 'exec':
      return executeExec(webContents, chatId, workspaceRoot, callId, args, signal)
    case 'verify':
      return executeVerify(workspaceRoot, args, signal, preset, lastAppliedPaths)
    case 'profileData': {
      if (normalizeUseCasePreset(preset) !== 'data') {
        return {
          ok: false,
          summary: 'data use-case only',
          content: 'Error: profileData is only available when use-case preset is data'
        }
      }
      if (!dataSandbox) {
        return {
          ok: false,
          summary: 'sandbox unavailable',
          content: 'Error: data sandbox is not initialized'
        }
      }
      const path = typeof args.path === 'string' ? args.path : ''
      return profileDataFile(dataSandbox, workspaceRoot, path)
    }
    case 'queryData': {
      if (normalizeUseCasePreset(preset) !== 'data') {
        return {
          ok: false,
          summary: 'data use-case only',
          content: 'Error: queryData is only available when use-case preset is data'
        }
      }
      if (!dataSandbox) {
        return {
          ok: false,
          summary: 'sandbox unavailable',
          content: 'Error: data sandbox is not initialized'
        }
      }
      return queryDataFiles(dataSandbox, workspaceRoot, args)
    }
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

/** Exported for unit tests — maps provider 400/404/422 bodies to tools-unsupported. */
export function isToolsUnsupportedApiError(status: number, body: string): boolean {
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
  chatId: string,
  url: string,
  headers: Record<string, string>,
  body: Record<string, unknown>,
  signal: AbortSignal
): Promise<StreamTurnResult> {
  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: jsonStringifyUtf8Safe(body),
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
  let lastUsage: ReturnType<typeof parseChatCompletionUsage> = null
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
            usage?: unknown
          }
          const usage = parseChatCompletionUsage(parsed.usage)
          if (usage) lastUsage = usage

          const choice = parsed.choices?.[0]
          if (!choice) continue

          if (choice.finish_reason) {
            finishReason = choice.finish_reason
          }

          const delta = choice.delta
          if (!delta) continue

          if (typeof delta.content === 'string' && delta.content) {
            content += delta.content
            sendAiEvent(webContents, 'ai:chunk', chatId, delta.content)
          }

          if (Array.isArray(delta.tool_calls)) {
            for (const part of delta.tool_calls) {
              const index = part.index ?? 0
              const existing = toolCallParts.get(index) ?? { id: '', name: '', arguments: '' }
              if (part.id) existing.id = part.id
              // Replace (do not +=): some gateways re-send the full name each chunk.
              // Function *name* fragments are vanishingly rare; arguments still concatenate.
              if (part.function?.name) existing.name = part.function.name
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

  return { content, toolCalls, finishReason, usage: lastUsage }
}

/**
 * Agent tool loop: read tools, proposeActions (preview approval), restricted exec,
 * verify (test/lint/typecheck templates), plus updateTodo / checkpoint / remember
 * for durable mid-run orientation.
 * Follow-up turns receive one consolidated historical tool-context message
 * (plan + memory + prior tool summaries) immediately before the new user ask.
 * Turn/tool budgets can be extended via user Continue (re-injects plan + memory).
 */
export async function runAgent(webContents: WebContents, request: ChatRequest): Promise<void> {
  const chatId = request.chatId?.trim() || `anon-${Date.now()}`
  const abortController = acquireChatAbortController(chatId)
  const { signal } = abortController
  const send = (channel: string, ...args: unknown[]) =>
    sendAiEvent(webContents, channel, chatId, ...args)

  try {
    if (!request.workspaceRoot) {
      send('ai:error', t('ai.agentNeedsWorkspace'))
      return
    }

    const settings = await getSettings()
    if (signal.aborted) {
      send('ai:aborted')
      return
    }

    const provider = getLlmProvider(settings.providerId)
    if (provider.agentToolsSupport === 'unsupported') {
      send(
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
      send('ai:error', t('ai.missingApiKey', { provider: getProviderLabel(provider.id) }))
      return
    }
    if (!settings.apiBaseUrl.trim()) {
      send('ai:error', t('ai.missingBaseUrl'))
      return
    }

    const history = request.messages.filter((m) => m.role !== 'system')
    const apiMessages: ApiMessage[] = [
      { role: 'system', content: getSystemPrompt('agent', request.preset) }
    ]

    appendHistoryMessages(apiMessages, history)
    apiMessages.push({
      role: 'user',
      content: toApiUserContent(await buildUserMessagePayload(request))
    })

    const plan = rebuildPlanFromHistory(history)
    const memory = rebuildMemoryFromHistory(history)
    const readCache = createAgentReadCache()
    let lastAppliedPaths: string[] = []
    const dataSandbox =
      normalizeUseCasePreset(request.preset) === 'data'
        ? await createAgentDataSandbox()
        : null

    try {
    const latestUserText = [...history].reverse().find((m) => m.role === 'user')?.content ?? ''
    // Settled todos from earlier turns must not block a fresh plan for a new plan-first ask.
    if (countOpenTodos(plan) === 0 && shouldPlanFirstAgentTask(latestUserText)) {
      apiMessages.push({ role: 'user', content: formatInitialTodoPlanNudge() })
    }

    const url = `${settings.apiBaseUrl.replace(/\/$/, '')}/chat/completions`
    const headers = buildApiHeaders(settings)
    let toolCallsUsed = 0
    let turnBudget = MAX_AGENT_TURNS
    let toolBudget = MAX_TOOL_CALLS
    let turn = 0
    let openTodoNudges = 0
    let missingTodoPlanNudges = 0
    let oversizedTodoPlanNudges = 0
    let updateTodoCalledThisRun = false
    let proposeActionsNudges = 0
    let proposeActionsApplied = false
    let proposeActionsTruncated = false
    let proposeActionsReachedPreview = false

    while (true) {
      if (signal.aborted) {
        send('ai:aborted')
        return
      }

      if (turn >= turnBudget) {
        const shouldContinue = await offerAgentContinue(webContents, chatId, signal, {
          reason: 'turns',
          turnsUsed: turn,
          toolsUsed: toolCallsUsed
        })
        if (!shouldContinue) {
          send('ai:done')
          return
        }
        turnBudget += CONTINUE_TURN_GRANT
        toolBudget += CONTINUE_TOOL_GRANT
        injectOrientationAfterContinue(apiMessages, plan, memory)
      }

      send('ai:step', {
        label: t('ai.agentStepThinking', { turn: String(turn + 1) })
      })

      pruneMessagesToTokenBudget(apiMessages, CONTEXT_BUDGET.totalInputTokens)

      const body = withOpenWebUiChatCompat(
        {
          model: settings.model,
          messages: apiMessages,
          temperature: settings.temperature,
          max_tokens: Math.max(settings.maxTokens, AGENT_OUTPUT_TOKENS_FLOOR),
          stream: true,
          stream_options: { include_usage: true },
          tools: getAgentTools(request.preset),
          tool_choice: 'auto'
        },
        settings.apiBaseUrl
      )

      let turnResult: StreamTurnResult
      try {
        turnResult = await streamAgentTurn(webContents, chatId, url, headers, body, signal)
      } catch (err) {
        if (isAbortError(err) || signal.aborted) {
          send('ai:aborted')
          return
        }
        const message = err instanceof Error ? err.message : t('common.unknownError')
        send('ai:error', message)
        return
      }

      if (signal.aborted) {
        send('ai:aborted')
        return
      }

      recordChatCompletionUsageFireAndForget(turnResult.usage)

      if (turnResult.toolCalls.length === 0) {
        // Prefer planning before proposeActions nudges on multi-part asks.
        // Otherwise the proposeActions nudge steers the model to skip updateTodo.
        const needsTodoPlan = shouldNudgeMissingTodoPlan({
          userText: latestUserText,
          openTodoCount: countOpenTodos(plan),
          updateTodoCalledThisRun,
          alreadyNudging: missingTodoPlanNudges > 0
        })
        if (needsTodoPlan && missingTodoPlanNudges < MAX_MISSING_TODO_PLAN_NUDGES) {
          missingTodoPlanNudges++
          apiMessages.push({
            role: 'assistant',
            content: turnResult.content || null
          })
          apiMessages.push({ role: 'user', content: formatInitialTodoPlanNudge() })
          turn++
          continue
        }

        // Oversized checklist (>5): ask once to consolidate before open-todo
        // "keep working" so the model stops micro-stepping.
        const needsOversizedPlan = shouldNudgeOversizedTodoPlan({
          userText: latestUserText,
          activeTodoCount: countActiveTodos(plan),
          updateTodoCalledThisRun,
          alreadyNudging: oversizedTodoPlanNudges > 0
        })
        if (needsOversizedPlan && oversizedTodoPlanNudges < MAX_OVERSIZED_TODO_PLAN_NUDGES) {
          oversizedTodoPlanNudges++
          apiMessages.push({
            role: 'assistant',
            content: turnResult.content || null
          })
          apiMessages.push({
            role: 'user',
            content: formatOversizedTodoPlanNudge(countActiveTodos(plan))
          })
          turn++
          continue
        }

        if (openTodoNudges < MAX_OPEN_TODO_NUDGES) {
          const openTodoNudge = formatOpenTodosNudge(plan)
          if (openTodoNudge) {
            openTodoNudges++
            apiMessages.push({
              role: 'assistant',
              content: turnResult.content || null
            })
            apiMessages.push({ role: 'user', content: openTodoNudge })
            turn++
            continue
          }
        }

        if (
          !needsTodoPlan &&
          proposeActionsNudges < MAX_PROPOSE_ACTIONS_NUDGES &&
          shouldNudgeMissingProposeActions({
            userText: latestUserText,
            assistantText: turnResult.content || '',
            proposeActionsApplied,
            proposeActionsTruncated,
            proposeActionsReachedPreview,
            alreadyNudging: proposeActionsNudges > 0
          })
        ) {
          proposeActionsNudges++
          const proposeNudge = proposeActionsTruncated
            ? formatTruncatedProposeActionsNudge()
            : formatMissingProposeActionsNudge()
          apiMessages.push({
            role: 'assistant',
            content: turnResult.content || null
          })
          apiMessages.push({ role: 'user', content: proposeNudge })
          turn++
          continue
        }

        send('ai:done')
        return
      }

      while (toolCallsUsed + turnResult.toolCalls.length > toolBudget) {
        const shouldContinue = await offerAgentContinue(webContents, chatId, signal, {
          reason: 'tools',
          turnsUsed: turn + 1,
          toolsUsed: toolCallsUsed
        })
        if (!shouldContinue) {
          send('ai:done')
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
          send('ai:aborted')
          return
        }

        toolCallsUsed++
        if (call.function.name === 'updateTodo') {
          updateTodoCalledThisRun = true
        }
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

        send('ai:toolStart', {
          id: call.id,
          name: call.function.name,
          args: sanitized
        })

        let result: {
          ok: boolean
          summary: string
          content: string
          appliedPaths?: string[]
          previewed?: boolean
        }
        try {
          if (call.function.name === 'proposeActions') {
            // Incomplete JSON (often max_tokens cut mid-writeFile) must not become a preview.
            // finish_reason=length is an explicit cut signal even when bracket repair looks closed.
            const cutByLength = turnResult.finishReason === 'length'
            const incompleteArgs = isIncompleteJson(rawArgumentText) || cutByLength
            const hasRecoveredActions =
              Array.isArray(args.actions) && args.actions.length > 0
            if (incompleteArgs && (!hasRecoveredActions || cutByLength)) {
              proposeActionsTruncated = true
              result = truncatedProposeActionsResult()
            } else {
              result = await executeProposeActions(
                webContents,
                chatId,
                request.workspaceRoot,
                call.id,
                args,
                signal,
                request.preset
              )
              if (result.previewed) {
                proposeActionsReachedPreview = true
              }
              if (result.ok) {
                proposeActionsApplied = true
                proposeActionsTruncated = false
                const paths =
                  result.appliedPaths && result.appliedPaths.length > 0
                    ? result.appliedPaths
                    : extractActionPaths(args)
                invalidateCachedPaths(readCache, paths)
                invalidateDataSandboxPaths(dataSandbox, paths)
                if (paths.length > 0) lastAppliedPaths = paths
              }
            }
          } else {
            result = await executeTool(
              webContents,
              chatId,
              request.workspaceRoot,
              call.id,
              call.function.name,
              args,
              signal,
              plan,
              memory,
              readCache,
              request.preset,
              lastAppliedPaths,
              dataSandbox
            )
          }
        } catch (err) {
          if (isAbortError(err) || signal.aborted) {
            send('ai:aborted')
            return
          }
          throw err
        }

        if (call.function.name !== 'remember') {
          recordToolObservation(memory, call.function.name, args, result)
        }

        const observation = truncatePersistedObservation(result.content)
        send('ai:toolResult', {
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

      // Multi-part asks that jumped straight into other tools still need a checklist.
      if (
        missingTodoPlanNudges < MAX_MISSING_TODO_PLAN_NUDGES &&
        shouldNudgeMissingTodoPlan({
          userText: latestUserText,
          openTodoCount: countOpenTodos(plan),
          updateTodoCalledThisRun,
          alreadyNudging: missingTodoPlanNudges > 0
        })
      ) {
        missingTodoPlanNudges++
        apiMessages.push({ role: 'user', content: formatInitialTodoPlanNudge() })
      } else if (
        oversizedTodoPlanNudges < MAX_OVERSIZED_TODO_PLAN_NUDGES &&
        shouldNudgeOversizedTodoPlan({
          userText: latestUserText,
          activeTodoCount: countActiveTodos(plan),
          updateTodoCalledThisRun,
          alreadyNudging: oversizedTodoPlanNudges > 0
        })
      ) {
        // updateTodo produced an oversized plan — ask once to consolidate before more work.
        oversizedTodoPlanNudges++
        apiMessages.push({
          role: 'user',
          content: formatOversizedTodoPlanNudge(countActiveTodos(plan))
        })
      }

      turn++
    }
    } finally {
      disposeAgentDataSandbox(dataSandbox)
    }
  } catch (err) {
    if (isAbortError(err) || signal.aborted) {
      send('ai:aborted')
      return
    }
    const message = err instanceof Error ? err.message : t('common.unknownError')
    send('ai:error', message)
  } finally {
    releaseChatAbortController(chatId, abortController)
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
