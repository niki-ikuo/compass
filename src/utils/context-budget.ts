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
  if (estimateTokens(text) <= maxTokens) return text
  const maxChars = tokensToChars(maxTokens)
  if (notice.length >= maxChars) return notice.slice(0, maxChars)
  return `${text.slice(0, maxChars - notice.length)}${notice}`
}

/** Prefer keeping the end (user question / latest content). */
export function truncateKeepingEnd(
  text: string,
  maxTokens: number,
  notice = '…(earlier context omitted to fit budget)\n'
): string {
  if (maxTokens <= 0) return notice.trim()
  if (estimateTokens(text) <= maxTokens) return text
  const maxChars = tokensToChars(maxTokens)
  if (notice.length >= maxChars) return notice.slice(0, maxChars)
  const bodyChars = maxChars - notice.length
  return `${notice}${text.slice(Math.max(0, text.length - bodyChars))}`
}

export interface HistoryMessageLike {
  role: string
  content: string
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

export function estimateMessageListTokens(
  messages: Array<{ content: string | unknown }>
): number {
  let total = 0
  for (const msg of messages) {
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
  }
  return total
}

/**
 * Drop/truncate oldest non-system messages until under budget.
 * Mutates and returns the same array.
 */
export function pruneMessagesToTokenBudget<
  T extends { role: string; content?: unknown | null }
>(messages: T[], budgetTokens: number): T[] {
  if (messages.length <= 2) return messages

  const shrinkContent = (msg: T, maxTokens: number): void => {
    if (typeof msg.content === 'string') {
      ;(msg as { content?: unknown }).content = truncateToTokenBudget(msg.content, maxTokens)
    }
  }

  let guard = 0
  while (
    estimateMessageListTokens(messages.map((m) => ({ content: m.content ?? '' }))) >
      budgetTokens &&
    guard < 200
  ) {
    guard++
    // Prefer shrinking large middle messages before deleting.
    let largestIndex = -1
    let largestTokens = 0
    for (let i = 1; i < messages.length - 1; i++) {
      const msg = messages[i]
      if (msg.role === 'system') continue
      const tokens =
        typeof msg.content === 'string'
          ? estimateTokens(msg.content)
          : estimateMessageListTokens([{ content: msg.content ?? '' }])
      if (tokens > largestTokens) {
        largestTokens = tokens
        largestIndex = i
      }
    }

    if (largestIndex > 0 && largestTokens > CONTEXT_BUDGET.perHistoryMessageTokens) {
      shrinkContent(messages[largestIndex], Math.floor(largestTokens / 2))
      continue
    }

    // Remove oldest non-system, non-final message.
    let removeAt = -1
    for (let i = 1; i < messages.length - 1; i++) {
      if (messages[i].role !== 'system') {
        removeAt = i
        break
      }
    }
    if (removeAt < 0) break
    messages.splice(removeAt, 1)
  }

  return messages
}
