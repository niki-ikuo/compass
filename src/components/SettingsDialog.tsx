import { useState, useEffect, useRef } from 'react'
import { useAppStore } from '@/stores/app-store'
import type { AppSettings, ColorThemeId, LlmProviderId, TerminalShell, UseCasePreset } from '@/types'
import { DEFAULT_SETTINGS, normalizeUseCasePreset } from '@/types'
import { COLOR_THEMES, getColorThemeLabel } from '@/utils/color-theme'
import {
  LLM_PROVIDERS,
  getLlmProvider,
  getModelOptions,
  resolveModelForProvider
} from '@/utils/llm-providers'
import { USE_CASE_PRESET_OPTIONS } from '@/utils/use-case-preset'
import {
  useI18n,
  setLocale,
  LOCALE_OPTIONS,
  type LocaleId,
  type MessageKey
} from '@/i18n'

type SettingsTabId = 'appearance' | 'chat' | 'llm' | 'terminal'

const SETTINGS_TABS: Array<{ id: SettingsTabId; labelKey: MessageKey }> = [
  { id: 'appearance', labelKey: 'settings.appearance' },
  { id: 'chat', labelKey: 'settings.chat' },
  { id: 'llm', labelKey: 'settings.llm' },
  { id: 'terminal', labelKey: 'settings.terminal' }
]

function switchProvider(form: AppSettings, nextId: LlmProviderId): AppSettings {
  if (form.providerId === nextId) return form

  const next = getLlmProvider(nextId)
  const providerKeys: AppSettings['providerKeys'] = {
    ...form.providerKeys,
    [form.providerId]: form.apiKey
  }

  const nextKey = providerKeys[nextId] ?? ''
  const apiBaseUrl =
    nextId === 'custom'
      ? form.apiBaseUrl || next.apiBaseUrl || DEFAULT_SETTINGS.apiBaseUrl
      : next.apiBaseUrl

  return {
    ...form,
    providerId: nextId,
    providerKeys,
    apiKey: nextKey,
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
    autoOpenAgentPreview: settings.autoOpenAgentPreview === true,
    defaultShellId: settings.defaultShellId || DEFAULT_SETTINGS.defaultShellId,
    defaultUseCasePreset:
      normalizeUseCasePreset(settings.defaultUseCasePreset) ??
      DEFAULT_SETTINGS.defaultUseCasePreset,
    rememberLastUseCasePreset: settings.rememberLastUseCasePreset === true
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
  const setApiConnected = useAppStore((s) => s.setApiConnected)

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
  const [activeTab, setActiveTab] = useState<SettingsTabId>('appearance')
  const lastSavedThemeRef = useRef(initial.form.colorTheme)

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
    setActiveTab('appearance')
    void window.compass.terminal.listShells().then(setShells)

    return () => {
      // 設定タブを閉じたとき、未保存の配色プレビューを戻す
      queueMicrotask(() => {
        const stillOpen = useAppStore
          .getState()
          .openFiles.some((f) => f.viewKind === 'settings')
        if (stillOpen) return
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
          [form.providerId]: form.apiKey
        }
      }
      await window.compass.settings.set(toSave)
      setSettings(toSave)
      setLocale(toSave.locale)
      setOpenSnapshot(toSave)
      lastSavedThemeRef.current = toSave.colorTheme

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

      const provider = getLlmProvider(toSave.providerId)
      setApiConnected(provider.requiresApiKey ? (toSave.apiKey ? true : null) : true)
      setMessage(t('settings.saved'))
    } catch {
      setMessage(t('settings.saveFailed'))
    } finally {
      setSaving(false)
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
              onClick={() => setActiveTab(tab.id)}
            >
              {t(tab.labelKey)}
            </button>
          ))}
        </div>

        <div
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

            <label>
              {t('settings.apiKey')}
              <input
                type="password"
                value={form.apiKey}
                onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
                placeholder={activeProvider.requiresApiKey ? 'sk-...' : t('common.optional')}
              />
              {!activeProvider.requiresApiKey && (
                <span className="field-hint">{t('settings.apiKeyOptionalHint')}</span>
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
