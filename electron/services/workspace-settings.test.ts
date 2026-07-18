import { mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { afterEach, describe, expect, it } from 'vitest'
import {
  clearWorkspaceDefaultUseCasePreset,
  createEmptyWorkspaceSettings,
  getWorkspaceSettings,
  resolveWorkspaceDefaultUseCasePreset,
  setWorkspaceSettings
} from './workspace-settings'

function makeTempRoot(name: string): string {
  const root = join(
    tmpdir(),
    `compass-ws-settings-${name}-${Date.now()}-${Math.random().toString(36).slice(2)}`
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

describe('workspace-settings helpers', () => {
  it('starts empty and resolves undefined until a preset is set', () => {
    expect(createEmptyWorkspaceSettings()).toEqual({})
    expect(resolveWorkspaceDefaultUseCasePreset({})).toBeUndefined()
    expect(
      resolveWorkspaceDefaultUseCasePreset({ defaultUseCasePreset: 'document' })
    ).toBe('document')
    expect(
      resolveWorkspaceDefaultUseCasePreset({ defaultUseCasePreset: 'nope' as never })
    ).toBeUndefined()
  })
})

describe('workspace-settings I/O', () => {
  it('returns empty settings when file is missing', async () => {
    const root = makeTempRoot('missing')
    tempRoots.push(root)
    await expect(getWorkspaceSettings(root)).resolves.toEqual({})
  })

  it('round-trips defaultUseCasePreset and clears it', async () => {
    const root = makeTempRoot('roundtrip')
    tempRoots.push(root)

    await expect(
      setWorkspaceSettings(root, { defaultUseCasePreset: 'data' })
    ).resolves.toEqual({ defaultUseCasePreset: 'data' })
    await expect(getWorkspaceSettings(root)).resolves.toEqual({
      defaultUseCasePreset: 'data'
    })

    await expect(clearWorkspaceDefaultUseCasePreset(root)).resolves.toEqual({})
    await expect(getWorkspaceSettings(root)).resolves.toEqual({})
  })

  it('drops invalid presets on write', async () => {
    const root = makeTempRoot('invalid')
    tempRoots.push(root)
    await expect(
      setWorkspaceSettings(root, { defaultUseCasePreset: 'wizard' as never })
    ).resolves.toEqual({})
  })
})
