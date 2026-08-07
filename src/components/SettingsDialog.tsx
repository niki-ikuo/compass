import { useState, useEffect, useRef } from 'react'
import { useAppStore } from '@/stores/app-store'
import type {
  AppSettings,
  ColorThemeId,
  DeskCaptureHotkeyStatus,
  DeskShowHotkeyStatus,
  EmbeddingsMode,
  LlmProviderId,
  TerminalShell,
  UsageSnapshot,
  UseCasePreset
} from '@/types'
import { DEFAULT_SETTINGS, normalizeUseCasePreset } from '@/types'
import { COLOR_THEMES, getColorThemeLabel } from '@/utils/color-theme'
import { EMBEDDINGS_PROVIDER_IDS } from '@/utils/embeddings'
import {
  LLM_PROVIDERS,
  getLlmProvider,
  getModelOptions,
  getProviderLabel,
  resolveModelForProvider
} from '@/utils/llm-providers'
import {
  MAX_USAGE_RESET_DAY,
  MIN_USAGE_RESET_DAY,
  normalizeUsageResetDay
} from '@/utils/usage-period'
import { USE_CASE_PRESET_OPTIONS } from '@/utils/use-case-preset'
import {
  useI18n,
  setLocale,
  LOCALE_OPTIONS,
  type LocaleId,
  type MessageKey
} from '@/i18n'
import { refreshLlmConnection } from '@/utils/llm-connection'
import { focusWithRetry } from '@/utils/focus-with-retry'
import type { SettingsTabId } from '@/utils/settings-tab'

const SETTINGS_TABS: Array<{ id: SettingsTabId; labelKey: MessageKey }> = [
  { id: 'appearance', labelKey: 'settings.appearance' },
  { id: 'chat', labelKey: 'settings.chat' },
  { id: 'llm', labelKey: 'settings.llm' },
  { id: 'terminal', labelKey: 'settings.terminal' },
  { id: 'desk', labelKey: 'settings.desk' }
]

function switchProvider(form: AppSettings, nextId: LlmProviderId): AppSettings {
  if (form.providerId === nextId) return form

  const next = getLlmProvider(nextId)
  // Draft keys stay in form.providerKeys until save; main keeps real secrets.
  const providerKeys: AppSettings['providerKeys'] = {
    ...form.providerKeys,
    ...(form.apiKey.trim() ? { [form.providerId]: form.apiKey } : {})
  }

  const nextDraft = providerKeys[nextId] ?? ''
  const configured = new Set(form.configuredProviderIds ?? [])
  if (form.apiKeyConfigured) configured.add(form.providerId)
  const apiBaseUrl =
    nextId === 'custom'
      ? form.apiBaseUrl || next.apiBaseUrl || DEFAULT_SETTINGS.apiBaseUrl
      : next.apiBaseUrl

  return {
    ...form,
    providerId: nextId,
    providerKeys,
    apiKey: nextDraft,
    apiKeyConfigured: Boolean(nextDraft) || configured.has(nextId),
    configuredProviderIds: [...configured],
    clearApiKey: false,
    apiBaseUrl,
    model: resolveModelForProvider(nextId, form.model)
  }
}

function buildSettingsSnapshot(
  settings: AppSettings,
  workspaceDefaultUseCasePreset: UseCasePreset | null
): {
  form: AppSettings
  workspacePreset: '' | UseCasePreset
} {
  const form: AppSettings = {
    ...DEFAULT_SETTINGS,
    ...settings,
    providerKeys: { ...settings.providerKeys },
    inlineCompletionsEnabled: settings.inlineCompletionsEnabled !== false,
    editorMinimapEnabled: settings.editorMinimapEnabled !== false,
    markdownOutlineEnabled: settings.markdownOutlineEnabled !== false,
    autoOpenAgentPreview: settings.autoOpenAgentPreview === true,
    autoApplyAgentWrites: settings.autoApplyAgentWrites === true,
    defaultShellId: settings.defaultShellId || DEFAULT_SETTINGS.defaultShellId,
    defaultUseCasePreset:
      normalizeUseCasePreset(settings.defaultUseCasePreset) ??
      DEFAULT_SETTINGS.defaultUseCasePreset,
    rememberLastUseCasePreset: settings.rememberLastUseCasePreset === true,
    embeddingsMode: settings.embeddingsMode === 'hash' ? 'hash' : 'api',
    embeddingsProviderId: settings.embeddingsProviderId ?? '',
    embeddingsModel: settings.embeddingsModel ?? '',
    deskCaptureEnabled: settings.deskCaptureEnabled !== false,
    deskCaptureAccelerator:
      settings.deskCaptureAccelerator || DEFAULT_SETTINGS.deskCaptureAccelerator,
    deskCaptureOpenTarget:
      settings.deskCaptureOpenTarget === 'desk' ? 'desk' : 'file',
    deskTrayEnabled: settings.deskTrayEnabled === true,
    deskShowEnabled: settings.deskShowEnabled === true,
    deskShowAccelerator:
      settings.deskShowAccelerator || DEFAULT_SETTINGS.deskShowAccelerator
  }
  return {
    form,
    workspacePreset: normalizeUseCasePreset(workspaceDefaultUseCasePreset) ?? ''
  }
}

/** エディタタブ内の設定パネル */
export function SettingsPanel() {
  const { t } = useI18n()
  const settings = useAppStore((s) => s.settings)
  const workspaceRoot = useAppStore((s) => s.workspaceRoot)
  const workspaceDefaultUseCasePreset = useAppStore((s) => s.workspaceDefaultUseCasePreset)
  const setWorkspaceDefaultUseCasePreset = useAppStore((s) => s.setWorkspaceDefaultUseCasePreset)
  const setSettings = useAppStore((s) => s.setSettings)
  const llmConnection = useAppStore((s) => s.llmConnection)
  const activeTab = useAppStore((s) => s.settingsActiveTab)
  const setSettingsActiveTab = useAppStore((s) => s.setSettingsActiveTab)
  const settingsFocusRequest = useAppStore((s) => s.settingsFocusRequest)
  const clearSettingsFocusRequest = useAppStore((s) => s.clearSettingsFocusRequest)
  const [testingConnection, setTestingConnection] = useState(false)

  const initial = buildSettingsSnapshot(settings, workspaceDefaultUseCasePreset)
  const [form, setForm] = useState<AppSettings>(initial.form)
  const [openSnapshot, setOpenSnapshot] = useState<AppSettings>(initial.form)
  const [workspacePresetForm, setWorkspacePresetForm] = useState<'' | UseCasePreset>(
    initial.workspacePreset
  )
  const [workspacePresetSnapshot, setWorkspacePresetSnapshot] = useState<'' | UseCasePreset>(
    initial.workspacePreset
  )
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [shells, setShells] = useState<TerminalShell[]>([])
  const [usage, setUsage] = useState<UsageSnapshot | null>(null)
  const [resettingUsage, setResettingUsage] = useState(false)
  const [deskHotkeyStatus, setDeskHotkeyStatus] = useState<DeskCaptureHotkeyStatus | null>(null)
  const [deskShowHotkeyStatus, setDeskShowHotkeyStatus] = useState<DeskShowHotkeyStatus | null>(
    null
  )
  const lastSavedThemeRef = useRef(initial.form.colorTheme)
  const settingsBodyRef = useRef<HTMLDivElement>(null)

  const refreshDeskHotkeyStatus = async (): Promise<{
    capture: DeskCaptureHotkeyStatus | null
    show: DeskShowHotkeyStatus | null
  }> => {
    try {
      const [capture, show] = await Promise.all([
        window.compass.desk.getCaptureHotkeyStatus(),
        window.compass.desk.getShowHotkeyStatus()
      ])
      setDeskHotkeyStatus(capture)
      setDeskShowHotkeyStatus(show)
      return { capture, show }
    } catch {
      setDeskHotkeyStatus(null)
      setDeskShowHotkeyStatus(null)
      return { capture: null, show: null }
    }
  }

  const formatDeskHotkeyStatusMessage = (status: DeskCaptureHotkeyStatus): string => {
    if (!status.enabled) return t('settings.deskCaptureHotkeyDisabled')
    if (status.ok) {
      return t('settings.deskCaptureHotkeyOk', { accelerator: status.accelerator })
    }
    if (status.reason === 'invalid') {
      return t('settings.deskCaptureHotkeyInvalid', { accelerator: status.accelerator })
    }
    if (status.reason === 'duplicate') {
      return t('settings.deskShowHotkeyDuplicate', { accelerator: status.accelerator })
    }
    return t('settings.deskCaptureHotkeyFailed', { accelerator: status.accelerator })
  }

  const formatDeskShowHotkeyStatusMessage = (status: DeskShowHotkeyStatus): string => {
    if (!status.enabled) return t('settings.deskShowHotkeyDisabled')
    if (status.ok) {
      return t('settings.deskShowHotkeyOk', { accelerator: status.accelerator })
    }
    if (status.reason === 'invalid') {
      return t('settings.deskShowHotkeyInvalid', { accelerator: status.accelerator })
    }
    if (status.reason === 'duplicate') {
      return t('settings.deskShowHotkeyDuplicate', { accelerator: status.accelerator })
    }
    return t('settings.deskShowHotkeyFailed', { accelerator: status.accelerator })
  }

  useEffect(() => {
    const snapshot = buildSettingsSnapshot(
      useAppStore.getState().settings,
      useAppStore.getState().workspaceDefaultUseCasePreset
    )
    setForm(snapshot.form)
    setOpenSnapshot(snapshot.form)
    setWorkspacePresetForm(snapshot.workspacePreset)
    setWorkspacePresetSnapshot(snapshot.workspacePreset)
    lastSavedThemeRef.current = snapshot.form.colorTheme
    setMessage('')
    void window.compass.terminal.listShells().then(setShells)

    return () => {
      // 設定タブを閉じたとき、未保存の配色プレビューを戻す
      queueMicrotask(() => {
        const stillOpen = useAppStore
          .getState()
          .openFiles.some((f) => f.viewKind === 'settings')
        if (stillOpen) return
        useAppStore.getState().setSettingsActiveTab('appearance')
        useAppStore.getState().clearSettingsFocusRequest()
        const currentTheme = useAppStore.getState().settings.colorTheme
        if (currentTheme !== lastSavedThemeRef.current) {
          useAppStore.getState().setSettings({
            ...useAppStore.getState().settings,
            colorTheme: lastSavedThemeRef.current
          })
        }
      })
    }
    // タブを開いた時点の設定だけを取り込む
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!settingsFocusRequest) return
    const requestId = settingsFocusRequest.id
    focusWithRetry(() =>
      settingsBodyRef.current?.querySelector<HTMLElement>(
        'select:not([disabled]), input:not([disabled]):not([type="hidden"]), textarea:not([disabled])'
      )
    )
    // Clear after retries have been scheduled so a later open can request again.
    const clearTimer = window.setTimeout(() => {
      if (useAppStore.getState().settingsFocusRequest?.id === requestId) {
        clearSettingsFocusRequest()
      }
    }, 60)
    return () => clearTimeout(clearTimer)
  }, [settingsFocusRequest, activeTab, clearSettingsFocusRequest])

  useEffect(() => {
    let cancelled = false
    const load = async (): Promise<void> => {
      try {
        const snapshot = await window.compass.usage.get()
        if (!cancelled) setUsage(snapshot)
      } catch {
        if (!cancelled) setUsage(null)
      }
    }
    void load()
    const unsubscribe = window.compass.usage.onUpdated((snapshot) => {
      setUsage(snapshot)
    })
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [])

  const activeProvider = getLlmProvider(form.providerId)
  const modelOptions = getModelOptions(form.providerId, form.model)
  const isCustomProvider = form.providerId === 'custom'
  const selectedTheme = COLOR_THEMES.find((theme) => theme.id === form.colorTheme) ?? COLOR_THEMES[0]
  const shellOptions =
    shells.length > 0
      ? shells
      : [{ id: form.defaultShellId || DEFAULT_SETTINGS.defaultShellId, label: form.defaultShellId }]
  const defaultShellValue = shellOptions.some((shell) => shell.id === form.defaultShellId)
    ? form.defaultShellId
    : shellOptions[0].id

  useEffect(() => {
    if (activeTab !== 'desk') return
    void refreshDeskHotkeyStatus()
  }, [activeTab])

  const previewColorTheme = (colorTheme: ColorThemeId) => {
    setForm((prev) => ({ ...prev, colorTheme }))
    setSettings({ ...useAppStore.getState().settings, colorTheme })
  }

  const restoreColorTheme = (colorTheme: ColorThemeId) => {
    setSettings({ ...useAppStore.getState().settings, colorTheme })
  }

  const handleSave = async () => {
    setSaving(true)
    setMessage('')
    try {
      const toSave: AppSettings = {
        ...form,
        defaultShellId: defaultShellValue,
        providerKeys: {
          ...form.providerKeys,
          ...(form.apiKey.trim() ? { [form.providerId]: form.apiKey } : {})
        },
        clearApiKey: Boolean(form.clearApiKey)
      }
      await window.compass.settings.set(toSave)
      const publicSettings = await window.compass.settings.get()
      setSettings(publicSettings)
      setForm({
        ...publicSettings,
        providerKeys: { ...publicSettings.providerKeys },
        clearApiKey: false
      })
      setLocale(publicSettings.locale)
      setOpenSnapshot(publicSettings)
      lastSavedThemeRef.current = publicSettings.colorTheme

      if (workspaceRoot) {
        const nextWs = workspacePresetForm
          ? { defaultUseCasePreset: workspacePresetForm }
          : {}
        const saved = await window.compass.workspace.setSettings(workspaceRoot, nextWs)
        setWorkspaceDefaultUseCasePreset(saved.defaultUseCasePreset ?? null)
        setWorkspacePresetSnapshot(
          normalizeUseCasePreset(saved.defaultUseCasePreset) ?? ''
        )
      }

      void refreshLlmConnection()

      if (openSnapshot.usageResetDay !== toSave.usageResetDay) {
        void window.compass.usage.get().then(setUsage).catch(() => setUsage(null))
      }

      const embeddingsChanged =
        openSnapshot.embeddingsMode !== toSave.embeddingsMode ||
        openSnapshot.embeddingsProviderId !== toSave.embeddingsProviderId ||
        openSnapshot.embeddingsModel !== toSave.embeddingsModel

      const { capture: hotkeyStatus, show: showHotkeyStatus } = await refreshDeskHotkeyStatus()

      if (workspaceRoot && embeddingsChanged) {
        void window.compass.index.build(workspaceRoot)
        setMessage(t('settings.embeddingsRebuildQueued'))
      } else if (hotkeyStatus && !hotkeyStatus.ok && hotkeyStatus.enabled) {
        setMessage(formatDeskHotkeyStatusMessage(hotkeyStatus))
      } else if (showHotkeyStatus && !showHotkeyStatus.ok && showHotkeyStatus.enabled) {
        setMessage(formatDeskShowHotkeyStatusMessage(showHotkeyStatus))
      } else {
        setMessage(t('settings.saved'))
      }
    } catch {
      setMessage(t('settings.saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  const handleResetUsage = async (): Promise<void> => {
    if (!window.confirm(t('settings.usageResetConfirm'))) return
    setResettingUsage(true)
    try {
      const snapshot = await window.compass.usage.reset()
      setUsage(snapshot)
    } catch {
      // keep previous usage display
    } finally {
      setResettingUsage(false)
    }
  }

  const handleReset = () => {
    setForm({
      ...openSnapshot,
      providerKeys: { ...openSnapshot.providerKeys }
    })
    setWorkspacePresetForm(workspacePresetSnapshot)
    restoreColorTheme(openSnapshot.colorTheme)
    setMessage('')
  }

  return (
    <div className="settings-panel">
      <div className="settings-panel-main">
        <div className="settings-tabs" role="tablist" aria-label={t('settings.title')}>
          {SETTINGS_TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              id={`settings-tab-${tab.id}`}
              aria-selected={activeTab === tab.id}
              aria-controls={`settings-panel-${tab.id}`}
              className={`settings-tab${activeTab === tab.id ? ' active' : ''}`}
              onClick={() => setSettingsActiveTab(tab.id)}
            >
              {t(tab.labelKey)}
            </button>
          ))}
        </div>

        <div
          ref={settingsBodyRef}
          className="settings-panel-body"
          role="tabpanel"
          id={`settings-panel-${activeTab}`}
          aria-labelledby={`settings-tab-${activeTab}`}
        >
        {activeTab === 'appearance' && (
          <>
            <label>
              {t('settings.language')}
              <select
                value={form.locale}
                onChange={(e) => setForm({ ...form, locale: e.target.value as LocaleId })}
              >
                {LOCALE_OPTIONS.map((opt) => (
                  <option key={opt.id} value={opt.id}>
                    {opt.nativeLabel}
                  </option>
                ))}
              </select>
            </label>

            <label>
              {t('settings.colorTheme')}
              <select
                value={form.colorTheme}
                onChange={(e) => previewColorTheme(e.target.value as ColorThemeId)}
              >
                {COLOR_THEMES.map((theme) => (
                  <option key={theme.id} value={theme.id}>
                    {getColorThemeLabel(theme.id)}
                  </option>
                ))}
              </select>
              <span className="theme-swatch-row" aria-hidden>
                <span
                  className="theme-swatch"
                  style={{ background: selectedTheme.terminal.background }}
                />
                <span
                  className="theme-swatch"
                  style={{ background: selectedTheme.terminal.foreground }}
                />
                <span
                  className="theme-swatch"
                  style={{ background: selectedTheme.terminal.selectionBackground }}
                />
              </span>
            </label>
          </>
        )}

        {activeTab === 'chat' && (
          <>
            <label>
              {t('settings.defaultUseCasePreset')}
              <select
                value={
                  normalizeUseCasePreset(form.defaultUseCasePreset) ??
                  DEFAULT_SETTINGS.defaultUseCasePreset
                }
                onChange={(e) =>
                  setForm({
                    ...form,
                    defaultUseCasePreset:
                      normalizeUseCasePreset(e.target.value) ??
                      DEFAULT_SETTINGS.defaultUseCasePreset
                  })
                }
              >
                {USE_CASE_PRESET_OPTIONS.map((option) => (
                  <option key={option.id} value={option.id}>
                    {t(option.labelKey)} — {t(option.descKey)}
                  </option>
                ))}
              </select>
              <span className="field-hint">{t('settings.defaultUseCasePresetHint')}</span>
            </label>

            <label>
              {t('settings.workspaceUseCasePreset')}
              <select
                value={workspacePresetForm}
                disabled={!workspaceRoot}
                onChange={(e) => {
                  const value = e.target.value
                  if (!value) {
                    setWorkspacePresetForm('')
                    return
                  }
                  setWorkspacePresetForm(normalizeUseCasePreset(value) ?? '')
                }}
              >
                <option value="">{t('settings.workspaceUseCasePresetFollowApp')}</option>
                {USE_CASE_PRESET_OPTIONS.map((option) => (
                  <option key={option.id} value={option.id}>
                    {t(option.labelKey)}
                  </option>
                ))}
              </select>
              <span className="field-hint">
                {workspaceRoot
                  ? t('settings.workspaceUseCasePresetHint')
                  : t('settings.workspaceUseCasePresetNeedFolder')}
              </span>
            </label>

            <label className="settings-checkbox-label">
              <input
                type="checkbox"
                checked={form.rememberLastUseCasePreset === true}
                onChange={(e) =>
                  setForm({ ...form, rememberLastUseCasePreset: e.target.checked })
                }
              />
              <span>
                {t('settings.rememberLastUseCasePreset')}
                <span className="field-hint">{t('settings.rememberLastUseCasePresetHint')}</span>
              </span>
            </label>

            <label className="settings-checkbox-label">
              <input
                type="checkbox"
                checked={form.autoApplyAgentWrites}
                onChange={(e) => setForm({ ...form, autoApplyAgentWrites: e.target.checked })}
              />
              <span>
                {t('settings.autoApplyAgentWrites')}
                <span className="field-hint">{t('settings.autoApplyAgentWritesHint')}</span>
              </span>
            </label>
          </>
        )}

        {activeTab === 'llm' && (
          <>
            <label>
              {t('settings.provider')}
              <select
                value={form.providerId}
                onChange={(e) =>
                  setForm((prev) => switchProvider(prev, e.target.value as LlmProviderId))
                }
              >
                {LLM_PROVIDERS.map((provider) => (
                  <option key={provider.id} value={provider.id}>
                    {t(`provider.${provider.id}.label` as MessageKey)}
                  </option>
                ))}
              </select>
              <span className="field-hint">
                {t(`provider.${activeProvider.id}.hint` as MessageKey)}
              </span>
            </label>

            <label>
              {t('settings.apiBaseUrl')}
              <input
                type="text"
                value={form.apiBaseUrl}
                onChange={(e) => setForm({ ...form, apiBaseUrl: e.target.value })}
                placeholder="https://api.openai.com/v1"
                readOnly={!isCustomProvider}
                className={isCustomProvider ? undefined : 'input-readonly'}
              />
              {!isCustomProvider && (
                <span className="field-hint">{t('settings.apiBaseUrlHint')}</span>
              )}
            </label>

            {isCustomProvider && (
              <label className="settings-checkbox-row">
                <input
                  type="checkbox"
                  checked={form.allowLanApiBaseUrl === true}
                  onChange={(e) =>
                    setForm({ ...form, allowLanApiBaseUrl: e.target.checked })
                  }
                />
                <span>
                  {t('settings.allowLanApiBaseUrl')}
                  <span className="field-hint">{t('settings.allowLanApiBaseUrlHint')}</span>
                </span>
              </label>
            )}

            <label>
              {t('settings.apiKey')}
              <input
                type="password"
                value={form.apiKey}
                onChange={(e) =>
                  setForm({
                    ...form,
                    apiKey: e.target.value,
                    clearApiKey: false
                  })
                }
                placeholder={
                  form.apiKeyConfigured && !form.apiKey
                    ? t('settings.apiKeyConfiguredPlaceholder')
                    : activeProvider.requiresApiKey
                      ? 'sk-...'
                      : t('common.optional')
                }
              />
              {form.apiKeyConfigured && !form.apiKey && (
                <span className="field-hint">{t('settings.apiKeyKeptInMain')}</span>
              )}
              {form.apiKeyStorageInsecure && (
                <span className="field-hint">{t('settings.apiKeyStorageInsecure')}</span>
              )}
              {!activeProvider.requiresApiKey && (
                <span className="field-hint">{t('settings.apiKeyOptionalHint')}</span>
              )}
              {form.apiKeyConfigured && (
                <button
                  type="button"
                  className="btn-secondary"
                  style={{ marginTop: 6 }}
                  onClick={() =>
                    setForm({
                      ...form,
                      apiKey: '',
                      apiKeyConfigured: false,
                      clearApiKey: true,
                      configuredProviderIds: (form.configuredProviderIds ?? []).filter(
                        (id) => id !== form.providerId
                      )
                    })
                  }
                >
                  {t('settings.clearApiKey')}
                </button>
              )}
            </label>

            <label>
              {t('settings.model')}
              {modelOptions.length > 0 ? (
                <>
                  <input
                    type="text"
                    list="llm-model-options"
                    value={form.model}
                    onChange={(e) => setForm({ ...form, model: e.target.value })}
                    placeholder={activeProvider.defaultModel || 'model-id'}
                  />
                  <datalist id="llm-model-options">
                    {modelOptions.map((model) => (
                      <option key={model} value={model} />
                    ))}
                  </datalist>
                </>
              ) : (
                <input
                  type="text"
                  value={form.model}
                  onChange={(e) => setForm({ ...form, model: e.target.value })}
                  placeholder="model-id"
                />
              )}
              <span className="field-hint">{t('settings.modelHint')}</span>
            </label>

            <div className="settings-connection-row">
              <button
                type="button"
                className="btn-secondary"
                disabled={testingConnection || saving}
                onClick={() => {
                  setTestingConnection(true)
                  void refreshLlmConnection().finally(() => setTestingConnection(false))
                }}
              >
                {testingConnection || llmConnection.status === 'checking'
                  ? t('settings.testingConnection')
                  : t('settings.testConnection')}
              </button>
              <span
                className={`settings-connection-status status-${llmConnection.status}`}
                title={llmConnection.error ?? undefined}
              >
                {llmConnection.status === 'checking' && t('status.checking')}
                {llmConnection.status === 'connected' && t('status.connected')}
                {llmConnection.status === 'incomplete' &&
                  (llmConnection.error || t('status.configuredHint'))}
                {llmConnection.status === 'error' &&
                  (llmConnection.error || t('status.connectionFailed'))}
              </span>
            </div>

            <div className="form-row">
              <label>
                {t('settings.temperature')}
                <input
                  type="number"
                  min={0}
                  max={2}
                  step={0.1}
                  value={form.temperature}
                  onChange={(e) => setForm({ ...form, temperature: parseFloat(e.target.value) })}
                />
              </label>

              <label>
                {t('settings.maxTokens')}
                <input
                  type="number"
                  min={256}
                  max={128000}
                  step={256}
                  value={form.maxTokens}
                  onChange={(e) => setForm({ ...form, maxTokens: parseInt(e.target.value) })}
                />
              </label>
            </div>

            <div className="settings-usage-block">
              <div className="settings-usage-heading">{t('settings.usageSection')}</div>
              {usage && (
                <>
                  <div className="settings-usage-row">
                    <span>{t('settings.usagePeriod')}</span>
                    <span>
                      {t('settings.usagePeriodValue', {
                        start: usage.periodStart,
                        end: usage.periodEnd
                      })}
                    </span>
                  </div>
                  <div className="settings-usage-row">
                    <span>{t('settings.usageRequests')}</span>
                    <span>{usage.requestCount}</span>
                  </div>
                  <div className="settings-usage-row">
                    <span>{t('settings.usageTokens')}</span>
                    <span>
                      {t('settings.usageTokensDetail', {
                        prompt: String(usage.promptTokens),
                        completion: String(usage.completionTokens),
                        total: String(usage.promptTokens + usage.completionTokens)
                      })}
                    </span>
                  </div>
                  {usage.usageMissingCount > 0 && (
                    <div className="field-hint">
                      {t('settings.usageMissing', { count: String(usage.usageMissingCount) })}
                    </div>
                  )}
                </>
              )}
              <label>
                {t('settings.usageResetDay')}
                <input
                  type="number"
                  min={MIN_USAGE_RESET_DAY}
                  max={MAX_USAGE_RESET_DAY}
                  step={1}
                  value={form.usageResetDay}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      usageResetDay: normalizeUsageResetDay(parseInt(e.target.value, 10))
                    })
                  }
                />
                <span className="field-hint">{t('settings.usageResetDayHint')}</span>
              </label>
              <button
                type="button"
                className="btn-secondary"
                disabled={resettingUsage || saving}
                onClick={() => void handleResetUsage()}
              >
                {t('settings.usageReset')}
              </button>
            </div>

            <label className="settings-checkbox-label">
              <input
                type="checkbox"
                checked={form.inlineCompletionsEnabled}
                onChange={(e) => setForm({ ...form, inlineCompletionsEnabled: e.target.checked })}
              />
              <span>
                {t('settings.inlineCompletions')}
                <span className="field-hint">{t('settings.inlineCompletionsHint')}</span>
              </span>
            </label>

            <label className="settings-checkbox-label">
              <input
                type="checkbox"
                checked={form.autoOpenAgentPreview}
                onChange={(e) => setForm({ ...form, autoOpenAgentPreview: e.target.checked })}
              />
              <span>
                {t('settings.autoOpenAgentPreview')}
                <span className="field-hint">{t('settings.autoOpenAgentPreviewHint')}</span>
              </span>
            </label>

            <label>
              {t('settings.embeddingsMode')}
              <select
                value={form.embeddingsMode}
                onChange={(e) =>
                  setForm({
                    ...form,
                    embeddingsMode: (e.target.value === 'hash' ? 'hash' : 'api') as EmbeddingsMode
                  })
                }
              >
                <option value="api">{t('settings.embeddingsModeApi')}</option>
                <option value="hash">{t('settings.embeddingsModeHash')}</option>
              </select>
              <span className="field-hint">{t('settings.embeddingsModeHint')}</span>
            </label>

            {form.embeddingsMode === 'api' && (
              <>
                <label>
                  {t('settings.embeddingsProvider')}
                  <select
                    value={form.embeddingsProviderId || ''}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        embeddingsProviderId: (e.target.value || '') as AppSettings['embeddingsProviderId']
                      })
                    }
                  >
                    <option value="">{t('settings.embeddingsProviderSame')}</option>
                    {EMBEDDINGS_PROVIDER_IDS.map((id) => (
                      <option key={id} value={id}>
                        {getProviderLabel(id)}
                      </option>
                    ))}
                  </select>
                  <span className="field-hint">{t('settings.embeddingsProviderHint')}</span>
                </label>
                <label>
                  {t('settings.embeddingsModel')}
                  <input
                    type="text"
                    value={form.embeddingsModel}
                    onChange={(e) => setForm({ ...form, embeddingsModel: e.target.value })}
                    placeholder={
                      form.embeddingsProviderId === 'ollama' ||
                      (!form.embeddingsProviderId && form.providerId === 'ollama')
                        ? 'nomic-embed-text'
                        : 'text-embedding-3-small'
                    }
                  />
                  <span className="field-hint">{t('settings.embeddingsModelHint')}</span>
                </label>
              </>
            )}
          </>
        )}

        {activeTab === 'terminal' && (
          <label>
            {t('settings.defaultShell')}
            <select
              value={defaultShellValue}
              onChange={(e) => setForm({ ...form, defaultShellId: e.target.value })}
              disabled={shells.length === 0}
            >
              {shellOptions.map((shell) => (
                <option key={shell.id} value={shell.id}>
                  {shell.label}
                </option>
              ))}
            </select>
            <span className="field-hint">
              {shells.length === 0 ? t('terminal.noShell') : t('settings.defaultShellHint')}
            </span>
          </label>
        )}

        {activeTab === 'desk' && (
          <>
            <label className="settings-checkbox-label">
              <input
                type="checkbox"
                checked={form.deskCaptureEnabled}
                onChange={(e) => setForm({ ...form, deskCaptureEnabled: e.target.checked })}
              />
              <span>
                {t('settings.deskCapture')}
                <span className="field-hint">{t('settings.deskCaptureHint')}</span>
              </span>
            </label>
            <label>
              {t('settings.deskCaptureAccelerator')}
              <input
                type="text"
                value={form.deskCaptureAccelerator}
                onChange={(e) => setForm({ ...form, deskCaptureAccelerator: e.target.value })}
                disabled={!form.deskCaptureEnabled}
              />
            </label>
            {deskHotkeyStatus ? (
              <p
                className={`settings-connection-status settings-hotkey-status${
                  !deskHotkeyStatus.enabled
                    ? ''
                    : deskHotkeyStatus.ok
                      ? ' status-connected'
                      : ' status-error'
                }`}
                role={deskHotkeyStatus.ok || !deskHotkeyStatus.enabled ? undefined : 'alert'}
              >
                {formatDeskHotkeyStatusMessage(deskHotkeyStatus)}
              </p>
            ) : null}
            <label className="settings-checkbox-label">
              <input
                type="checkbox"
                checked={form.deskShowEnabled}
                onChange={(e) => setForm({ ...form, deskShowEnabled: e.target.checked })}
              />
              <span>
                {t('settings.deskShow')}
                <span className="field-hint">{t('settings.deskShowHint')}</span>
              </span>
            </label>
            <label>
              {t('settings.deskShowAccelerator')}
              <input
                type="text"
                value={form.deskShowAccelerator}
                onChange={(e) => setForm({ ...form, deskShowAccelerator: e.target.value })}
                disabled={!form.deskShowEnabled}
              />
            </label>
            {deskShowHotkeyStatus ? (
              <p
                className={`settings-connection-status settings-hotkey-status${
                  !deskShowHotkeyStatus.enabled
                    ? ''
                    : deskShowHotkeyStatus.ok
                      ? ' status-connected'
                      : ' status-error'
                }`}
                role={
                  deskShowHotkeyStatus.ok || !deskShowHotkeyStatus.enabled ? undefined : 'alert'
                }
              >
                {formatDeskShowHotkeyStatusMessage(deskShowHotkeyStatus)}
              </p>
            ) : null}
            <label className="settings-checkbox-label">
              <input
                type="checkbox"
                checked={form.deskTrayEnabled}
                onChange={(e) => setForm({ ...form, deskTrayEnabled: e.target.checked })}
              />
              <span>
                {t('settings.deskTray')}
                <span className="field-hint">{t('settings.deskTrayHint')}</span>
              </span>
            </label>
            <label>
              {t('settings.deskCaptureOpenTarget')}
              <select
                value={form.deskCaptureOpenTarget}
                onChange={(e) =>
                  setForm({
                    ...form,
                    deskCaptureOpenTarget: e.target.value === 'desk' ? 'desk' : 'file'
                  })
                }
              >
                <option value="file">{t('settings.deskCaptureOpenFile')}</option>
                <option value="desk">{t('settings.deskCaptureOpenDesk')}</option>
              </select>
            </label>
          </>
        )}

        {message && <p className="form-message">{message}</p>}
        </div>
      </div>

      <div className="settings-panel-footer">
        <button type="button" className="btn-secondary" onClick={handleReset}>
          {t('common.reset')}
        </button>
        <button type="button" className="btn-primary" onClick={() => void handleSave()} disabled={saving}>
          {saving ? t('common.saving') : t('common.save')}
        </button>
      </div>
    </div>
  )
}

/** @deprecated 互換用エイリアス — エディタタブの SettingsPanel を使う */
export const SettingsDialog = SettingsPanel
