import { mkdtemp, mkdir, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { setLocale } from '../../src/i18n/runtime'
import { formatWorkspaceRulesForAi } from './workspace-rules'

afterEach(() => {
  setLocale('en')
})

async function makeRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'compass-rules-'))
  await mkdir(join(root, '.compass'), { recursive: true })
  return root
}

describe('formatWorkspaceRulesForAi', () => {
  it('returns null when neither rules nor glossary exist', async () => {
    const root = await makeRoot()
    expect(await formatWorkspaceRulesForAi(root)).toBeNull()
  })

  it('formats rules.md with header', async () => {
    setLocale('en')
    const root = await makeRoot()
    await writeFile(join(root, '.compass', 'rules.md'), 'Use a calm tone.\n', 'utf-8')
    const text = await formatWorkspaceRulesForAi(root)
    expect(text).toContain('[Workspace rules')
    expect(text).toContain('Use a calm tone.')
  })

  it('includes optional glossary and prefers rules under a tight budget', async () => {
    setLocale('en')
    const root = await makeRoot()
    await writeFile(
      join(root, '.compass', 'rules.md'),
      `Rules body ${'x'.repeat(2000)}\n`,
      'utf-8'
    )
    await writeFile(
      join(root, '.compass', 'glossary.md'),
      'API Key | apikey\n' + 'y'.repeat(2000),
      'utf-8'
    )
    const text = await formatWorkspaceRulesForAi(root, 200)
    expect(text).toContain('[Workspace rules')
    expect(text).toContain('Rules body')
    // Glossary may be truncated or omitted; rules must remain.
    expect(text!.toLowerCase()).toContain('rules body')
  })

  it('attaches glossary alone when rules are missing', async () => {
    setLocale('en')
    const root = await makeRoot()
    await writeFile(join(root, '.compass', 'glossary.md'), 'API Key | apikey\n', 'utf-8')
    const text = await formatWorkspaceRulesForAi(root)
    expect(text).toContain('[Workspace glossary')
    expect(text).toContain('API Key | apikey')
  })
})
