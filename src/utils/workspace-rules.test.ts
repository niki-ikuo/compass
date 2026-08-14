import { describe, expect, it } from 'vitest'
import { parseTermPairs } from './markdown-outline'
import { parseWorkspaceInstructions } from './workspace-instructions'
import { buildDefaultInstructionsMarkdown } from './workspace-rules'

describe('workspace instruction starters', () => {
  it('builds Japanese instructions with 役割, ルール, and 用語', () => {
    const md = buildDefaultInstructionsMarkdown('ja')
    expect(md).toContain('# 役割')
    expect(md).toContain('# ルール')
    expect(md).toContain('# 用語')
    expect(md).toContain('秘密情報')
    expect(md).not.toContain('glossary.md')
  })

  it('builds English instructions with Role, Rules, and Terms', () => {
    const md = buildDefaultInstructionsMarkdown('en')
    expect(md).toContain('# Role')
    expect(md).toContain('# Rules')
    expect(md).toContain('# Terms')
    expect(md).toContain('secrets')
    expect(md).not.toContain('glossary.md')
  })

  it('does not parse starter examples as term pairs', () => {
    const ja = buildDefaultInstructionsMarkdown('ja')
    const en = buildDefaultInstructionsMarkdown('en')
    expect(parseTermPairs(parseWorkspaceInstructions(ja).terms ?? '')).toEqual([])
    expect(parseTermPairs(parseWorkspaceInstructions(en).terms ?? '')).toEqual([])
  })
})
