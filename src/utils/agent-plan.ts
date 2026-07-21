/** Agent plan layer: checklist (updateTodo) + resume checkpoint. */

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
  return [
    '[Agent] This looks like a multi-part or longer task.',
    'Call updateTodo first with a short checklist covering each ask, then work through items with tools.',
    'Keep todo statuses current. Related file edits may share one proposeActions; unrelated work should be separate proposals.',
    'Do not finish while any todo is pending or in_progress.'
  ].join('\n')
}

/**
 * User-role nudge when the model tries to finish with open todos.
 * Returns null when there is nothing open.
 */
export function formatOpenTodosNudge(state: AgentPlanState): string | null {
  const open = getOpenTodos(state)
  if (open.length === 0) return null
  return [
    '[Agent] Open todos remain. Do not finish yet.',
    'Continue with tools until each item is done or cancelled; call updateTodo as you progress.',
    'Only finish with text when nothing is left open.',
    '',
    `Open todos (${open.length}):`,
    formatTodosList(open)
  ].join('\n')
}

/**
 * Compact plan state for Continue / follow-up injection.
 * Returns null when there is nothing useful to remind the model about.
 */
export function formatAgentPlanForModel(state: AgentPlanState): string | null {
  const hasTodos = state.todos.length > 0
  const hasCheckpoint = Boolean(state.checkpoint?.trim())
  if (!hasTodos && !hasCheckpoint) return null

  const parts: string[] = [
    '[Agent plan checkpoint — restore orientation after a pause or Continue. Follow this plan; update with updateTodo / checkpoint as you progress.]'
  ]

  if (hasCheckpoint) {
    parts.push(`Resume summary:\n${state.checkpoint!.trim()}`)
  }

  if (hasTodos) {
    const open = getOpenTodos(state)
    const done = state.todos.filter((t) => t.status === 'done')
    parts.push(
      `Todos (${done.length} done / ${open.length} remaining):\n${formatTodosList(state.todos)}`
    )
    if (open.length > 0) {
      const next = open.find((t) => t.status === 'in_progress') ?? open[0]
      parts.push(
        `Next: mark "${next.id}" in_progress if needed, finish that item with tools, then updateTodo before starting unrelated work.`
      )
    }
  }

  return parts.join('\n\n')
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
    const t = item as Partial<AgentTodoItem>
    return {
      id: typeof t.id === 'string' ? t.id.slice(0, 40) : '?',
      content:
        typeof t.content === 'string'
          ? t.content.length > 80
            ? `${t.content.slice(0, 80)}…`
            : t.content
          : '?',
      status: typeof t.status === 'string' ? t.status : '?'
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
