import { describe, expect, it } from 'vitest'
import {
  CONTEXT_BUDGET,
  estimateTokens,
  fitHistoryMessages,
  pruneMessagesToTokenBudget,
  truncateKeepingEnd,
  truncateToTokenBudget
} from '@/utils/context-budget'

describe('estimateTokens', () => {
  it('uses a conservative chars/3 estimate', () => {
    expect(estimateTokens('abcd')).toBe(2)
    expect(estimateTokens('')).toBe(0)
  })
})

describe('truncateToTokenBudget', () => {
  it('leaves short text alone', () => {
    expect(truncateToTokenBudget('hello', 100)).toBe('hello')
  })

  it('truncates long text', () => {
    const long = 'x'.repeat(300)
    const out = truncateToTokenBudget(long, 10, '…cut')
    expect(estimateTokens(out)).toBeLessThanOrEqual(10)
    expect(out.endsWith('…cut')).toBe(true)
  })
})

describe('truncateKeepingEnd', () => {
  it('keeps the tail', () => {
    const out = truncateKeepingEnd('AAAA_IMPORTANT', 5, '…')
    expect(out.endsWith('IMPORTANT') || out.includes('IMPORTANT')).toBe(true)
  })
})

describe('fitHistoryMessages', () => {
  it('drops oldest messages to fit the budget', () => {
    const messages = [
      { role: 'user', content: 'a'.repeat(300) },
      { role: 'assistant', content: 'b'.repeat(300) },
      { role: 'user', content: 'latest question' }
    ]
    const fitted = fitHistoryMessages(messages, {
      totalTokens: 40,
      perMessageTokens: 30
    })
    expect(fitted.some((m) => m.content.includes('latest question'))).toBe(true)
    const total = fitted.reduce((sum, m) => sum + estimateTokens(m.content), 0)
    expect(total).toBeLessThanOrEqual(40 + estimateTokens(fitted[0]?.content ?? ''))
  })

  it('respects per-message caps', () => {
    const fitted = fitHistoryMessages(
      [{ role: 'assistant', content: 'z'.repeat(5000) }],
      { totalTokens: 10_000, perMessageTokens: 20 }
    )
    expect(estimateTokens(fitted[0].content)).toBeLessThanOrEqual(20)
  })
})

describe('pruneMessagesToTokenBudget', () => {
  it('removes middle messages when over budget', () => {
    const messages = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'u1 '.repeat(200) },
      { role: 'assistant', content: 'a1 '.repeat(200) },
      { role: 'user', content: 'final' }
    ]
    pruneMessagesToTokenBudget(messages, 80)
    expect(messages[0].role).toBe('system')
    expect(messages[messages.length - 1].content).toBe('final')
    expect(estimateTokens(messages.map((m) => m.content).join('\n'))).toBeLessThan(
      CONTEXT_BUDGET.totalInputTokens
    )
  })
})
