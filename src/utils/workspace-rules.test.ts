import { describe, expect, it } from 'vitest'
import { buildDefaultGlossaryMarkdown, buildDefaultRoleMarkdown, buildDefaultRulesMarkdown } from './workspace-rules'

describe('workspace-rules starters', () => {
  it('builds Japanese rules starter', () => {
    const md = buildDefaultRulesMarkdown('ja')
    expect(md).toContain('# ワークスペースルール')
    expect(md).toContain('glossary.md')
  })

  it('builds English rules starter', () => {
    const md = buildDefaultRulesMarkdown('en')
    expect(md).toContain('# Workspace rules')
    expect(md).toContain('Ask / Edit / Agent')
  })

  it('builds glossary starters with preferred|avoid form', () => {
    expect(buildDefaultGlossaryMarkdown('ja')).toContain('API Key |')
    expect(buildDefaultGlossaryMarkdown('en')).toContain('API Key |')
  })

  it('builds role starters that warn against secrets', () => {
    expect(buildDefaultRoleMarkdown('ja')).toContain('# 役割')
    expect(buildDefaultRoleMarkdown('ja')).toContain('秘密情報')
    expect(buildDefaultRoleMarkdown('en')).toContain('# Role')
    expect(buildDefaultRoleMarkdown('en')).toContain('secrets')
  })
})
