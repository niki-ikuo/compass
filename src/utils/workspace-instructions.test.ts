import { describe, expect, it } from 'vitest'
import {
  buildInstructionsMarkdownFromLegacy,
  classifyInstructionHeading,
  parseWorkspaceInstructions,
  stripLeadingSectionHeading
} from './workspace-instructions'

describe('classifyInstructionHeading', () => {
  it('maps ja/en role, rules, and terms titles', () => {
    expect(classifyInstructionHeading('役割')).toBe('role')
    expect(classifyInstructionHeading('Role')).toBe('role')
    expect(classifyInstructionHeading('役割プロンプト')).toBe('role')
    expect(classifyInstructionHeading('ルール')).toBe('rules')
    expect(classifyInstructionHeading('Workspace rules')).toBe('rules')
    expect(classifyInstructionHeading('用語')).toBe('terms')
    expect(classifyInstructionHeading('Terms')).toBe('terms')
    expect(classifyInstructionHeading('用語集')).toBe('terms')
    expect(classifyInstructionHeading('Glossary')).toBe('terms')
    expect(classifyInstructionHeading('トーン')).toBe('other')
  })
})

describe('parseWorkspaceInstructions', () => {
  it('treats a heading-less file as rules only', () => {
    expect(parseWorkspaceInstructions('Use a calm tone.\n')).toEqual({
      role: null,
      rules: 'Use a calm tone.',
      terms: null
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
    expect(parsed.terms).toBeNull()
  })

  it('keeps the preset role when the 役割 section is empty', () => {
    const parsed = parseWorkspaceInstructions('# 役割\n\n# ルール\n丁寧に。\n')
    expect(parsed.role).toBeNull()
    expect(parsed.rules).toBe('丁寧に。')
    expect(parsed.terms).toBeNull()
  })

  it('parses English Role / Rules headings', () => {
    const parsed = parseWorkspaceInstructions('# Role\nYou are a PM.\n\n# Rules\nBe brief.\n')
    expect(parsed.role).toBe('You are a PM.')
    expect(parsed.rules).toBe('Be brief.')
    expect(parsed.terms).toBeNull()
  })

  it('splits a 用語 section out of rules', () => {
    const parsed = parseWorkspaceInstructions(
      '# 役割\nPM\n\n# ルール\n短く。\n\n# 用語\nAPI Key | apikey\n'
    )
    expect(parsed.role).toBe('PM')
    expect(parsed.rules).toBe('短く。')
    expect(parsed.terms).toBe('API Key | apikey')
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
      { role: '役割', rules: 'ルール', terms: '用語' }
    )
    expect(md).toContain('# 役割')
    expect(md).toContain('You are a PM.')
    expect(md).toContain('# ルール')
    expect(md).toContain('Be brief.')
    expect(md).toContain('# 用語')
    expect(md).not.toContain('ワークスペースルール')
    const parsed = parseWorkspaceInstructions(md!)
    expect(parsed.role).toBe('You are a PM.')
    expect(parsed.rules).toBe('Be brief.')
    expect(parsed.terms).toBeTruthy()
  })

  it('merges legacy glossary into the terms section', () => {
    const md = buildInstructionsMarkdownFromLegacy(
      'You are a PM.',
      'Be brief.',
      { role: 'Role', rules: 'Rules', terms: 'Terms' },
      '# Glossary\nAPI Key | apikey\n'
    )
    const parsed = parseWorkspaceInstructions(md!)
    expect(parsed.terms).toBe('API Key | apikey')
  })
})

describe('stripLeadingSectionHeading', () => {
  it('leaves body unchanged when the first heading is a different kind', () => {
    expect(stripLeadingSectionHeading('# トーン\n丁寧に', 'rules')).toBe('# トーン\n丁寧に')
  })
})
