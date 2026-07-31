import { sanitizeUtf8Text, sliceUtf16Safe } from './utf8-text'

/**
 * Soft context-window management for chat / Agent API requests.
 * Uses a conservative chars÷3 estimate so CJK + code rarely under-count.
 */

export const CONTEXT_BUDGET = {
  /** Stay under common ~272k input caps with room for completion / tool overhead */
  totalInputTokens: 180_000,
  historyTokens: 60_000,
  perHistoryMessageTokens: 8_000,
  /** Latest user payload (index + refs + current file + question) */
  userPayloadTokens: 90_000,
  currentFileTokens: 30_000,
  refsTokens: 36_000,
  perRefFileTokens: 6_000,
  /** `.compass/rules.md` + optional glossary auto-attached to Ask / Edit / Agent */
  rulesTokens: 3_000,
  maxImages: 2,
  /** Raw base64 char cap per image (~75KB) */
  maxImageBase64Chars: 75_000,
  toolResultTokens: 8_000
} as const

export function estimateTokens(text: string | undefined | null): number {
  if (!text) return 0
  return Math.ceil(text.length / 3)
}

export function tokensToChars(tokens: number): number {
  return Math.max(0, Math.floor(tokens * 3))
}

export function truncateToTokenBudget(
  text: string,
  maxTokens: number,
  notice = '\n…(truncated to fit context budget)'
): string {
  if (maxTokens <= 0) return notice.trim()
  if (estimateTokens(text) <= maxTokens) return sanitizeUtf8Text(text)
  const maxChars = tokensToChars(maxTokens)
  if (notice.length >= maxChars) return sanitizeUtf8Text(sliceUtf16Safe(notice, 0, maxChars))
  return sanitizeUtf8Text(`${sliceUtf16Safe(text, 0, maxChars - notice.length)}${notice}`)
}

/** Prefer keeping the end (user question / latest content). */
export function truncateKeepingEnd(
  text: string,
  maxTokens: number,
  notice = '…(earlier context omitted to fit budget)\n'
): string {
  if (maxTokens <= 0) return notice.trim()
  if (estimateTokens(text) <= maxTokens) return sanitizeUtf8Text(text)
  const maxChars = tokensToChars(maxTokens)
  if (notice.length >= maxChars) return sanitizeUtf8Text(sliceUtf16Safe(notice, 0, maxChars))
  const bodyChars = maxChars - notice.length
  const start = Math.max(0, text.length - bodyChars)
  return sanitizeUtf8Text(`${notice}${sliceUtf16Safe(text, start)}`)
}

export interface HistoryMessageLike {
  role: string
  content: string
}

type ToolCallLike = {
  function?: { name?: string; arguments?: string }
}

type MessageForBudget = {
  role: string
  content?: unknown | null
  tool_calls?: ToolCallLike[] | null
}

/**
 * Truncate each message, then drop oldest until under budget.
 * Always keeps the newest message when possible.
 */
export function fitHistoryMessages<T extends HistoryMessageLike>(
  messages: T[],
  options: {
    totalTokens?: number
    perMessageTokens?: number
  } = {}
): T[] {
  const totalTokens = options.totalTokens ?? CONTEXT_BUDGET.historyTokens
  const perMessageTokens = options.perMessageTokens ?? CONTEXT_BUDGET.perHistoryMessageTokens
  if (messages.length === 0) return messages

  const truncated = messages.map((msg) => ({
    ...msg,
    content: truncateToTokenBudget(msg.content, perMessageTokens)
  }))

  let used = truncated.reduce((sum, msg) => sum + estimateTokens(msg.content), 0)
  if (used <= totalTokens) return truncated

  const kept: T[] = []
  used = 0
  for (let i = truncated.length - 1; i >= 0; i--) {
    const msg = truncated[i]
    const cost = estimateTokens(msg.content)
    if (kept.length > 0 && used + cost > totalTokens) {
      continue
    }
    kept.push(msg)
    used += cost
  }
  kept.reverse()

  if (kept.length < truncated.length) {
    const omitNotice = {
      ...truncated[0],
      role: 'user' as const,
      content: `[${truncated.length - kept.length} earlier message(s) omitted to fit context budget]`
    } as T
    return [omitNotice, ...kept]
  }
  return kept
}

function estimateToolCallsTokens(toolCalls: ToolCallLike[] | null | undefined): number {
  if (!toolCalls || toolCalls.length === 0) return 0
  let total = 0
  for (const call of toolCalls) {
    total += estimateTokens(call.function?.name)
    total += estimateTokens(call.function?.arguments)
  }
  return total
}

export function estimateMessageTokens(msg: MessageForBudget): number {
  let total = 0
  if (typeof msg.content === 'string') {
    total += estimateTokens(msg.content)
  } else if (Array.isArray(msg.content)) {
    for (const part of msg.content) {
      if (part && typeof part === 'object' && 'text' in part && typeof part.text === 'string') {
        total += estimateTokens(part.text)
      } else if (
        part &&
        typeof part === 'object' &&
        'image_url' in part &&
        part.image_url &&
        typeof part.image_url === 'object' &&
        'url' in part.image_url &&
        typeof part.image_url.url === 'string'
      ) {
        // Vision payloads are expensive; treat data-URL bulk conservatively.
        total += Math.ceil(part.image_url.url.length / 4)
      } else {
        total += estimateTokens(JSON.stringify(part))
      }
    }
  } else if (msg.content != null) {
    total += estimateTokens(JSON.stringify(msg.content))
  }
  total += estimateToolCallsTokens(msg.tool_calls)
  return total
}

export function estimateMessageListTokens(messages: Array<MessageForBudget>): number {
  return messages.reduce((sum, msg) => sum + estimateMessageTokens(msg), 0)
}

function hasToolCalls(msg: MessageForBudget): boolean {
  return Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0
}

/**
 * Inclusive start / exclusive end of the removable unit containing `index`.
 * Assistant messages with tool_calls are removed together with following role:tool
 * observations so OpenAI-compatible APIs never see broken tool pairs.
 */
export function getToolPairRemovalRange<T extends MessageForBudget>(
  messages: T[],
  index: number
): { start: number; end: number } {
  if (index < 0 || index >= messages.length) return { start: index, end: index }

  let start = index
  if (messages[start].role === 'tool') {
    while (start > 0 && messages[start - 1].role === 'tool') start--
    if (start > 0 && messages[start - 1].role === 'assistant' && hasToolCalls(messages[start - 1])) {
      start--
    }
  }

  let end = start + 1
  if (messages[start].role === 'assistant' && hasToolCalls(messages[start])) {
    while (end < messages.length && messages[end].role === 'tool') end++
  }

  return { start, end }
}

/**
 * Drop/truncate oldest non-system messages until under budget.
 * Mutates and returns the same array.
 * Tool-call assistants are removed as a unit with their role:tool follow-ups.
 */
export function pruneMessagesToTokenBudget<T extends MessageForBudget>(
  messages: T[],
  budgetTokens: number
): T[] {
  if (messages.length <= 2) return messages

  const shrinkContent = (msg: T, maxTokens: number): void => {
    if (typeof msg.content === 'string') {
      ;(msg as { content?: unknown }).content = truncateToTokenBudget(msg.content, maxTokens)
    }
  }

  let guard = 0
  while (estimateMessageListTokens(messages) > budgetTokens && guard < 200) {
    guard++
    // Prefer shrinking large middle messages before deleting.
    // Do not shrink assistant tool_calls payloads (JSON args) — only text content / tool results.
    let largestIndex = -1
    let largestTokens = 0
    for (let i = 1; i < messages.length - 1; i++) {
      const msg = messages[i]
      if (msg.role === 'system') continue
      if (msg.role === 'assistant' && hasToolCalls(msg)) continue
      const tokens = estimateMessageTokens(msg)
      if (tokens > largestTokens) {
        largestTokens = tokens
        largestIndex = i
      }
    }

    if (largestIndex > 0 && largestTokens > CONTEXT_BUDGET.perHistoryMessageTokens) {
      shrinkContent(messages[largestIndex], Math.floor(largestTokens / 2))
      continue
    }

    // Remove oldest non-system, non-final message — tool pairs as one unit.
    let removeAt = -1
    for (let i = 1; i < messages.length - 1; i++) {
      if (messages[i].role !== 'system') {
        removeAt = i
        break
      }
    }
    if (removeAt < 0) break

    const { start, end } = getToolPairRemovalRange(messages, removeAt)
    // Never delete the final message (caller keeps the latest turn).
    const safeEnd = Math.min(end, messages.length - 1)
    if (safeEnd <= start) break
    messages.splice(start, safeEnd - start)
  }

  return messages
}
