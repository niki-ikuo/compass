import { describe, expect, it } from 'vitest'
import {
  formatAgentToolsUnsupportedError,
  parseAgentToolsUnsupportedError
} from '@/utils/agent-tools'

describe('agent-tools unsupported error codec', () => {
  it('round-trips the user-facing message', () => {
    const message = 'This model does not support tools'
    const encoded = formatAgentToolsUnsupportedError(message)
    expect(parseAgentToolsUnsupportedError(encoded)).toBe(message)
  })

  it('returns null for ordinary errors', () => {
    expect(parseAgentToolsUnsupportedError('API error 500')).toBeNull()
  })
})
