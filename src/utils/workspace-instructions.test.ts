import { describe, expect, it } from 'vitest'
import {
  buildInstructionsMarkdownFromLegacy,
  classifyInstructionHeading,
  parseWorkspaceInstructions,
  stripLeadingSectionHeading
} from './workspace-instructions'

describe('classifyInstructionHeading', () => {
  it('maps ja/en role and rules titles', () => {
    expect(classifyInstructionHeading('役割')).toBe('role')
    expect(classifyInstructionHeading('Role')).toBe('role')
    expect(classifyInstructionHeading('役割プロンプト')).toBe('role')
    expect(classifyInstructionHeading('ルール')).toBe('rules')
    expect(classifyInstructionHeading('Workspace rules')).toBe('rules')
    expect(classifyInstructionHeading('トーン')).toBe('other')
  })
})

describe('parseWorkspaceInstructions', () => {
  it('treats a heading-less file as rules only', () => {
    expect(parseWorkspaceInstructions('Use a calm tone.\n')).toEqual({
      role: null,
      rules: 'Use a calm tone.'
    })
  })

  it('splits 役割 / ルール and keeps nested headings in the current bucket', () => {
    const md = [
      '# 役割',
      'あなたは PM です。',
      '## やらない',
      '- コードを触らない',
      '# ルール',
      '## トーン',
      '- 短く'
    ].join('\n')
    const parsed = parseWorkspaceInstructions(md)
    expect(parsed.role).toContain('あなたは PM です。')
    expect(parsed.role).toContain('コードを触らない')
    expect(parsed.rules).toContain('短く')
    expect(parsed.rules).not.toContain('PM')
  })

  it('keeps the preset role when the 役割 section is empty', () => {
    const parsed = parseWorkspaceInstructions('# 役割\n\n# ルール\n丁寧に。\n')
    expect(parsed.role).toBeNull()
    expect(parsed.rules).toBe('丁寧に。')
  })

  it('parses English Role / Rules headings', () => {
    const parsed = parseWorkspaceInstructions('# Role\nYou are a PM.\n\n# Rules\nBe brief.\n')
    expect(parsed.role).toBe('You are a PM.')
    expect(parsed.rules).toBe('Be brief.')
  })
})

describe('buildInstructionsMarkdownFromLegacy', () => {
  it('returns null when both sources are empty', () => {
    expect(buildInstructionsMarkdownFromLegacy(null, '  ')).toBeNull()
  })

  it('wraps legacy files and strips a duplicate leading heading', () => {
    const md = buildInstructionsMarkdownFromLegacy(
      '# 役割\nYou are a PM.\n',
      '# ワークスペースルール\nBe brief.\n',
      { role: '役割', rules: 'ルール' }
    )
    expect(md).toContain('# 役割')
    expect(md).toContain('You are a PM.')
    expect(md).toContain('# ルール')
    expect(md).toContain('Be brief.')
    expect(md).not.toContain('ワークスペースルール')
    const parsed = parseWorkspaceInstructions(md!)
    expect(parsed.role).toBe('You are a PM.')
    expect(parsed.rules).toBe('Be brief.')
  })
})

describe('stripLeadingSectionHeading', () => {
  it('leaves body unchanged when the first heading is a different kind', () => {
    expect(stripLeadingSectionHeading('# トーン\n丁寧に', 'rules')).toBe('# トーン\n丁寧に')
  })
})
