import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { afterEach, describe, expect, it } from 'vitest'
import {
  createEmptyExplorerState,
  loadExplorerState,
  saveExplorerState
} from './explorer-state'

function makeTempRoot(name: string): string {
  const root = join(
    tmpdir(),
    `compass-explorer-state-${name}-${Date.now()}-${Math.random().toString(36).slice(2)}`
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

describe('explorer-state', () => {
  it('returns null when file is missing', async () => {
    const root = makeTempRoot('missing')
    tempRoots.push(root)
    await expect(loadExplorerState(root)).resolves.toBeNull()
  })

  it('round-trips expanded dirs and selection', async () => {
    const root = makeTempRoot('roundtrip')
    tempRoots.push(root)
    const src = `${root.replace(/\\/g, '/')}/src`
    const file = `${src}/App.tsx`

    await saveExplorerState(root, {
      version: 1,
      expandedDirs: [src],
      selectedPaths: [file],
      lastSelectedPath: file
    })

    await expect(loadExplorerState(root)).resolves.toEqual({
      version: 1,
      expandedDirs: [src],
      selectedPaths: [file],
      lastSelectedPath: file
    })
  })

  it('persists empty expanded dirs (collapse all)', async () => {
    const root = makeTempRoot('empty')
    tempRoots.push(root)

    await saveExplorerState(root, createEmptyExplorerState())
    await expect(loadExplorerState(root)).resolves.toEqual(createEmptyExplorerState())
  })

  it('defaults missing selection fields from older files', async () => {
    const root = makeTempRoot('legacy')
    tempRoots.push(root)
    mkdirSync(join(root, '.compass'), { recursive: true })
    writeFileSync(
      join(root, '.compass', 'explorer-state.json'),
      JSON.stringify({ version: 1, expandedDirs: [`${root}/a`] }),
      'utf-8'
    )

    await expect(loadExplorerState(root)).resolves.toEqual({
      version: 1,
      expandedDirs: [`${root.replace(/\\/g, '/')}/a`],
      selectedPaths: [],
      lastSelectedPath: null
    })
  })

  it('returns null for corrupt json', async () => {
    const root = makeTempRoot('corrupt')
    tempRoots.push(root)
    mkdirSync(join(root, '.compass'), { recursive: true })
    writeFileSync(join(root, '.compass', 'explorer-state.json'), '{not-json', 'utf-8')
    await expect(loadExplorerState(root)).resolves.toBeNull()
  })

  it('writes under .compass/explorer-state.json', async () => {
    const root = makeTempRoot('path')
    tempRoots.push(root)
    await saveExplorerState(root, {
      version: 1,
      expandedDirs: [`${root}/a`],
      selectedPaths: [`${root}/a/b.ts`],
      lastSelectedPath: `${root}/a/b.ts`
    })
    const raw = JSON.parse(readFileSync(join(root, '.compass', 'explorer-state.json'), 'utf-8'))
    expect(raw.version).toBe(1)
    expect(raw.expandedDirs).toEqual([`${root.replace(/\\/g, '/')}/a`])
    expect(raw.selectedPaths).toEqual([`${root.replace(/\\/g, '/')}/a/b.ts`])
    expect(raw.lastSelectedPath).toEqual(`${root.replace(/\\/g, '/')}/a/b.ts`)
  })
})
