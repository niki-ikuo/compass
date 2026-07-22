import { mkdirSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { afterEach, describe, expect, it } from 'vitest'
import { runAgentVerify } from './agent-verify'

const roots: string[] = []

function makeRoot(name: string): string {
  const root = join(tmpdir(), `compass-light-${name}-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(root, { recursive: true })
  roots.push(root)
  return root
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    try {
      rmSync(root, { recursive: true, force: true })
    } catch {
      // ignore
    }
  }
})

describe('runAgentVerify use-case light checks', () => {
  it('runs headings check for document preset', async () => {
    const root = makeRoot('doc')
    writeFileSync(join(root, 'notes.md'), '# Title\n### Jump\n')
    const result = await runAgentVerify({
      workspaceRoot: root,
      preset: 'document',
      paths: ['notes.md'],
      signal: new AbortController().signal
    })
    expect(result.checks.some((c) => c.check === 'headings')).toBe(true)
    expect(result.ok).toBe(false)
    expect(result.summary).toMatch(/verify failed: headings/)
  })

  it('runs schema check for data preset', async () => {
    const root = makeRoot('data')
    writeFileSync(join(root, 'rows.csv'), 'a,b\n1\n')
    const result = await runAgentVerify({
      workspaceRoot: root,
      preset: 'data',
      paths: ['rows.csv'],
      signal: new AbortController().signal
    })
    expect(result.checks.some((c) => c.check === 'schema')).toBe(true)
    expect(result.ok).toBe(false)
  })

  it('flags duplicate headings and broken links for document preset', async () => {
    const root = makeRoot('doc-links')
    writeFileSync(
      join(root, 'notes.md'),
      '# Title\n## Dup\n## Dup\nSee [x](./gone.md)\n'
    )
    const result = await runAgentVerify({
      workspaceRoot: root,
      preset: 'document',
      paths: ['notes.md'],
      signal: new AbortController().signal
    })
    expect(result.ok).toBe(false)
    expect(result.content).toMatch(/Duplicate/)
    expect(result.content).toMatch(/Broken doc link/)
  })

  it('skips shell and light checks for general preset', async () => {
    const root = makeRoot('general')
    const result = await runAgentVerify({
      workspaceRoot: root,
      preset: 'general',
      signal: new AbortController().signal
    })
    expect(result.ok).toBe(true)
    expect(result.summary).toMatch(/skipped for this use case|no verify/)
  })
})
