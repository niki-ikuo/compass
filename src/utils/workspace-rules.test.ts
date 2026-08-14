import { describe, expect, it } from 'vitest'
import { buildDefaultGlossaryMarkdown, buildDefaultInstructionsMarkdown } from './workspace-rules'

describe('workspace instruction starters', () => {
  it('builds Japanese instructions with 役割 and ルール', () => {
    const md = buildDefaultInstructionsMarkdown('ja')
    expect(md).toContain('# 役割')
    expect(md).toContain('# ルール')
    expect(md).toContain('秘密情報')
  })

  it('builds English instructions with Role and Rules', () => {
    const md = buildDefaultInstructionsMarkdown('en')
    expect(md).toContain('# Role')
    expect(md).toContain('# Rules')
    expect(md).toContain('secrets')
  })

  it('builds glossary starters with preferred|avoid form', () => {
    expect(buildDefaultGlossaryMarkdown('ja')).toContain('API Key |')
    expect(buildDefaultGlossaryMarkdown('en')).toContain('API Key |')
  })
})
