import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getAppPath: () => process.cwd()
  }
}))

import { pickHelpSourceIds } from './help-ask'

describe('pickHelpSourceIds', () => {
  it('prefers the current doc then search hits', () => {
    expect(
      pickHelpSourceIds(
        ['ai/chat.md', 'ai/agent.md', 'getting-started/ai-provider.md'],
        ['index.md', 'troubleshooting/faq.md'],
        'troubleshooting/common-errors.md',
        4
      )
    ).toEqual([
      'troubleshooting/common-errors.md',
      'ai/chat.md',
      'ai/agent.md',
      'getting-started/ai-provider.md'
    ])
  })

  it('backfills from catalog when hits are sparse', () => {
    expect(
      pickHelpSourceIds(['ai/chat.md'], ['index.md', 'ai/agent.md', 'troubleshooting/faq.md'], undefined, 4)
    ).toEqual(['ai/chat.md', 'index.md', 'ai/agent.md', 'troubleshooting/faq.md'])
  })

  it('dedupes ids', () => {
    expect(pickHelpSourceIds(['index.md', 'ai/chat.md'], ['index.md'], 'index.md', 3)).toEqual([
      'index.md',
      'ai/chat.md'
    ])
  })
})
