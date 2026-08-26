import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { globWorkspaceFiles, searchWorkspace } from './workspace-search'

const roots: string[] = []

function makeRoot(name: string): string {
  const root = join(
    tmpdir(),
    `compass-search-${name}-${Date.now()}-${Math.random().toString(36).slice(2)}`
  )
  mkdirSync(root, { recursive: true })
  roots.push(root)
  return root
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe('globWorkspaceFiles', () => {
  it('lists **/*.test.ts and honors ignore dirs', async () => {
    const root = makeRoot('glob')
    mkdirSync(join(root, 'src'), { recursive: true })
    mkdirSync(join(root, 'node_modules', 'pkg'), { recursive: true })
    writeFileSync(join(root, 'src', 'a.test.ts'), 'export {}\n')
    writeFileSync(join(root, 'src', 'b.ts'), 'export const b = 1\n')
    writeFileSync(join(root, 'node_modules', 'pkg', 'c.test.ts'), 'export {}\n')

    const result = await globWorkspaceFiles(root, '**/*.test.ts')
    expect(result.files).toContain('src/a.test.ts')
    expect(result.files).not.toContain('src/b.ts')
    expect(result.files.some((f) => f.includes('node_modules'))).toBe(false)
  })
})

describe('searchWorkspace regex', () => {
  it('finds export function foo with useRegex', async () => {
    const root = makeRoot('regex')
    mkdirSync(join(root, 'src'), { recursive: true })
    writeFileSync(join(root, 'src', 'lib.ts'), 'export function foo() {\n  return 1\n}\n')

    const result = await searchWorkspace(root, {
      query: 'export function foo',
      mode: 'keyword',
      useRegex: true,
      contextLines: 1,
      maxResults: 80
    })
    expect(result.files.some((f) => f.relativePath.replace(/\\/g, '/').endsWith('src/lib.ts'))).toBe(
      true
    )
    const hit = result.files.flatMap((f) => f.matches)[0]
    expect(hit?.line).toBe(1)
    expect(hit?.preview).toMatch(/L1>\|export function foo/)
  })
})
