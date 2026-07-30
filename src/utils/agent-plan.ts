/** Agent plan layer: checklist (updateTodo) + resume checkpoint. */

import { t } from '../i18n/runtime'

export type AgentTodoStatus = 'pending' | 'in_progress' | 'done' | 'cancelled'

export interface AgentTodoItem {
  id: string
  content: string
  status: AgentTodoStatus
}

export interface AgentPlanState {
  todos: AgentTodoItem[]
  /** Short resume summary — what was done / what remains */
  checkpoint: string | null
}

const MAX_TODOS = 40
const MAX_TODO_CONTENT_CHARS = 400
const MAX_CHECKPOINT_CHARS = 2_000
const VALID_STATUSES = new Set<AgentTodoStatus>([
  'pending',
  'in_progress',
  'done',
  'cancelled'
])

export function createAgentPlanState(): AgentPlanState {
  return { todos: [], checkpoint: null }
}

function normalizeStatus(raw: unknown): AgentTodoStatus | null {
  if (typeof raw !== 'string') return null
  const status = raw.trim().toLowerCase() as AgentTodoStatus
  return VALID_STATUSES.has(status) ? status : null
}

function normalizeTodoItem(item: unknown): AgentTodoItem | null {
  if (!item || typeof item !== 'object') return null
  const raw = item as Partial<AgentTodoItem>
  const id = typeof raw.id === 'string' ? raw.id.trim() : ''
  const content = typeof raw.content === 'string' ? raw.content.trim() : ''
  const status = normalizeStatus(raw.status)
  if (!id || !content || !status) return null
  return {
    id: id.slice(0, 80),
    content: content.slice(0, MAX_TODO_CONTENT_CHARS),
    status
  }
}

export function applyUpdateTodo(
  state: AgentPlanState,
  args: Record<string, unknown>
): { ok: boolean; summary: string; content: string } {
  const rawTodos = args.todos
  if (!Array.isArray(rawTodos) || rawTodos.length === 0) {
    return {
      ok: false,
      summary: 'todos must be a non-empty array',
      content: 'Error: todos must be a non-empty array of { id, content, status }'
    }
  }

  const merge = args.merge === true
  const incoming: AgentTodoItem[] = []
  for (const item of rawTodos.slice(0, MAX_TODOS)) {
    const normalized = normalizeTodoItem(item)
    if (normalized) incoming.push(normalized)
  }

  if (incoming.length === 0) {
    return {
      ok: false,
      summary: 'no valid todo items',
      content:
        'Error: no valid todos. Each item needs id (string), content (string), status (pending|in_progress|done|cancelled).'
    }
  }

  if (merge) {
    const byId = new Map(state.todos.map((t) => [t.id, t]))
    for (const item of incoming) {
      byId.set(item.id, item)
    }
    state.todos = [...byId.values()].slice(0, MAX_TODOS)
  } else {
    state.todos = incoming
  }

  const rendered = formatTodosList(state.todos)
  const done = state.todos.filter((t) => t.status === 'done').length
  const open = state.todos.filter(
    (t) => t.status === 'pending' || t.status === 'in_progress'
  ).length
  return {
    ok: true,
    summary: `Todos updated (${done} done, ${open} open, ${state.todos.length} total)`,
    content: `Todo list:\n${rendered}`
  }
}

export function applyCheckpoint(
  state: AgentPlanState,
  args: Record<string, unknown>
): { ok: boolean; summary: string; content: string } {
  const summary =
    typeof args.summary === 'string'
      ? args.summary.trim()
      : typeof args.checkpoint === 'string'
        ? args.checkpoint.trim()
        : ''
  if (!summary) {
    return {
      ok: false,
      summary: 'summary is required',
      content: 'Error: checkpoint requires a non-empty summary string'
    }
  }

  state.checkpoint = summary.slice(0, MAX_CHECKPOINT_CHARS)
  const todosBlock =
    state.todos.length > 0 ? `\n\nCurrent todos:\n${formatTodosList(state.todos)}` : ''
  return {
    ok: true,
    summary: `Checkpoint saved (${state.checkpoint.length} chars)`,
    content: `Checkpoint:\n${state.checkpoint}${todosBlock}`
  }
}

export function formatTodosList(todos: AgentTodoItem[]): string {
  if (todos.length === 0) return '(empty)'
  return todos
    .map((t) => {
      const mark =
        t.status === 'done' ? '[x]' : t.status === 'cancelled' ? '[-]' : '[ ]'
      const progress = t.status === 'in_progress' ? ' (in_progress)' : ''
      return `- ${mark} ${t.id}: ${t.content}${progress}`
    })
    .join('\n')
}

/** Todos still awaiting work (pending or in_progress). */
export function getOpenTodos(state: AgentPlanState): AgentTodoItem[] {
  return state.todos.filter((t) => t.status === 'pending' || t.status === 'in_progress')
}

export function countOpenTodos(state: AgentPlanState): number {
  return getOpenTodos(state).length
}

/**
 * Heuristic: user ask looks multi-part / longer — soft-nudge updateTodo (not a hard gate).
 */
export function looksLikeMultiPartAgentTask(text: string): boolean {
  const trimmed = text.trim()
  if (!trimmed) return false

  const listItems = trimmed.match(/^\s*(?:\d+[\.\)]|[-*•])\s+\S/gm)
  if (listItems && listItems.length >= 2) return true

  const mentions = trimmed.match(/@\[[^\]]+\]/g)
  if (mentions && mentions.length >= 3) return true

  if (trimmed.length >= 120) {
    const connectors =
      /また、|および|かつ、|さらに、|あと、|加えて|and also|additionally|as well as|then also/i
    if (connectors.test(trimmed)) return true
  }

  if (trimmed.length >= 400) {
    const paragraphs = trimmed.split(/\n\s*\n/).filter((p) => p.trim().length > 40)
    if (paragraphs.length >= 2) return true
  }

  return false
}

/** Soft nudge before the first turn when the ask looks multi-part and no plan exists yet. */
export function formatInitialTodoPlanNudge(): string {
  return t('ai.agentInitialTodoPlanNudge')
}

/**
 * Heuristic: user ask looks like a workspace create/edit/delete request
 * (Agent should call proposeActions rather than finish with prose).
 */
export function looksLikeWorkspaceChangeRequest(text: string): boolean {
  const trimmed = text.trim()
  if (!trimmed) return false

  // Imperative / change-oriented verbs (ja + en). Pure Q&A without these stays quiet.
  return /(?:修正|変更|追加|削除|作成|実装|更新|書き換え|リファクタ|追記|置き換|直して|直す|書いて|書き換|消して|作って|入れて|なおして)|(?:please\s+)?(?:fix|change|add|delete|remove|create|implement|update|refactor|write|edit|patch|rename|replace)\b/i.test(
    trimmed
  )
}

/**
 * Assistant text looks like an unapplied file proposal (fake Edit protocol,
 * embedded actions JSON, or asking for approval without proposeActions).
 */
export function assistantImpliesPendingFileChanges(text: string): boolean {
  const trimmed = text.trim()
  if (!trimmed) return false

  if (/```\s*compass-actions\b/i.test(trimmed)) return true
  if (/\bcompass-actions\b/i.test(trimmed) && /"actions"\s*:/.test(trimmed)) return true
  if (/"actions"\s*:\s*\[\s*\{/.test(trimmed)) return true
  if (
    /(?:承認して|プレビューで確認|please approve|awaiting (?:your )?approval|review (?:and )?(?:approve|apply))/i.test(
      trimmed
    )
  ) {
    return true
  }
  if (
    /\bproposeActions\b/i.test(trimmed) &&
    /"(?:writeFile|applyPatch|replaceSection|mkdir|deleteFile|deleteDir)"/.test(trimmed)
  ) {
    return true
  }
  return false
}

/**
 * Whether text-only finish should be interrupted to force a proposeActions call.
 * Skips when a proposal was already applied, or when the user already saw a preview
 * (approved or rejected) unless the assistant is dumping fake change JSON.
 * Once nudging has started this run, keep nudging until applied or the cap.
 */
export function shouldNudgeMissingProposeActions(options: {
  userText: string
  assistantText: string
  proposeActionsApplied: boolean
  proposeActionsTruncated: boolean
  proposeActionsReachedPreview: boolean
  alreadyNudging: boolean
}): boolean {
  if (options.proposeActionsApplied) return false
  if (options.proposeActionsTruncated) return true
  if (assistantImpliesPendingFileChanges(options.assistantText)) return true
  if (options.proposeActionsReachedPreview) return false
  if (options.alreadyNudging) return true
  if (looksLikeWorkspaceChangeRequest(options.userText)) return true
  return false
}

/** User-role nudge when finishing without proposeActions on a change request. */
export function formatMissingProposeActionsNudge(): string {
  return t('ai.agentMissingProposeActionsNudge')
}

/** Stronger nudge after truncated proposeActions when the model tries to finish in text. */
export function formatTruncatedProposeActionsNudge(): string {
  return t('ai.agentTruncatedProposeActionsNudge')
}

/**
 * User-role nudge when the model tries to finish with open todos.
 * Returns null when there is nothing open.
 */
export function formatOpenTodosNudge(state: AgentPlanState): string | null {
  const open = getOpenTodos(state)
  if (open.length === 0) return null
  return [t('ai.agentOpenTodosNudge', { count: open.length }), formatTodosList(open)].join('\n')
}

/**
 * Compact plan state for Continue / follow-up injection.
 * Returns null when there is nothing useful to remind the model about.
 * Fully settled todo lists (all done/cancelled) are omitted so follow-up
 * turns are not biased toward an already-finished plan.
 */
export function formatAgentPlanForModel(state: AgentPlanState): string | null {
  const open = getOpenTodos(state)
  const hasOpenTodos = open.length > 0
  const hasCheckpoint = Boolean(state.checkpoint?.trim())

  // Completed-only plans are noise after the work is finished.
  if (state.todos.length > 0 && !hasOpenTodos) return null
  if (!hasOpenTodos && !hasCheckpoint) return null

  const parts: string[] = [t('ai.agentPlanHeader')]

  if (hasCheckpoint) {
    parts.push(`${t('ai.agentPlanResumeSummary')}\n${state.checkpoint!.trim()}`)
  }

  if (hasOpenTodos) {
    const done = state.todos.filter((t) => t.status === 'done')
    parts.push(
      `${t('ai.agentPlanTodosHeading', { done: done.length, open: open.length })}\n${formatTodosList(state.todos)}`
    )
    const next = open.find((item) => item.status === 'in_progress') ?? open[0]
    parts.push(t('ai.agentPlanNext', { id: next.id }))
  }

  return parts.join('\n\n')
}

/**
 * Whether the chat Plan panel should render for this assistant message.
 * Open todos stay visible across follow-up tool turns; fully settled plans
 * only show on the message that last called updateTodo / checkpoint.
 */
export function shouldShowAgentPlanPanel(
  plan: AgentPlanState,
  messageSteps: Array<{ name: string; status?: string; ok?: boolean }>
): boolean {
  if (plan.todos.length === 0 && !plan.checkpoint?.trim()) return false
  if (countOpenTodos(plan) > 0) return true
  return messageSteps.some(
    (step) =>
      (step.name === 'updateTodo' || step.name === 'checkpoint') &&
      step.status !== 'error' &&
      step.ok !== false
  )
}

/** Rebuild plan from prior agentSteps (updateTodo / checkpoint calls in order). */
export function rebuildPlanFromSteps(
  steps: Array<{ name: string; args?: Record<string, unknown>; status?: string; ok?: boolean }>
): AgentPlanState {
  const state = createAgentPlanState()
  for (const step of steps) {
    if (step.status === 'error' || step.ok === false) continue
    if (step.name === 'updateTodo' && step.args) {
      applyUpdateTodo(state, step.args)
    } else if (step.name === 'checkpoint' && step.args) {
      applyCheckpoint(state, step.args)
    }
  }
  return state
}

/**
 * Collect assistant agentSteps from the start of a chat through `throughIndex` (inclusive).
 * Matches runtime plan rebuild from history so follow-up turns keep showing prior todos.
 */
export function collectAgentStepsThrough<T extends { name: string }>(
  messages: Array<{ role: string; agentSteps?: T[] }>,
  throughIndex: number
): T[] {
  const steps: T[] = []
  const end = Math.min(throughIndex, messages.length - 1)
  for (let i = 0; i <= end; i++) {
    const msg = messages[i]
    if (msg.role === 'assistant' && msg.agentSteps?.length) {
      steps.push(...msg.agentSteps)
    }
  }
  return steps
}

export function sanitizeUpdateTodoArgs(args: Record<string, unknown>): Record<string, unknown> {
  const raw = Array.isArray(args.todos) ? args.todos : []
  const todos = raw.slice(0, MAX_TODOS).map((item) => {
    if (!item || typeof item !== 'object') return { id: '?', content: '?', status: '?' }
    const todo = item as Partial<AgentTodoItem>
    return {
      id: typeof todo.id === 'string' ? todo.id.slice(0, 40) : '?',
      content:
        typeof todo.content === 'string'
          ? todo.content.length > 80
            ? `${todo.content.slice(0, 80)}…`
            : todo.content
          : '?',
      status: typeof todo.status === 'string' ? todo.status : '?'
    }
  })
  return {
    merge: args.merge === true,
    todos,
    todoCount: todos.length
  }
}

export function sanitizeCheckpointArgs(args: Record<string, unknown>): Record<string, unknown> {
  const summary =
    typeof args.summary === 'string'
      ? args.summary
      : typeof args.checkpoint === 'string'
        ? args.checkpoint
        : ''
  const truncated = summary.length > 200 ? `${summary.slice(0, 200)}…` : summary
  return { summary: truncated, summaryChars: summary.length }
}
