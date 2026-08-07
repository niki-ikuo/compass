import { mkdirSync, rmSync, symlinkSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { afterEach, describe, expect, it } from 'vitest'
import {
  assertInsideWorkspace,
  assertSafeApiBaseUrl,
  registerExternalContextPaths,
  resetPathGuardForTests,
  setActiveWorkspaceRoot
} from './path-guard'
import { isSensitivePath } from '../../src/utils/sensitive-path'

const tempRoots: string[] = []

afterEach(() => {
  resetPathGuardForTests()
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

function makeTempRoot(name: string): string {
  const root = join(
    tmpdir(),
    `compass-pg-${name}-${Date.now()}-${Math.random().toString(36).slice(2)}`
  )
  mkdirSync(root, { recursive: true })
  tempRoots.push(root)
  return root
}

describe('assertInsideWorkspace', () => {
  it('allows paths inside the workspace', () => {
    const root = makeTempRoot('ok')
    writeFileSync(join(root, 'a.txt'), 'x', 'utf-8')
    expect(assertInsideWorkspace(root, 'a.txt')).toBe(join(root, 'a.txt'))
  })

  it('rejects lexical escapes', () => {
    const root = makeTempRoot('escape')
    expect(() => assertInsideWorkspace(root, '../outside.txt')).toThrow(/outside/i)
  })

  it('rejects symlink escapes when the platform supports them', () => {
    const root = makeTempRoot('link-root')
    const outside = makeTempRoot('link-outside')
    writeFileSync(join(outside, 'secret.txt'), 'secret', 'utf-8')
    const linkPath = join(root, 'leak')
    try {
      symlinkSync(outside, linkPath, 'junction')
    } catch {
      // Some CI environments disallow symlinks — skip
      return
    }
    expect(() => assertInsideWorkspace(root, join('leak', 'secret.txt'))).toThrow(/outside/i)
  })
})

describe('assertSafeApiBaseUrl', () => {
  it('allows https and localhost', () => {
    expect(assertSafeApiBaseUrl('https://api.openai.com/v1')).toBe('https://api.openai.com/v1')
    expect(assertSafeApiBaseUrl('http://127.0.0.1:11434/v1')).toBe('http://127.0.0.1:11434/v1')
  })

  it('blocks metadata always and private hosts by default', () => {
    expect(() => assertSafeApiBaseUrl('http://169.254.169.254/latest')).toThrow()
    expect(() => assertSafeApiBaseUrl('http://0.0.0.0/v1')).toThrow()
    expect(() => assertSafeApiBaseUrl('http://192.168.1.1/v1')).toThrow()
    expect(() => assertSafeApiBaseUrl('http://10.0.0.5/v1')).toThrow()
  })

  it('allows private LAN when allowPrivateLan is set', () => {
    expect(
      assertSafeApiBaseUrl('http://192.168.1.10:11434/v1', { allowPrivateLan: true })
    ).toBe('http://192.168.1.10:11434/v1')
    expect(() =>
      assertSafeApiBaseUrl('http://169.254.169.254/latest', { allowPrivateLan: true })
    ).toThrow()
  })
})

describe('external context allowlist', () => {
  it('registers paths for later chat context', () => {
    const external = makeTempRoot('ext')
    const file = join(external, 'a.md')
    writeFileSync(file, 'hi', 'utf-8')
    registerExternalContextPaths([file])
    setActiveWorkspaceRoot(makeTempRoot('ws'))
    // allowlist membership is covered via filesystem.resolveChatContext tests
  })
})

describe('isSensitivePath', () => {
  it('detects common secret filenames', () => {
    expect(isSensitivePath('.env')).toBe(true)
    expect(isSensitivePath('config/.env.local')).toBe(true)
    expect(isSensitivePath('certs/server.pem')).toBe(true)
    expect(isSensitivePath('readme.md')).toBe(false)
  })
})
