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

  // Several change/imperative clauses (“Aを修正して、Bも追加して”, “fix X and update Y”).
  const jaClauses = trimmed.match(
    /(?:してください|してほしい|して下さい)|(?:修正|変更|追加|削除|作成|実装|更新|書き換え|確認|調査|対応)して/g
  )
  if (jaClauses && jaClauses.length >= 2 && trimmed.length >= 24) return true

  // “修正とテスト追加” / “型修正とテスト” — multi-item without repeated して.
  if (
    trimmed.length >= 12 &&
    /(?:修正|変更|追加|削除|作成|実装|更新|確認|調査|対応|直す|直)[^。\n]{0,20}(?:と|や|および|／|\/)[^。\n]{0,20}(?:修正|変更|追加|削除|作成|実装|更新|確認|調査|テスト|型|ドキュメント|直)/.test(
      trimmed
    )
  ) {
    return true
  }

  // Two or more file paths / mentions often means a multi-step edit.
  const pathLike = trimmed.match(/@\[[^\]]+\]|\b[\w.-]+\.\w{1,12}\b/g)
  if (pathLike && pathLike.length >= 2 && trimmed.length >= 18) return true

  const enVerbs = trimmed.match(
    /\b(?:fix|add|update|create|implement|remove|delete|refactor|write|change|rename|patch)\b/gi
  )
  if (enVerbs && enVerbs.length >= 2 && trimmed.length >= 24) return true

  if (trimmed.length >= 60) {
    const connectors =
      /また、|および|かつ、|さらに、|あと、|加えて|それから|次に|and also|additionally|as well as|then also|;\s*/i
    if (connectors.test(trimmed)) return true
  }

  if (trimmed.length >= 400) {
    const paragraphs = trimmed.split(/\n\s*\n/).filter((p) => p.trim().length > 40)
    if (paragraphs.length >= 2) return true
  }

  return false
}

/**
 * Non-trivial workspace edits also benefit from a checklist first (plan → work),
 * even when the ask is a single clause. Skips tiny one-liners and pure Q&A.
 */
export function shouldPlanFirstAgentTask(text: string): boolean {
  const trimmed = text.trim()
  if (!trimmed) return false
  if (looksLikeQuestionAboutChanges(trimmed)) return false
  if (looksLikeMultiPartAgentTask(trimmed)) return true
  if (!looksLikeWorkspaceChangeRequest(trimmed)) return false

  const pathOrMention = (trimmed.match(/@\[[^\]]+\]|\b[\w.-]+\.\w{1,12}\b/g) ?? []).length
  // Multiple files → always plan-first, even for short asks.
  if (pathOrMention >= 2) return true

  // Keep "Fix the typo in README." style asks free of a forced checklist.
  if (trimmed.length < 36) return false

  const hasTargetCue =
    /(?:\.\w{1,12}\b|[/\\]|@\[|ファイル|コード|関数|メソッド|コンポーネント|\bfile\b|\bcode\b)/i.test(
      trimmed
    )
  const hasDetail = trimmed.length >= 60 || /\n/.test(trimmed)
  return hasTargetCue || hasDetail
}

/** Soft nudge before the first turn when the ask looks multi-part and no plan exists yet. */
export function formatInitialTodoPlanNudge(): string {
  return t('ai.agentInitialTodoPlanNudge')
}

/** Soft nudge when a plan-first ask got an overly coarse checklist (≤3 items). */
export function formatCoarseTodoPlanNudge(todoCount: number): string {
  return t('ai.agentCoarseTodoPlanNudge', { count: Math.max(0, todoCount) })
}

/** Non-cancelled todos — used to judge checklist coarseness. */
export function countActiveTodos(state: AgentPlanState): number {
  return state.todos.filter((item) => item.status !== 'cancelled').length
}

/** Plans at or below this active-todo count are treated as coarse for non-trivial asks. */
export const COARSE_PLAN_ACTIVE_TODO_MAX = 3

/**
 * Text-only finish (or tool rounds that skipped planning) should still force updateTodo
 * on plan-first asks before proposeActions nudges take over.
 */
export function shouldNudgeMissingTodoPlan(options: {
  userText: string
  openTodoCount: number
  updateTodoCalledThisRun: boolean
  alreadyNudging: boolean
}): boolean {
  if (options.openTodoCount > 0) return false
  if (options.updateTodoCalledThisRun) return false
  if (options.alreadyNudging) return true
  return shouldPlanFirstAgentTask(options.userText)
}

/**
 * Soft nudge when updateTodo produced a too-coarse checklist for a substantial ask.
 * Skips tiny one-liners (shouldPlanFirst false) and short single-clause edits under 60 chars
 * unless the ask already looks multi-part.
 */
export function shouldNudgeCoarseTodoPlan(options: {
  userText: string
  activeTodoCount: number
  updateTodoCalledThisRun: boolean
  alreadyNudging: boolean
}): boolean {
  if (!options.updateTodoCalledThisRun) return false
  if (options.activeTodoCount <= 0) return false
  if (options.activeTodoCount > COARSE_PLAN_ACTIVE_TODO_MAX) return false
  if (options.alreadyNudging) return true
  if (!shouldPlanFirstAgentTask(options.userText)) return false
  const trimmed = options.userText.trim()
  if (looksLikeMultiPartAgentTask(trimmed)) return true
  return trimmed.length >= 60
}

/**
 * Heuristic: user ask looks like a workspace create/edit/delete request
 * (Agent should call proposeActions rather than finish with prose).
 */
export function looksLikeQuestionAboutChanges(text: string): boolean {
  const trimmed = text.trim()
  if (!trimmed) return false

  // Q&A / advice — do not treat as a write request.
  return /(?:どう(?:やって)?(?:修正|変更|直|書|実装)|(?:修正|変更|実装|対応)(?:方法|方針|手順|理由)|(?:について)?(?:教えて|説明して|解説して)|なぜ|どうして|何が原因)|(?:how\s+(?:do|should|can|would|to)\s+(?:i\s+)?(?:fix|change|update|edit)|(?:explain|describe|advise)\b.{0,40}\b(?:fix|change|update)|what\s+(?:should|would|does)\b.{0,40}\b(?:fix|change)|why\s+(?:is|does|did|should))/i.test(
    trimmed
  )
}

export function looksLikeWorkspaceChangeRequest(text: string): boolean {
  const trimmed = text.trim()
  if (!trimmed) return false

  // Pure Q&A about how/why to change something must not force proposeActions.
  if (looksLikeQuestionAboutChanges(trimmed)) return false

  // Short follow-ups that omit verbs ("同様に bar.ts も", "same for utils.ts").
  if (
    /(?:同様に|同じよう|同じように|続けて|あわせて|合わせて|ついでに|もう一つ|もうひとつ|もお願い|もやって|も対応)|(?:\balso\b.{0,40}\b(?:for|to|in)\b|\bsame\s+(?:for|to|with)\b|\bas\s+well\b|\btoo\b\s*[.!]?\s*$)/i.test(
      trimmed
    )
  ) {
    return true
  }

  // Prefer imperative forms over bare nouns like 「修正」alone (which appear in Q&A).
  const hasJaImperative =
    /(?:修正|変更|追加|削除|作成|実装|更新|書き換え|リファクタ|追記|置き換)(?:して|してください|してほしい|して下さい)|(?:直して|直す|書いて|書き換|消して|作って|入れて|なおして)/.test(
      trimmed
    )
  const hasEnImperative =
    /(?:please\s+)?(?:fix|change|add|delete|remove|create|implement|update|refactor|write|edit|patch|rename|replace)\b/i.test(
      trimmed
    )

  if (!hasJaImperative && !hasEnImperative) return false

  // Soften false positives: without a path / mention / strong 「ください」, require
  // something that looks like a concrete edit target or an explicit request ending.
  const hasTargetCue =
    /(?:\.\w{1,12}\b|[/\\]|@\[|ファイル|コード|関数|メソッド|コンポーネント|\bfile\b|\bcode\b)/i.test(
      trimmed
    )
  const hasPoliteAsk = /(?:してください|してほしい|して下さい|お願い|please\b)/i.test(trimmed)

  if (hasTargetCue || hasPoliteAsk) return true

  // Bare short imperatives like "Fix it" / "直して" still count.
  return trimmed.length <= 40
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
 * Low todo counts (1–3) are still shown — never hide by length alone.
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

/**
 * Todo content that is only a coarse phase label (investigate / implement / test, etc.)
 * without a concrete target. Used for a soft UI hint — not a hard block.
 */
export function looksLikeVaguePhaseTodo(content: string): boolean {
  const trimmed = content.trim()
  if (!trimmed) return true

  // Concrete cues: paths, mentions, code identifiers, quoted symbols.
  if (
    /(?:\.\w{1,12}\b|[/\\]|@\[|`[^`]+`|[A-Za-z][\w.-]*\.(?:ts|tsx|js|jsx|md|css|json)\b)/i.test(
      trimmed
    )
  ) {
    return false
  }
  // Longer outcome-oriented wording is usually specific enough.
  if (trimmed.length > 36) return false

  return /^(?:調査|実装|テスト|検証|確認|修正|変更|対応|設計|レビュー|分析|調査する|実装する|テストする|検証する)(?:する|します|をおこなう|を行う)?[.。！!]?$/i.test(
    trimmed
  ) ||
    /^(?:investigate|implement(?:ation)?|test(?:ing)?|verify|verification|fix|change|review|design|analyze|analysis|plan)(?:\s+(?:it|code|the\s+code|files?|changes?))?[.!]?\s*$/i.test(
      trimmed
    )
}

/**
 * Soft UI hint: open plan whose active items are mostly vague phase labels.
 * Does not hide the panel; concrete short plans (even 1–3 items) return false.
 */
export function shouldHintCoarseAgentPlan(plan: AgentPlanState): boolean {
  if (countOpenTodos(plan) === 0) return false
  const active = plan.todos.filter((item) => item.status !== 'cancelled')
  if (active.length === 0) return false

  const vagueCount = active.filter((item) => looksLikeVaguePhaseTodo(item.content)).length
  if (vagueCount === 0) return false
  // All active items are phase-only, or a clear majority (≥2 and ≥60%).
  if (vagueCount === active.length) return true
  return vagueCount >= 2 && vagueCount >= Math.ceil(active.length * 0.6)
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
