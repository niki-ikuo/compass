import { describe, expect, it } from 'vitest'
import { resolveLastSentUseCasePreset } from '@/utils/use-case-preset'
import { normalizeUseCasePreset, type ChatMessage } from '@/types'

function user(preset: ChatMessage['preset'], timestamp: number): ChatMessage {
  return {
    id: `u-${timestamp}`,
    role: 'user',
    content: 'hi',
    timestamp,
    ...(preset ? { preset } : {})
  }
}

function assistant(timestamp: number): ChatMessage {
  return {
    id: `a-${timestamp}`,
    role: 'assistant',
    content: 'ok',
    timestamp
  }
}

describe('normalizeUseCasePreset', () => {
  it('accepts known presets and rejects others', () => {
    expect(normalizeUseCasePreset('code')).toBe('code')
    expect(normalizeUseCasePreset('document')).toBe('document')
    expect(normalizeUseCasePreset('data')).toBe('data')
    expect(normalizeUseCasePreset('general')).toBe('general')
    expect(normalizeUseCasePreset('unknown')).toBeUndefined()
    expect(normalizeUseCasePreset(undefined)).toBeUndefined()
  })
})

describe('resolveLastSentUseCasePreset', () => {
  it('returns undefined when there are no user messages with preset', () => {
    expect(resolveLastSentUseCasePreset([])).toBeUndefined()
    expect(
      resolveLastSentUseCasePreset([
        { messages: [assistant(1), user(undefined, 2)] }
      ])
    ).toBeUndefined()
  })

  it('returns the preset from the most recent user send across sessions', () => {
    expect(
      resolveLastSentUseCasePreset([
        {
          messages: [user('code', 10), assistant(11), user('document', 20)]
        },
        {
          messages: [user('data', 15)]
        }
      ])
    ).toBe('document')
  })

  it('ignores assistant messages when picking the latest preset', () => {
    expect(
      resolveLastSentUseCasePreset([
        {
          messages: [user('general', 5), assistant(100)]
        }
      ])
    ).toBe('general')
  })
})
