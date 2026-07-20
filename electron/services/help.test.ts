import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getAppPath: () => process.cwd()
  }
}))

import { normalizeHelpId, normalizeHelpLocale, parseHelpFrontmatter, resolveHelpId } from './help'

describe('normalizeHelpLocale', () => {
  it('accepts ja and en and falls back to default', () => {
    expect(normalizeHelpLocale('ja')).toBe('ja')
    expect(normalizeHelpLocale('en')).toBe('en')
    expect(normalizeHelpLocale('fr')).toBe('en')
    expect(normalizeHelpLocale(undefined)).toBe('en')
  })
})

describe('parseHelpFrontmatter', () => {
  it('parses title keywords related and commands', () => {
    const raw = `---
title: AIチャット
keywords:
  - AI
  - Chat
category: ai
related:
  - agent.md
  - ../getting-started/ai-provider.md
commands:
  - Open Settings
  - Focus Chat
---

# AIチャット

本文です。
`
    const { meta, body } = parseHelpFrontmatter(raw)
    expect(meta.title).toBe('AIチャット')
    expect(meta.keywords).toEqual(['AI', 'Chat'])
    expect(meta.category).toBe('ai')
    expect(meta.related).toEqual(['agent.md', '../getting-started/ai-provider.md'])
    expect(meta.commands).toEqual(['Open Settings', 'Focus Chat'])
    expect(body.startsWith('# AIチャット')).toBe(true)
  })

  it('returns whole text when frontmatter is missing', () => {
    const { meta, body } = parseHelpFrontmatter('# Hello\n')
    expect(meta.keywords).toEqual([])
    expect(body).toBe('# Hello\n')
  })
})

describe('resolveHelpId', () => {
  it('resolves same-folder and parent links', () => {
    expect(resolveHelpId('ai/chat.md', 'agent.md')).toBe('ai/agent.md')
    expect(resolveHelpId('ai/chat.md', '../getting-started/ai-provider.md')).toBe(
      'getting-started/ai-provider.md'
    )
    expect(resolveHelpId('index.md', 'getting-started/welcome.md')).toBe(
      'getting-started/welcome.md'
    )
  })

  it('normalizes separators', () => {
    expect(normalizeHelpId('\\ai\\chat.md')).toBe('ai/chat.md')
  })
})
