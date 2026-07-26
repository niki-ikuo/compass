import { mkdtemp, mkdir, readFile, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS } from '../../src/types'

vi.mock('electron', () => ({
  app: { getPath: () => tmpdir() },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (value: string) => Buffer.from(value, 'utf-8'),
    decryptString: (buffer: Buffer) => buffer.toString('utf-8')
  }
}))

vi.mock('./settings', () => ({
  getSettings: async () => ({ ...DEFAULT_SETTINGS, embeddingsMode: 'hash' as const })
}))

import { formatMeaningExcerptsForAi, searchSemanticWorkspace, writeSemanticIndex } from './semantic-index'

async function makeWorkspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'compass-semantic-'))
  await mkdir(join(root, 'notes'), { recursive: true })
  await mkdir(join(root, 'docs'), { recursive: true })
  await writeFile(
    join(root, 'notes', 'travel.md'),
    ['# Travel', '', '## Kyoto', '', 'Visit Fushimi Inari and try matcha sweets.'].join('\n'),
    'utf-8'
  )
  await writeFile(
    join(root, 'docs', 'api.md'),
    ['# API', '', '## Auth', '', 'Use bearer tokens for authentication endpoints.'].join('\n'),
    'utf-8'
  )
  return root
}

describe('semantic-index', () => {
  it('hybrid search finds the relevant markdown section', async () => {
    const root = await makeWorkspace()
    const travel = await readFile(join(root, 'notes', 'travel.md'), 'utf-8')
    const api = await readFile(join(root, 'docs', 'api.md'), 'utf-8')
    await writeSemanticIndex(root, [
      { path: 'notes/travel.md', language: 'markdown', content: travel },
      { path: 'docs/api.md', language: 'markdown', content: api }
    ])

    const result = await searchSemanticWorkspace(root, {
      query: 'matcha sweets in Kyoto',
      mode: 'hybrid',
      maxResults: 5
    })

    expect(result.totalMatches).toBeGreaterThan(0)
    expect(result.files.some((f) => f.relativePath.includes('travel'))).toBe(true)
    const top = result.files.flatMap((f) => f.matches)[0]
    expect(top?.heading === 'Kyoto' || top?.preview.toLowerCase().includes('matcha')).toBe(true)
  })

  it('formats AI excerpts with path and heading', async () => {
    const root = await makeWorkspace()
    const travel = await readFile(join(root, 'notes', 'travel.md'), 'utf-8')
    const api = await readFile(join(root, 'docs', 'api.md'), 'utf-8')
    await writeSemanticIndex(root, [
      { path: 'notes/travel.md', language: 'markdown', content: travel },
      { path: 'docs/api.md', language: 'markdown', content: api }
    ])

    const text = await formatMeaningExcerptsForAi(root, 'authentication bearer tokens', 4)
    expect(text).toBeTruthy()
    expect(text).toContain('[Related workspace excerpts]')
    expect(text).toMatch(/docs\/api\.md/)
  })
})
