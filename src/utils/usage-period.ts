/** Usage period helpers (reset day 1–28). Pure — safe for main and renderer. */

export const MIN_USAGE_RESET_DAY = 1
export const MAX_USAGE_RESET_DAY = 28
export const DEFAULT_USAGE_RESET_DAY = 1

export function normalizeUsageResetDay(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isInteger(n) || n < MIN_USAGE_RESET_DAY || n > MAX_USAGE_RESET_DAY) {
    return DEFAULT_USAGE_RESET_DAY
  }
  return n
}

/** Local calendar date as YYYY-MM-DD. */
export function formatLocalDate(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/**
 * Period start for `now` given monthly reset day.
 * If today is on/after resetDay → this month's resetDay; else last month's.
 */
export function getUsagePeriodStart(now: Date, resetDay: number): string {
  const day = normalizeUsageResetDay(resetDay)
  const y = now.getFullYear()
  const m = now.getMonth()
  if (now.getDate() >= day) {
    return formatLocalDate(new Date(y, m, day))
  }
  return formatLocalDate(new Date(y, m - 1, day))
}

/** Inclusive end date of the period that starts on `periodStart`. */
export function getUsagePeriodEnd(periodStart: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(periodStart)
  if (!match) return periodStart
  const y = Number(match[1])
  const m = Number(match[2]) - 1
  const d = Number(match[3])
  const nextStart = new Date(y, m + 1, d)
  const end = new Date(nextStart)
  end.setDate(end.getDate() - 1)
  return formatLocalDate(end)
}

/** Compact token count for status bar (e.g. 1.2k, 1.2M). */
export function formatTokenCount(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '0'
  if (n >= 1_000_000) {
    const v = n / 1_000_000
    return `${v >= 10 ? Math.round(v) : Math.round(v * 10) / 10}M`
  }
  if (n >= 1000) {
    const v = n / 1000
    return `${v >= 10 ? Math.round(v) : Math.round(v * 10) / 10}k`
  }
  return String(Math.round(n))
}

export type ChatCompletionUsage = {
  promptTokens: number
  completionTokens: number
}

/** Parse OpenAI-compatible `usage` object. Returns null if missing/unusable. */
export function parseChatCompletionUsage(usage: unknown): ChatCompletionUsage | null {
  if (!usage || typeof usage !== 'object') return null
  const u = usage as { prompt_tokens?: unknown; completion_tokens?: unknown }
  const prompt =
    typeof u.prompt_tokens === 'number' && Number.isFinite(u.prompt_tokens)
      ? Math.max(0, Math.floor(u.prompt_tokens))
      : null
  const completion =
    typeof u.completion_tokens === 'number' && Number.isFinite(u.completion_tokens)
      ? Math.max(0, Math.floor(u.completion_tokens))
      : null
  if (prompt === null && completion === null) return null
  return {
    promptTokens: prompt ?? 0,
    completionTokens: completion ?? 0
  }
}
