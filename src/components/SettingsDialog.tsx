import { useState, useEffect } from 'react'
import { useAppStore } from '@/stores/app-store'
import type { AppSettings, ColorThemeId, LlmProviderId } from '@/types'
import { DEFAULT_SETTINGS } from '@/types'
import { COLOR_THEMES, getColorThemeLabel } from '@/utils/color-theme'
import {
  LLM_PROVIDERS,
  getLlmProvider,
  getModelOptions,
  resolveModelForProvider
} from '@/utils/llm-providers'
import {
  useI18n,
  setLocale,
  LOCALE_OPTIONS,
  type LocaleId,
  type MessageKey
} from '@/i18n'

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

export function SettingsDialog() {
  const { t } = useI18n()
  const settingsOpen = useAppStore((s) => s.settingsOpen)
  const settings = useAppStore((s) => s.settings)
  const setSettingsOpen = useAppStore((s) => s.setSettingsOpen)
  const setSettings = useAppStore((s) => s.setSettings)
  const setApiConnected = useAppStore((s) => s.setApiConnected)

  const [form, setForm] = useState<AppSettings>({ ...DEFAULT_SETTINGS })
  const [openSnapshot, setOpenSnapshot] = useState<AppSettings>({ ...DEFAULT_SETTINGS })
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => {
    if (settingsOpen) {
      const snapshot = {
        ...DEFAULT_SETTINGS,
        ...settings,
        providerKeys: { ...settings.providerKeys },
        inlineCompletionsEnabled: settings.inlineCompletionsEnabled !== false
      }
      setForm(snapshot)
      setOpenSnapshot(snapshot)
      setMessage('')
    }
    // ダイアログを開いた時点の設定だけを取り込む
    // eslint-disable-next-line react-hooks/exhaustive-deps -- open snapshot only
  }, [settingsOpen])

  if (!settingsOpen) return null

  const activeProvider = getLlmProvider(form.providerId)
  const modelOptions = getModelOptions(form.providerId, form.model)
  const isCustomProvider = form.providerId === 'custom'
  const selectedTheme = COLOR_THEMES.find((theme) => theme.id === form.colorTheme) ?? COLOR_THEMES[0]

  const previewColorTheme = (colorTheme: ColorThemeId) => {
    setForm((prev) => ({ ...prev, colorTheme }))
    setSettings({ ...useAppStore.getState().settings, colorTheme })
  }

  const restoreColorTheme = (colorTheme: ColorThemeId) => {
    setSettings({ ...useAppStore.getState().settings, colorTheme })
  }

  const handleClose = () => {
    restoreColorTheme(openSnapshot.colorTheme)
    setSettingsOpen(false)
  }

  const handleSave = async () => {
    setSaving(true)
    setMessage('')
    try {
      const toSave: AppSettings = {
        ...form,
        providerKeys: {
          ...form.providerKeys,
          [form.providerId]: form.apiKey
        }
      }
      await window.compass.settings.set(toSave)
      setSettings(toSave)
      setLocale(toSave.locale)
      const provider = getLlmProvider(toSave.providerId)
      setApiConnected(provider.requiresApiKey ? (toSave.apiKey ? true : null) : true)
      setSettingsOpen(false)
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
    restoreColorTheme(openSnapshot.colorTheme)
    setMessage('')
  }

  return (
    <div className="modal-overlay">
      <div className="modal modal-wide" role="dialog" aria-modal="true" aria-labelledby="settings-dialog-title">
        <div className="modal-header">
          <h2 id="settings-dialog-title">{t('settings.title')}</h2>
          <button
            className="btn-icon"
            onClick={handleClose}
            title={t('common.close')}
            aria-label={t('common.close')}
          >
            ×
          </button>
        </div>

        <div className="modal-body">
          <p className="modal-section-title">{t('settings.appearance')}</p>

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

          <p className="modal-section-title">{t('settings.llm')}</p>

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

          {message && <p className="form-message">{message}</p>}
        </div>

        <div className="modal-footer">
          <button className="btn-secondary" onClick={handleReset}>
            {t('common.reset')}
          </button>
          <button className="btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? t('common.saving') : t('common.save')}
          </button>
        </div>
      </div>
    </div>
  )
}
