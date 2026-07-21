import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS } from '../../src/types'

const electronState = {
  userData: '',
  encryptionAvailable: false
}

vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => (name === 'userData' ? electronState.userData : '')
  },
  safeStorage: {
    isEncryptionAvailable: () => electronState.encryptionAvailable,
    encryptString: (value: string) => Buffer.from(`enc:${value}`, 'utf-8'),
    decryptString: (buffer: Buffer) => {
      const text = buffer.toString('utf-8')
      return text.startsWith('enc:') ? text.slice(4) : text
    }
  }
}))

import {
  addRecentWorkspaceRoot,
  getLastWorkspaceRoot,
  getRecentWorkspaceRoots,
  getSettings,
  removeRecentWorkspaceRoot,
  setLastWorkspaceRoot,
  setSettings
} from './settings'

function makeUserData(name: string): string {
  const root = join(
    tmpdir(),
    `compass-settings-${name}-${Date.now()}-${Math.random().toString(36).slice(2)}`
  )
  mkdirSync(root, { recursive: true })
  return root
}

const tempRoots: string[] = []

beforeEach(() => {
  electronState.userData = makeUserData('ud')
  electronState.encryptionAvailable = false
  tempRoots.push(electronState.userData)
})

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe('getSettings / setSettings', () => {
  it('returns defaults when settings file is missing', async () => {
    await expect(getSettings()).resolves.toMatchObject({
      providerId: DEFAULT_SETTINGS.providerId,
      apiKey: '',
      model: DEFAULT_SETTINGS.model,
      colorTheme: DEFAULT_SETTINGS.colorTheme,
      locale: DEFAULT_SETTINGS.locale
    })
  })

  it('round-trips settings with base64 fallback encryption', async () => {
    await setSettings({
      ...DEFAULT_SETTINGS,
      providerId: 'openai',
      apiKey: 'sk-secret',
      model: 'gpt-4o-mini',
      temperature: 0.5,
      maxTokens: 8192,
      colorTheme: 'dark',
      locale: 'ja',
      inlineCompletionsEnabled: false,
      editorMinimapEnabled: false,
      markdownOutlineEnabled: false,
      autoOpenAgentPreview: false,
      defaultShellId: 'bash',
      defaultUseCasePreset: 'code',
      rememberLastUseCasePreset: false
    })

    const loaded = await getSettings()
    expect(loaded.apiKey).toBe('sk-secret')
    expect(loaded.providerKeys.openai).toBe('sk-secret')
    expect(loaded.colorTheme).toBe('dark')
    expect(loaded.locale).toBe('ja')
    expect(loaded.inlineCompletionsEnabled).toBe(false)
    expect(loaded.editorMinimapEnabled).toBe(false)
    expect(loaded.markdownOutlineEnabled).toBe(false)
    expect(loaded.defaultUseCasePreset).toBe('code')
    expect(loaded.temperature).toBe(0.5)
  })

  it('uses safeStorage encrypt/decrypt when available', async () => {
    electronState.encryptionAvailable = true
    await setSettings({
      ...DEFAULT_SETTINGS,
      apiKey: 'sk-safe',
      providerKeys: { openai: 'sk-safe' }
    })
    const raw = JSON.parse(
      readFileSync(join(electronState.userData, 'settings.json'), 'utf-8')
    ) as { encryptedApiKey: string }
    expect(Buffer.from(raw.encryptedApiKey, 'base64').toString('utf-8')).toContain('enc:sk-safe')
    await expect(getSettings()).resolves.toMatchObject({ apiKey: 'sk-safe' })
  })

  it('migrates legacy single encryptedApiKey into providerKeys', async () => {
    const encrypted = Buffer.from('legacy-key', 'utf-8').toString('base64')
    writeFileSync(
      join(electronState.userData, 'settings.json'),
      JSON.stringify({
        providerId: 'openai',
        apiBaseUrl: 'https://api.openai.com/v1',
        encryptedApiKey: encrypted,
        model: 'gpt-4o-mini',
        temperature: 0.2,
        maxTokens: 4096,
        colorTheme: 'light',
        locale: 'en'
      }),
      'utf-8'
    )

    const settings = await getSettings()
    expect(settings.apiKey).toBe('legacy-key')
    expect(settings.providerKeys.openai).toBe('legacy-key')
  })

  it('falls back invalid theme / locale / preset values', async () => {
    writeFileSync(
      join(electronState.userData, 'settings.json'),
      JSON.stringify({
        apiBaseUrl: 'https://api.openai.com/v1',
        encryptedApiKey: null,
        model: 'gpt-4o-mini',
        temperature: 0.2,
        maxTokens: 4096,
        colorTheme: 'neon',
        locale: 'fr',
        defaultUseCasePreset: 'wizard'
      }),
      'utf-8'
    )

    const settings = await getSettings()
    expect(settings.colorTheme).toBe(DEFAULT_SETTINGS.colorTheme)
    expect(settings.locale).toBe(DEFAULT_SETTINGS.locale)
    expect(settings.defaultUseCasePreset).toBe(DEFAULT_SETTINGS.defaultUseCasePreset)
  })

  it('clears empty active api keys from providerKeys', async () => {
    await setSettings({
      ...DEFAULT_SETTINGS,
      apiKey: 'keep-me',
      providerKeys: { openai: 'keep-me' }
    })
    await setSettings({
      ...DEFAULT_SETTINGS,
      apiKey: '',
      providerKeys: { openai: 'keep-me' }
    })
    const settings = await getSettings()
    expect(settings.apiKey).toBe('')
    expect(settings.providerKeys.openai).toBeUndefined()
  })
})

describe('recent / last workspace roots', () => {
  it('tracks last workspace and recent list with max 5 and dedupe', async () => {
    await addRecentWorkspaceRoot('C:/w1')
    await addRecentWorkspaceRoot('C:/w2')
    await addRecentWorkspaceRoot('C:/w3')
    await addRecentWorkspaceRoot('C:/w4')
    await addRecentWorkspaceRoot('C:/w5')
    await addRecentWorkspaceRoot('C:/w6')
    await addRecentWorkspaceRoot('C:/w2')

    expect(await getLastWorkspaceRoot()).toBe('C:/w2')
    expect(await getRecentWorkspaceRoots()).toEqual([
      'C:/w2',
      'C:/w6',
      'C:/w5',
      'C:/w4',
      'C:/w3'
    ])
  })

  it('removes a recent root and clears last when it matches', async () => {
    await addRecentWorkspaceRoot('C:/a')
    await addRecentWorkspaceRoot('C:/b')
    await removeRecentWorkspaceRoot('C:/b')
    expect(await getRecentWorkspaceRoots()).toEqual(['C:/a'])
    expect(await getLastWorkspaceRoot()).toBeNull()

    await setLastWorkspaceRoot('C:/a')
    expect(await getLastWorkspaceRoot()).toBe('C:/a')
    await setLastWorkspaceRoot(null)
    expect(await getLastWorkspaceRoot()).toBeNull()
  })
})
