import { mkdtemp, mkdir, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { setLocale } from '../../src/i18n/runtime'
import { formatWorkspaceRulesForAi, loadWorkspaceRolePrompt } from './workspace-rules'

afterEach(() => {
  setLocale('en')
})

async function makeRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'compass-rules-'))
  await mkdir(join(root, '.compass'), { recursive: true })
  return root
}

describe('formatWorkspaceRulesForAi', () => {
  it('returns null when neither rules nor terms exist', async () => {
    const root = await makeRoot()
    expect(await formatWorkspaceRulesForAi(root)).toBeNull()
  })

  it('formats rules.md with header', async () => {
    setLocale('en')
    const root = await makeRoot()
    await writeFile(join(root, '.compass', 'rules.md'), 'Use a calm tone.\n', 'utf-8')
    const text = await formatWorkspaceRulesForAi(root)
    expect(text).toContain('[Workspace instructions')
    expect(text).toContain('Use a calm tone.')
  })

  it('prefers instructions.md over legacy rules.md', async () => {
    setLocale('en')
    const root = await makeRoot()
    await writeFile(join(root, '.compass', 'rules.md'), 'Legacy rules.\n', 'utf-8')
    await writeFile(
      join(root, '.compass', 'instructions.md'),
      '# Role\nYou are a PM.\n\n# Rules\nBe brief.\n',
      'utf-8'
    )
    const text = await formatWorkspaceRulesForAi(root)
    expect(text).toContain('Be brief.')
    expect(text).not.toContain('Legacy rules.')
  })

  it('attaches compact term pairs from the Terms section', async () => {
    setLocale('en')
    const root = await makeRoot()
    await writeFile(
      join(root, '.compass', 'instructions.md'),
      '# Rules\nBe brief.\n\n# Terms\nAPI Key | apikey, APIキー\n',
      'utf-8'
    )
    const text = await formatWorkspaceRulesForAi(root)
    expect(text).toContain('[Workspace instructions')
    expect(text).toContain('Be brief.')
    expect(text).toContain('[Workspace terms')
    expect(text).toContain('Prefer "API Key" over "apikey", "APIキー"')
    expect(text).not.toContain('API Key | apikey')
  })

  it('falls back to glossary.md when the Terms section is missing', async () => {
    setLocale('en')
    const root = await makeRoot()
    await writeFile(join(root, '.compass', 'glossary.md'), 'API Key | apikey\n', 'utf-8')
    const text = await formatWorkspaceRulesForAi(root)
    expect(text).toContain('[Workspace terms')
    expect(text).toContain('Prefer "API Key" over "apikey"')
  })

  it('falls back to glossary.md when the Terms section has no pairs', async () => {
    setLocale('en')
    const root = await makeRoot()
    await writeFile(join(root, '.compass', 'glossary.md'), 'API Key | apikey\n', 'utf-8')
    await writeFile(
      join(root, '.compass', 'instructions.md'),
      '# Rules\nBe brief.\n\n# Terms\nLeave empty to skip checks.\n# API Key | ignored\n',
      'utf-8'
    )
    const text = await formatWorkspaceRulesForAi(root)
    expect(text).toContain('Be brief.')
    expect(text).toContain('Prefer "API Key" over "apikey"')
    expect(text).not.toContain('ignored')
  })

  it('prefers the Terms section over glossary.md', async () => {
    setLocale('en')
    const root = await makeRoot()
    await writeFile(join(root, '.compass', 'glossary.md'), 'Old | oldterm\n', 'utf-8')
    await writeFile(
      join(root, '.compass', 'instructions.md'),
      '# Rules\nBe brief.\n\n# Terms\nAPI Key | apikey\n',
      'utf-8'
    )
    const text = await formatWorkspaceRulesForAi(root)
    expect(text).toContain('Prefer "API Key" over "apikey"')
    expect(text).not.toContain('oldterm')
  })

  it('keeps rules when the term list is present under a tight budget', async () => {
    setLocale('en')
    const root = await makeRoot()
    await writeFile(
      join(root, '.compass', 'instructions.md'),
      `# Rules\nRules body ${'x'.repeat(2000)}\n\n# Terms\nAPI Key | apikey\n`,
      'utf-8'
    )
    const text = await formatWorkspaceRulesForAi(root, 200)
    expect(text).toContain('[Workspace instructions')
    expect(text!.toLowerCase()).toContain('rules body')
  })
})

describe('loadWorkspaceRolePrompt', () => {
  it('returns null when role.md is missing or blank', async () => {
    const root = await makeRoot()
    expect(await loadWorkspaceRolePrompt(root)).toBeNull()
    await writeFile(join(root, '.compass', 'role.md'), '  \n', 'utf-8')
    expect(await loadWorkspaceRolePrompt(root)).toBeNull()
  })

  it('returns trimmed role body from legacy role.md', async () => {
    const root = await makeRoot()
    await writeFile(join(root, '.compass', 'role.md'), '  You are a PM.\n', 'utf-8')
    await expect(loadWorkspaceRolePrompt(root)).resolves.toBe('You are a PM.')
  })

  it('reads the Role section from instructions.md and ignores legacy role.md', async () => {
    const root = await makeRoot()
    await writeFile(join(root, '.compass', 'role.md'), 'Legacy role.\n', 'utf-8')
    await writeFile(
      join(root, '.compass', 'instructions.md'),
      '# Role\nYou are a PM.\n\n# Rules\nBe brief.\n',
      'utf-8'
    )
    await expect(loadWorkspaceRolePrompt(root)).resolves.toBe('You are a PM.')
  })
})
