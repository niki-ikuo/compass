import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getAppPath: () => process.cwd(),
    getPath: () => process.cwd()
  },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (v: string) => Buffer.from(v),
    decryptString: (b: Buffer) => b.toString()
  }
}))

import { modelIdMatches } from './ai-connection'

describe('modelIdMatches', () => {
  it('matches exact and case-insensitive ids', () => {
    expect(modelIdMatches(['gpt-4o', 'o4-mini'], 'gpt-4o')).toBe(true)
    expect(modelIdMatches(['GPT-4o'], 'gpt-4o')).toBe(true)
  })

  it('matches openrouter-style provider/model leaf', () => {
    expect(modelIdMatches(['openai/gpt-4o-mini'], 'gpt-4o-mini')).toBe(true)
    expect(modelIdMatches(['openai/gpt-4o-mini'], 'openai/gpt-4o-mini')).toBe(true)
  })

  it('rejects missing models', () => {
    expect(modelIdMatches(['gpt-4o'], 'no-such-model')).toBe(false)
    expect(modelIdMatches([], 'gpt-4o')).toBe(false)
  })
})
