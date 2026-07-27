import { describe, expect, it } from 'vitest'
import {
  formatLocalDate,
  formatTokenCount,
  getUsagePeriodEnd,
  getUsagePeriodStart,
  normalizeUsageResetDay,
  parseChatCompletionUsage
} from './usage-period'

describe('normalizeUsageResetDay', () => {
  it('clamps to 1–28 and defaults invalid values', () => {
    expect(normalizeUsageResetDay(1)).toBe(1)
    expect(normalizeUsageResetDay(28)).toBe(28)
    expect(normalizeUsageResetDay(15)).toBe(15)
    expect(normalizeUsageResetDay(0)).toBe(1)
    expect(normalizeUsageResetDay(29)).toBe(1)
    expect(normalizeUsageResetDay(1.5)).toBe(1)
    expect(normalizeUsageResetDay('x')).toBe(1)
    expect(normalizeUsageResetDay(undefined)).toBe(1)
  })
})

describe('getUsagePeriodStart / getUsagePeriodEnd', () => {
  it('uses this month when day is on/after reset day', () => {
    expect(getUsagePeriodStart(new Date(2026, 6, 27), 1)).toBe('2026-07-01')
    expect(getUsagePeriodStart(new Date(2026, 6, 15), 15)).toBe('2026-07-15')
    expect(getUsagePeriodStart(new Date(2026, 6, 20), 15)).toBe('2026-07-15')
  })

  it('uses previous month when day is before reset day', () => {
    expect(getUsagePeriodStart(new Date(2026, 6, 14), 15)).toBe('2026-06-15')
    expect(getUsagePeriodStart(new Date(2026, 0, 5), 15)).toBe('2025-12-15')
  })

  it('computes inclusive period end as day before next reset', () => {
    expect(getUsagePeriodEnd('2026-07-01')).toBe('2026-07-31')
    expect(getUsagePeriodEnd('2026-07-15')).toBe('2026-08-14')
    expect(getUsagePeriodEnd('2026-01-28')).toBe('2026-02-27')
  })
})

describe('formatLocalDate / formatTokenCount / parseChatCompletionUsage', () => {
  it('formats local dates', () => {
    expect(formatLocalDate(new Date(2026, 0, 5))).toBe('2026-01-05')
  })

  it('formats token counts compactly', () => {
    expect(formatTokenCount(0)).toBe('0')
    expect(formatTokenCount(999)).toBe('999')
    expect(formatTokenCount(1200)).toBe('1.2k')
    expect(formatTokenCount(12500)).toBe('13k')
    expect(formatTokenCount(1_200_000)).toBe('1.2M')
  })

  it('parses OpenAI usage objects', () => {
    expect(parseChatCompletionUsage(null)).toBeNull()
    expect(parseChatCompletionUsage({})).toBeNull()
    expect(parseChatCompletionUsage({ prompt_tokens: 10, completion_tokens: 20 })).toEqual({
      promptTokens: 10,
      completionTokens: 20
    })
    expect(parseChatCompletionUsage({ prompt_tokens: 5 })).toEqual({
      promptTokens: 5,
      completionTokens: 0
    })
  })
})
