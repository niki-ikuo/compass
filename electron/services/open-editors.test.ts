import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { afterEach, describe, expect, it } from 'vitest'
import {
  createEmptyOpenEditors,
  loadOpenEditors,
  saveOpenEditors
} from './open-editors'

function makeTempRoot(name: string): string {
  const root = join(
    tmpdir(),
    `compass-open-editors-${name}-${Date.now()}-${Math.random().toString(36).slice(2)}`
  )
  mkdirSync(root, { recursive: true })
  return root
}

const tempRoots: string[] = []

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe('open-editors', () => {
  it('returns empty history when file is missing', async () => {
    const root = makeTempRoot('missing')
    tempRoots.push(root)
    await expect(loadOpenEditors(root)).resolves.toEqual(createEmptyOpenEditors())
  })

  it('round-trips tabs and active path', async () => {
    const root = makeTempRoot('roundtrip')
    tempRoots.push(root)

    await saveOpenEditors(root, {
      version: 1,
      activeFilePath: join(root, 'b.ts'),
      openTabs: [
        { path: join(root, 'a.ts'), viewKind: 'text' },
        { path: join(root, 'b.ts'), viewKind: 'text' },
        {
          path: 'compass-browser://tab-1',
          viewKind: 'browser',
          browserUrl: 'https://example.com'
        }
      ]
    })

    const loaded = await loadOpenEditors(root)
    expect(loaded.openTabs).toHaveLength(3)
    expect(loaded.activeFilePath).toBe(join(root, 'b.ts'))
    expect(loaded.openTabs[2]).toEqual({
      path: 'compass-browser://tab-1',
      viewKind: 'browser',
      browserUrl: 'https://example.com'
    })
  })

  it('drops invalid tabs and falls back active path', async () => {
    const root = makeTempRoot('invalid')
    tempRoots.push(root)
    mkdirSync(join(root, '.compass'), { recursive: true })
    writeFileSync(
      join(root, '.compass', 'open-editors.json'),
      JSON.stringify({
        version: 1,
        activeFilePath: '/gone.ts',
        openTabs: [
          { path: '', viewKind: 'text' },
          { path: '/ok.ts' },
          { viewKind: 'text' },
          { path: 'compass-browser://x', viewKind: 'browser' }
        ]
      }),
      'utf-8'
    )

    const loaded = await loadOpenEditors(root)
    expect(loaded.openTabs).toEqual([
      { path: '/ok.ts', viewKind: 'text' },
      { path: 'compass-browser://x', viewKind: 'browser', browserUrl: 'about:blank' }
    ])
    expect(loaded.activeFilePath).toBe('compass-browser://x')
  })

  it('writes normalized payload', async () => {
    const root = makeTempRoot('write')
    tempRoots.push(root)

    await saveOpenEditors(root, {
      version: 1,
      activeFilePath: '/missing.ts',
      openTabs: [{ path: '/only.ts', viewKind: 'text' }]
    })

    const raw = JSON.parse(readFileSync(join(root, '.compass', 'open-editors.json'), 'utf-8'))
    expect(raw).toEqual({
      version: 1,
      activeFilePath: '/only.ts',
      openTabs: [{ path: '/only.ts', viewKind: 'text' }]
    })
  })
})
