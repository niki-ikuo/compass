import { mkdirSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { afterEach, describe, expect, it } from 'vitest'
import { normalizeVerifyChecks, resolveVerifyCommands, runAgentVerify } from './agent-verify'

const roots: string[] = []

function makeRoot(name: string): string {
  const root = join(tmpdir(), `compass-verify-${name}-${Date.now()}-${Math.random().toString(36).slice(2)}`)
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

describe('normalizeVerifyChecks', () => {
  it('defaults to all checks', () => {
    expect(normalizeVerifyChecks(undefined)).toEqual(['test', 'lint', 'typecheck'])
    expect(normalizeVerifyChecks([])).toEqual(['test', 'lint', 'typecheck'])
  })

  it('filters and dedupes valid checks', () => {
    expect(normalizeVerifyChecks(['lint', 'bogus', 'lint', 'test'])).toEqual(['lint', 'test'])
  })
})

describe('resolveVerifyCommands', () => {
  it('uses package.json scripts with npm by default', async () => {
    const root = makeRoot('scripts')
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({
        scripts: {
          test: 'vitest run',
          lint: 'eslint .',
          typecheck: 'tsc --noEmit'
        }
      })
    )

    const resolved = await resolveVerifyCommands(root)
    expect(resolved).toEqual([
      { check: 'test', command: 'npm run test', source: 'script', scriptName: 'test' },
      { check: 'lint', command: 'npm run lint', source: 'script', scriptName: 'lint' },
      {
        check: 'typecheck',
        command: 'npm run typecheck',
        source: 'script',
        scriptName: 'typecheck'
      }
    ])
  })

  it('prefers pnpm when lockfile exists', async () => {
    const root = makeRoot('pnpm')
    writeFileSync(join(root, 'pnpm-lock.yaml'), '')
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({ scripts: { test: 'vitest run' } })
    )

    const resolved = await resolveVerifyCommands(root, ['test'])
    expect(resolved[0]).toMatchObject({
      check: 'test',
      command: 'pnpm run test',
      source: 'script',
      scriptName: 'test'
    })
  })

  it('falls back to tsc when tsconfig exists without typecheck script', async () => {
    const root = makeRoot('tsc-fallback')
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'x' }))
    writeFileSync(join(root, 'tsconfig.json'), '{}')

    const resolved = await resolveVerifyCommands(root, ['typecheck'])
    expect(resolved[0]?.source).toBe('fallback')
    expect(resolved[0]?.command).toContain('tsc --noEmit')
  })

  it('marks missing when nothing matches', async () => {
    const root = makeRoot('empty')
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'x' }))

    const resolved = await resolveVerifyCommands(root, ['lint'])
    expect(resolved[0]).toMatchObject({
      check: 'lint',
      command: null,
      source: 'missing'
    })
  })

  it('uses cargo fallbacks for Rust projects', async () => {
    const root = makeRoot('cargo')
    writeFileSync(join(root, 'Cargo.toml'), '[package]\nname = "x"\n')

    const resolved = await resolveVerifyCommands(root, ['test', 'typecheck'])
    expect(resolved[0]).toMatchObject({ check: 'test', command: 'cargo test', source: 'fallback' })
    expect(resolved[1]).toMatchObject({
      check: 'typecheck',
      command: 'cargo check',
      source: 'fallback'
    })
  })
})

describe('runAgentVerify', () => {
  it('treats all-missing checks as skipped success, not failure', async () => {
    const root = makeRoot('verify-empty')
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'x' }))

    const result = await runAgentVerify({
      workspaceRoot: root,
      checks: ['test', 'lint', 'typecheck'],
      preset: 'code',
      signal: new AbortController().signal
    })

    expect(result.ok).toBe(true)
    expect(result.summary).toContain('no verify commands available')
    expect(result.checks.every((check) => check.skipped && check.ok)).toBe(true)
  })
})
