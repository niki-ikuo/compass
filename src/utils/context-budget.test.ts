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

  it('does not emit lone surrogates when cutting through an emoji', () => {
    const long = `${'x'.repeat(20)}😀${'y'.repeat(20)}`
    const out = truncateToTokenBudget(long, 8, '…')
    // Lone surrogates round-trip to U+FFFD via UTF-8; valid text stays identical.
    expect(Buffer.from(out, 'utf8').toString('utf8')).toBe(out)
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

  it('removes assistant tool_calls together with following tool results', () => {
    const messages = [
      { role: 'system', content: 'sys' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          { id: 'c1', type: 'function', function: { name: 'readFile', arguments: '{"path":"a"}' } }
        ]
      },
      { role: 'tool', tool_call_id: 'c1', content: 'file contents '.repeat(80) },
      { role: 'user', content: 'final ask' }
    ]
    pruneMessagesToTokenBudget(messages, 30)
    expect(messages[0].role).toBe('system')
    expect(messages[messages.length - 1].content).toBe('final ask')
    // Must not leave a lone role:tool without its assistant tool_calls.
    const orphanTool = messages.some(
      (m, i) =>
        m.role === 'tool' &&
        !(messages[i - 1]?.role === 'assistant' && Array.isArray(messages[i - 1].tool_calls))
    )
    expect(orphanTool).toBe(false)
    expect(messages.some((m) => m.role === 'tool')).toBe(false)
  })
})
