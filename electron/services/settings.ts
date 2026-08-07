import { safeStorage } from 'electron'
import { readFile, writeFile, mkdir } from 'fs/promises'
import { join } from 'path'
import { app } from 'electron'
import type {
  AppSettings,
  ColorThemeId,
  DeskCaptureOpenTarget,
  EmbeddingsMode,
  LlmProviderId,
  UseCasePreset
} from '../../src/types'
import { DEFAULT_SETTINGS, normalizeUseCasePreset } from '../../src/types'
import { isColorThemeId } from '../../src/utils/color-theme'
import {
  getLlmProvider,
  inferLlmProviderId,
  isLlmProviderId,
  resolveModelForProvider
} from '../../src/utils/llm-providers'
import { normalizeUsageResetDay } from '../../src/utils/usage-period'
import { isLocaleId, setLocale, type LocaleId } from '../../src/i18n/runtime'
import { assertSafeApiBaseUrl } from './path-guard'

interface StoredSettings {
  providerId?: LlmProviderId
  apiBaseUrl: string
  encryptedApiKey: string | null
  encryptedProviderKeys?: Partial<Record<LlmProviderId, string>>
  model: string
  temperature: number
  maxTokens: number
  colorTheme: ColorThemeId
  locale: LocaleId
  inlineCompletionsEnabled: boolean
  editorMinimapEnabled: boolean
  markdownOutlineEnabled: boolean
  autoOpenAgentPreview: boolean
  autoApplyAgentWrites: boolean
  defaultShellId: string
  defaultUseCasePreset: UseCasePreset
  rememberLastUseCasePreset: boolean
  embeddingsMode: EmbeddingsMode
  /** Empty = same as chat provider. */
  embeddingsProviderId: '' | LlmProviderId
  embeddingsModel: string
  /**
   * Bumped when embeddings defaults change.
   * v0 / missing → migrate to neural `api` default (old default was `hash`).
   */
  embeddingsSettingsVersion: number
  usageResetDay: number
  deskCaptureEnabled: boolean
  deskCaptureAccelerator: string
  deskCaptureOpenTarget: DeskCaptureOpenTarget
  deskTrayEnabled: boolean
  deskShowEnabled: boolean
  deskShowAccelerator: string
  allowLanApiBaseUrl?: boolean
  lastWorkspaceRoot: string | null
  recentWorkspaceRoots: string[]
}

/** Current embeddings settings schema version (neural API default). */
export const EMBEDDINGS_SETTINGS_VERSION = 1

function resolveColorTheme(value: unknown): ColorThemeId {
  return isColorThemeId(value) ? value : DEFAULT_SETTINGS.colorTheme
}

function resolveLocale(value: unknown): LocaleId {
  return isLocaleId(value) ? value : DEFAULT_SETTINGS.locale
}

function resolveInlineCompletionsEnabled(value: unknown): boolean {
  return typeof value === 'boolean' ? value : DEFAULT_SETTINGS.inlineCompletionsEnabled
}

function resolveEditorMinimapEnabled(value: unknown): boolean {
  return typeof value === 'boolean' ? value : DEFAULT_SETTINGS.editorMinimapEnabled
}

function resolveMarkdownOutlineEnabled(value: unknown): boolean {
  return typeof value === 'boolean' ? value : DEFAULT_SETTINGS.markdownOutlineEnabled
}

function resolveAutoOpenAgentPreview(value: unknown): boolean {
  return typeof value === 'boolean' ? value : DEFAULT_SETTINGS.autoOpenAgentPreview
}

function resolveAutoApplyAgentWrites(value: unknown): boolean {
  return typeof value === 'boolean' ? value : DEFAULT_SETTINGS.autoApplyAgentWrites
}

function resolveDefaultShellId(value: unknown): string {
  return typeof value === 'string' && value.trim() ? value.trim() : DEFAULT_SETTINGS.defaultShellId
}

function resolveUseCasePreset(value: unknown): UseCasePreset {
  return normalizeUseCasePreset(value) ?? DEFAULT_SETTINGS.defaultUseCasePreset
}

function resolveRememberLastUseCasePreset(value: unknown): boolean {
  return typeof value === 'boolean' ? value : DEFAULT_SETTINGS.rememberLastUseCasePreset
}

function resolveAllowLanApiBaseUrl(value: unknown): boolean {
  return typeof value === 'boolean' ? value : DEFAULT_SETTINGS.allowLanApiBaseUrl
}

function resolveEmbeddingsMode(value: unknown): EmbeddingsMode {
  if (value === 'hash' || value === 'api') return value
  return DEFAULT_SETTINGS.embeddingsMode
}

function resolveEmbeddingsProviderId(value: unknown): '' | LlmProviderId {
  if (value === '' || value == null) return ''
  return isLlmProviderId(value) ? value : ''
}

function resolveEmbeddingsModel(value: unknown): string {
  return typeof value === 'string' ? value.trim() : DEFAULT_SETTINGS.embeddingsModel
}

function resolveUsageResetDay(value: unknown): number {
  return normalizeUsageResetDay(value ?? DEFAULT_SETTINGS.usageResetDay)
}

function resolveDeskCaptureEnabled(value: unknown): boolean {
  return typeof value === 'boolean' ? value : DEFAULT_SETTINGS.deskCaptureEnabled
}

/** Previous shipped default; migrate to the easier Ctrl+Alt+I. */
const LEGACY_DESK_CAPTURE_ACCELERATOR = 'CommandOrControl+Shift+Alt+V'

function resolveDeskCaptureAccelerator(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) {
    return DEFAULT_SETTINGS.deskCaptureAccelerator
  }
  const trimmed = value.trim()
  if (trimmed === LEGACY_DESK_CAPTURE_ACCELERATOR) {
    return DEFAULT_SETTINGS.deskCaptureAccelerator
  }
  return trimmed
}

function resolveDeskCaptureOpenTarget(value: unknown): DeskCaptureOpenTarget {
  return value === 'desk' || value === 'file' ? value : DEFAULT_SETTINGS.deskCaptureOpenTarget
}

function resolveDeskTrayEnabled(value: unknown): boolean {
  return typeof value === 'boolean' ? value : DEFAULT_SETTINGS.deskTrayEnabled
}

function resolveDeskShowEnabled(value: unknown): boolean {
  return typeof value === 'boolean' ? value : DEFAULT_SETTINGS.deskShowEnabled
}

function resolveDeskShowAccelerator(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) {
    return DEFAULT_SETTINGS.deskShowAccelerator
  }
  return value.trim()
}

function resolveProviderId(value: unknown, apiBaseUrl: string): LlmProviderId {
  if (isLlmProviderId(value)) return value
  return inferLlmProviderId(apiBaseUrl)
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

function decryptProviderKeys(
  encrypted: Partial<Record<LlmProviderId, string>> | undefined
): Partial<Record<LlmProviderId, string>> {
  if (!encrypted) return {}
  const result: Partial<Record<LlmProviderId, string>> = {}
  for (const [id, value] of Object.entries(encrypted)) {
    if (!isLlmProviderId(id) || !value) continue
    const decrypted = decryptApiKey(value)
    if (decrypted) result[id] = decrypted
  }
  return result
}

function encryptProviderKeys(
  keys: Partial<Record<LlmProviderId, string>> | undefined
): Partial<Record<LlmProviderId, string>> {
  if (!keys) return {}
  const result: Partial<Record<LlmProviderId, string>> = {}
  for (const [id, value] of Object.entries(keys)) {
    if (!isLlmProviderId(id) || !value) continue
    const encrypted = encryptApiKey(value)
    if (encrypted) result[id] = encrypted
  }
  return result
}

async function readStoredSettings(): Promise<StoredSettings> {
  try {
    const raw = await readFile(getSettingsPath(), 'utf-8')
    const stored = JSON.parse(raw) as Partial<StoredSettings>
    return {
      providerId: isLlmProviderId(stored.providerId) ? stored.providerId : undefined,
      apiBaseUrl: stored.apiBaseUrl ?? DEFAULT_SETTINGS.apiBaseUrl,
      encryptedApiKey: stored.encryptedApiKey ?? null,
      encryptedProviderKeys: stored.encryptedProviderKeys ?? {},
      model: stored.model ?? DEFAULT_SETTINGS.model,
      temperature: stored.temperature ?? DEFAULT_SETTINGS.temperature,
      maxTokens: stored.maxTokens ?? DEFAULT_SETTINGS.maxTokens,
      colorTheme: resolveColorTheme(stored.colorTheme),
      locale: resolveLocale(stored.locale),
      inlineCompletionsEnabled: resolveInlineCompletionsEnabled(stored.inlineCompletionsEnabled),
      editorMinimapEnabled: resolveEditorMinimapEnabled(stored.editorMinimapEnabled),
      markdownOutlineEnabled: resolveMarkdownOutlineEnabled(stored.markdownOutlineEnabled),
      autoOpenAgentPreview: resolveAutoOpenAgentPreview(stored.autoOpenAgentPreview),
      autoApplyAgentWrites: resolveAutoApplyAgentWrites(stored.autoApplyAgentWrites),
      defaultShellId: resolveDefaultShellId(stored.defaultShellId),
      defaultUseCasePreset: resolveUseCasePreset(stored.defaultUseCasePreset),
      rememberLastUseCasePreset: resolveRememberLastUseCasePreset(
        stored.rememberLastUseCasePreset
      ),
      ...resolveEmbeddingsStoredFields(stored),
      usageResetDay: resolveUsageResetDay(stored.usageResetDay),
      deskCaptureEnabled: resolveDeskCaptureEnabled(stored.deskCaptureEnabled),
      deskCaptureAccelerator: resolveDeskCaptureAccelerator(stored.deskCaptureAccelerator),
      deskCaptureOpenTarget: resolveDeskCaptureOpenTarget(stored.deskCaptureOpenTarget),
      deskTrayEnabled: resolveDeskTrayEnabled(stored.deskTrayEnabled),
      deskShowEnabled: resolveDeskShowEnabled(stored.deskShowEnabled),
      deskShowAccelerator: resolveDeskShowAccelerator(stored.deskShowAccelerator),
      allowLanApiBaseUrl: resolveAllowLanApiBaseUrl(stored.allowLanApiBaseUrl),
      lastWorkspaceRoot: stored.lastWorkspaceRoot ?? null,
      recentWorkspaceRoots:
        stored.recentWorkspaceRoots ??
        (stored.lastWorkspaceRoot ? [stored.lastWorkspaceRoot] : [])
    }
  } catch {
    return {
      providerId: DEFAULT_SETTINGS.providerId,
      apiBaseUrl: DEFAULT_SETTINGS.apiBaseUrl,
      encryptedApiKey: null,
      encryptedProviderKeys: {},
      model: DEFAULT_SETTINGS.model,
      temperature: DEFAULT_SETTINGS.temperature,
      maxTokens: DEFAULT_SETTINGS.maxTokens,
      colorTheme: DEFAULT_SETTINGS.colorTheme,
      locale: DEFAULT_SETTINGS.locale,
      inlineCompletionsEnabled: DEFAULT_SETTINGS.inlineCompletionsEnabled,
      editorMinimapEnabled: DEFAULT_SETTINGS.editorMinimapEnabled,
      markdownOutlineEnabled: DEFAULT_SETTINGS.markdownOutlineEnabled,
      autoOpenAgentPreview: DEFAULT_SETTINGS.autoOpenAgentPreview,
      autoApplyAgentWrites: DEFAULT_SETTINGS.autoApplyAgentWrites,
      defaultShellId: DEFAULT_SETTINGS.defaultShellId,
      defaultUseCasePreset: DEFAULT_SETTINGS.defaultUseCasePreset,
      rememberLastUseCasePreset: DEFAULT_SETTINGS.rememberLastUseCasePreset,
      embeddingsMode: DEFAULT_SETTINGS.embeddingsMode,
      embeddingsProviderId: DEFAULT_SETTINGS.embeddingsProviderId,
      embeddingsModel: DEFAULT_SETTINGS.embeddingsModel,
      embeddingsSettingsVersion: EMBEDDINGS_SETTINGS_VERSION,
      usageResetDay: DEFAULT_SETTINGS.usageResetDay,
      deskCaptureEnabled: DEFAULT_SETTINGS.deskCaptureEnabled,
      deskCaptureAccelerator: DEFAULT_SETTINGS.deskCaptureAccelerator,
      deskCaptureOpenTarget: DEFAULT_SETTINGS.deskCaptureOpenTarget,
      deskTrayEnabled: DEFAULT_SETTINGS.deskTrayEnabled,
      deskShowEnabled: DEFAULT_SETTINGS.deskShowEnabled,
      deskShowAccelerator: DEFAULT_SETTINGS.deskShowAccelerator,
      allowLanApiBaseUrl: DEFAULT_SETTINGS.allowLanApiBaseUrl,
      lastWorkspaceRoot: null,
      recentWorkspaceRoots: []
    }
  }
}

function resolveEmbeddingsStoredFields(stored: Partial<StoredSettings>): Pick<
  StoredSettings,
  | 'embeddingsMode'
  | 'embeddingsProviderId'
  | 'embeddingsModel'
  | 'embeddingsSettingsVersion'
> {
  const version =
    typeof stored.embeddingsSettingsVersion === 'number' &&
    Number.isFinite(stored.embeddingsSettingsVersion)
      ? stored.embeddingsSettingsVersion
      : 0
  const embeddingsProviderId = resolveEmbeddingsProviderId(stored.embeddingsProviderId)
  const embeddingsModel = resolveEmbeddingsModel(stored.embeddingsModel)

  // Pre-v1 installs stored the old default `hash`. Prefer neural API going forward.
  if (version < EMBEDDINGS_SETTINGS_VERSION) {
    return {
      embeddingsMode: 'api',
      embeddingsProviderId,
      embeddingsModel,
      embeddingsSettingsVersion: EMBEDDINGS_SETTINGS_VERSION
    }
  }

  return {
    embeddingsMode: resolveEmbeddingsMode(stored.embeddingsMode),
    embeddingsProviderId,
    embeddingsModel,
    embeddingsSettingsVersion: EMBEDDINGS_SETTINGS_VERSION
  }
}

async function writeStoredSettings(stored: StoredSettings): Promise<void> {
  const userDataPath = app.getPath('userData')
  await mkdir(userDataPath, { recursive: true })
  await writeFile(getSettingsPath(), JSON.stringify(stored, null, 2), 'utf-8')
}

function toAppSettings(stored: StoredSettings): AppSettings {
  const providerId = resolveProviderId(stored.providerId, stored.apiBaseUrl)
  const providerKeys = decryptProviderKeys(stored.encryptedProviderKeys)
  const legacyKey = decryptApiKey(stored.encryptedApiKey)

  // 旧設定からの移行: 単一キーを現在プロバイダへ割り当て
  if (legacyKey && !providerKeys[providerId]) {
    providerKeys[providerId] = legacyKey
  }

  const apiKey = providerKeys[providerId] ?? legacyKey
  const provider = getLlmProvider(providerId)
  const apiBaseUrl =
    providerId === 'custom'
      ? stored.apiBaseUrl || DEFAULT_SETTINGS.apiBaseUrl
      : provider.apiBaseUrl || stored.apiBaseUrl

  return {
    providerId,
    apiBaseUrl,
    apiKey,
    providerKeys,
    model: resolveModelForProvider(providerId, stored.model),
    temperature: stored.temperature,
    maxTokens: stored.maxTokens,
    colorTheme: stored.colorTheme,
    locale: stored.locale,
    inlineCompletionsEnabled: stored.inlineCompletionsEnabled,
    editorMinimapEnabled: stored.editorMinimapEnabled,
    markdownOutlineEnabled: stored.markdownOutlineEnabled,
    autoOpenAgentPreview: stored.autoOpenAgentPreview,
    autoApplyAgentWrites: stored.autoApplyAgentWrites,
    defaultShellId: stored.defaultShellId,
    defaultUseCasePreset: stored.defaultUseCasePreset,
    rememberLastUseCasePreset: stored.rememberLastUseCasePreset,
    embeddingsMode: stored.embeddingsMode,
    embeddingsProviderId: stored.embeddingsProviderId,
    embeddingsModel: stored.embeddingsModel,
    usageResetDay: stored.usageResetDay,
    deskCaptureEnabled: stored.deskCaptureEnabled,
    deskCaptureAccelerator: stored.deskCaptureAccelerator,
    deskCaptureOpenTarget: stored.deskCaptureOpenTarget,
    deskTrayEnabled: stored.deskTrayEnabled,
    deskShowEnabled: stored.deskShowEnabled,
    deskShowAccelerator: stored.deskShowAccelerator,
    allowLanApiBaseUrl: resolveAllowLanApiBaseUrl(stored.allowLanApiBaseUrl)
  }
}

export async function getSettings(): Promise<AppSettings> {
  const stored = await readStoredSettings()
  const settings = toAppSettings(stored)
  setLocale(settings.locale)
  return settings
}

/** Renderer-facing settings: API keys never leave the main process (M5). */
export async function getPublicSettings(): Promise<AppSettings> {
  const full = await getSettings()
  const configuredProviderIds = Object.entries(full.providerKeys)
    .filter(([, key]) => Boolean(key?.trim()))
    .map(([id]) => id as LlmProviderId)

  return {
    ...full,
    apiKey: '',
    providerKeys: {},
    apiKeyConfigured: Boolean(full.apiKey.trim()),
    configuredProviderIds,
    apiKeyStorageInsecure: !safeStorage.isEncryptionAvailable() && Boolean(full.apiKey.trim())
  }
}

export async function setSettings(settings: AppSettings): Promise<void> {
  const stored = await readStoredSettings()
  const current = toAppSettings(stored)
  const providerId = isLlmProviderId(settings.providerId)
    ? settings.providerId
    : inferLlmProviderId(settings.apiBaseUrl)

  // Empty apiKey / providerKeys from renderer means "keep existing" (keys stay in main).
  const providerKeys: Partial<Record<LlmProviderId, string>> = { ...current.providerKeys }
  for (const [id, key] of Object.entries(settings.providerKeys ?? {})) {
    if (!isLlmProviderId(id)) continue
    if (typeof key === 'string' && key.trim()) {
      providerKeys[id] = key
    }
  }
  if (settings.clearApiKey) {
    delete providerKeys[providerId]
  } else if (settings.apiKey.trim()) {
    providerKeys[providerId] = settings.apiKey
  }

  const activeKey = providerKeys[providerId] ?? ''
  const encryptedProviderKeys = encryptProviderKeys(providerKeys)
  const activeEncrypted = encryptApiKey(activeKey)
  const locale = resolveLocale(settings.locale)
  const allowLanApiBaseUrl = resolveAllowLanApiBaseUrl(settings.allowLanApiBaseUrl)
  // Preserve previously saved LAN URLs when the user hasn't toggled the URL;
  // metadata hosts are always rejected inside assertSafeApiBaseUrl.
  const nextUrl = (settings.apiBaseUrl || DEFAULT_SETTINGS.apiBaseUrl).trim()
  const urlUnchanged = nextUrl.replace(/\/$/, '') === (stored.apiBaseUrl || '').replace(/\/$/, '')
  const apiBaseUrl = assertSafeApiBaseUrl(nextUrl, {
    allowPrivateLan: allowLanApiBaseUrl || urlUnchanged
  })

  await writeStoredSettings({
    ...stored,
    providerId,
    apiBaseUrl,
    allowLanApiBaseUrl,
    encryptedApiKey: activeKey ? activeEncrypted : null,
    encryptedProviderKeys,
    model: settings.model,
    temperature: settings.temperature,
    maxTokens: settings.maxTokens,
    colorTheme: resolveColorTheme(settings.colorTheme),
    locale,
    inlineCompletionsEnabled: resolveInlineCompletionsEnabled(settings.inlineCompletionsEnabled),
    editorMinimapEnabled: resolveEditorMinimapEnabled(settings.editorMinimapEnabled),
    markdownOutlineEnabled: resolveMarkdownOutlineEnabled(settings.markdownOutlineEnabled),
    autoOpenAgentPreview: resolveAutoOpenAgentPreview(settings.autoOpenAgentPreview),
    autoApplyAgentWrites: resolveAutoApplyAgentWrites(settings.autoApplyAgentWrites),
    defaultShellId: resolveDefaultShellId(settings.defaultShellId),
    defaultUseCasePreset: resolveUseCasePreset(settings.defaultUseCasePreset),
    rememberLastUseCasePreset: resolveRememberLastUseCasePreset(
      settings.rememberLastUseCasePreset
    ),
    embeddingsMode: resolveEmbeddingsMode(settings.embeddingsMode),
    embeddingsProviderId: resolveEmbeddingsProviderId(settings.embeddingsProviderId),
    embeddingsModel: resolveEmbeddingsModel(settings.embeddingsModel),
    embeddingsSettingsVersion: EMBEDDINGS_SETTINGS_VERSION,
    usageResetDay: resolveUsageResetDay(settings.usageResetDay),
    deskCaptureEnabled: resolveDeskCaptureEnabled(settings.deskCaptureEnabled),
    deskCaptureAccelerator: resolveDeskCaptureAccelerator(settings.deskCaptureAccelerator),
    deskCaptureOpenTarget: resolveDeskCaptureOpenTarget(settings.deskCaptureOpenTarget),
    deskTrayEnabled: resolveDeskTrayEnabled(settings.deskTrayEnabled),
    deskShowEnabled: resolveDeskShowEnabled(settings.deskShowEnabled),
    deskShowAccelerator: resolveDeskShowAccelerator(settings.deskShowAccelerator)
  })
  setLocale(locale)
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
