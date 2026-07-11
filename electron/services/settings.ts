import { safeStorage } from 'electron'
import { readFile, writeFile, mkdir } from 'fs/promises'
import { join } from 'path'
import { app } from 'electron'
import type { AppSettings, ColorThemeId } from '../../src/types'
import { DEFAULT_SETTINGS } from '../../src/types'
import { isColorThemeId } from '../../src/utils/color-theme'

interface StoredSettings {
  apiBaseUrl: string
  encryptedApiKey: string | null
  model: string
  temperature: number
  maxTokens: number
  colorTheme: ColorThemeId
  lastWorkspaceRoot: string | null
  recentWorkspaceRoots: string[]
}

function resolveColorTheme(value: unknown): ColorThemeId {
  return isColorThemeId(value) ? value : DEFAULT_SETTINGS.colorTheme
}

const MAX_RECENT_WORKSPACES = 5

function getSettingsPath(): string {
  return join(app.getPath('userData'), 'settings.json')
}

function encryptApiKey(apiKey: string): string | null {
  if (!apiKey) return null
  if (!safeStorage.isEncryptionAvailable()) {
    return Buffer.from(apiKey).toString('base64')
  }
  return safeStorage.encryptString(apiKey).toString('base64')
}

function decryptApiKey(encrypted: string | null): string {
  if (!encrypted) return ''
  try {
    const buffer = Buffer.from(encrypted, 'base64')
    if (!safeStorage.isEncryptionAvailable()) {
      return buffer.toString('utf-8')
    }
    return safeStorage.decryptString(buffer)
  } catch {
    return ''
  }
}

async function readStoredSettings(): Promise<StoredSettings> {
  try {
    const raw = await readFile(getSettingsPath(), 'utf-8')
    const stored = JSON.parse(raw) as Partial<StoredSettings>
    return {
      apiBaseUrl: stored.apiBaseUrl ?? DEFAULT_SETTINGS.apiBaseUrl,
      encryptedApiKey: stored.encryptedApiKey ?? null,
      model: stored.model ?? DEFAULT_SETTINGS.model,
      temperature: stored.temperature ?? DEFAULT_SETTINGS.temperature,
      maxTokens: stored.maxTokens ?? DEFAULT_SETTINGS.maxTokens,
      colorTheme: resolveColorTheme(stored.colorTheme),
      lastWorkspaceRoot: stored.lastWorkspaceRoot ?? null,
      recentWorkspaceRoots:
        stored.recentWorkspaceRoots ??
        (stored.lastWorkspaceRoot ? [stored.lastWorkspaceRoot] : [])
    }
  } catch {
    return {
      apiBaseUrl: DEFAULT_SETTINGS.apiBaseUrl,
      encryptedApiKey: null,
      model: DEFAULT_SETTINGS.model,
      temperature: DEFAULT_SETTINGS.temperature,
      maxTokens: DEFAULT_SETTINGS.maxTokens,
      colorTheme: DEFAULT_SETTINGS.colorTheme,
      lastWorkspaceRoot: null,
      recentWorkspaceRoots: []
    }
  }
}

async function writeStoredSettings(stored: StoredSettings): Promise<void> {
  const userDataPath = app.getPath('userData')
  await mkdir(userDataPath, { recursive: true })
  await writeFile(getSettingsPath(), JSON.stringify(stored, null, 2), 'utf-8')
}

export async function getSettings(): Promise<AppSettings> {
  const stored = await readStoredSettings()
  return {
    apiBaseUrl: stored.apiBaseUrl,
    apiKey: decryptApiKey(stored.encryptedApiKey),
    model: stored.model,
    temperature: stored.temperature,
    maxTokens: stored.maxTokens,
    colorTheme: stored.colorTheme
  }
}

export async function setSettings(settings: AppSettings): Promise<void> {
  const stored = await readStoredSettings()
  await writeStoredSettings({
    ...stored,
    apiBaseUrl: settings.apiBaseUrl,
    encryptedApiKey: encryptApiKey(settings.apiKey),
    model: settings.model,
    temperature: settings.temperature,
    maxTokens: settings.maxTokens,
    colorTheme: resolveColorTheme(settings.colorTheme)
  })
}

export async function getLastWorkspaceRoot(): Promise<string | null> {
  const stored = await readStoredSettings()
  return stored.lastWorkspaceRoot
}

export async function getRecentWorkspaceRoots(): Promise<string[]> {
  const stored = await readStoredSettings()
  return stored.recentWorkspaceRoots.slice(0, MAX_RECENT_WORKSPACES)
}

export async function addRecentWorkspaceRoot(workspaceRoot: string): Promise<void> {
  const stored = await readStoredSettings()
  const filtered = stored.recentWorkspaceRoots.filter((path) => path !== workspaceRoot)
  const recentWorkspaceRoots = [workspaceRoot, ...filtered].slice(0, MAX_RECENT_WORKSPACES)
  await writeStoredSettings({
    ...stored,
    lastWorkspaceRoot: workspaceRoot,
    recentWorkspaceRoots
  })
}

export async function removeRecentWorkspaceRoot(workspaceRoot: string): Promise<void> {
  const stored = await readStoredSettings()
  const recentWorkspaceRoots = stored.recentWorkspaceRoots.filter((path) => path !== workspaceRoot)
  const lastWorkspaceRoot =
    stored.lastWorkspaceRoot === workspaceRoot ? null : stored.lastWorkspaceRoot
  await writeStoredSettings({
    ...stored,
    lastWorkspaceRoot,
    recentWorkspaceRoots
  })
}

export async function setLastWorkspaceRoot(workspaceRoot: string | null): Promise<void> {
  const stored = await readStoredSettings()
  await writeStoredSettings({
    ...stored,
    lastWorkspaceRoot: workspaceRoot
  })
}
