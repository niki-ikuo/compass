import { useState, useEffect } from 'react'
import { useAppStore } from '@/stores/app-store'
import type { AppSettings, ColorThemeId, LlmProviderId } from '@/types'
import { DEFAULT_SETTINGS } from '@/types'
import { COLOR_THEMES } from '@/utils/color-theme'
import {
  LLM_PROVIDERS,
  getLlmProvider,
  getModelOptions,
  resolveModelForProvider
} from '@/utils/llm-providers'

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
        ...settings,
        providerKeys: { ...settings.providerKeys }
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
      const provider = getLlmProvider(toSave.providerId)
      setApiConnected(provider.requiresApiKey ? (toSave.apiKey ? true : null) : true)
      setSettingsOpen(false)
    } catch {
      setMessage('保存に失敗しました')
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
          <h2 id="settings-dialog-title">設定</h2>
          <button className="btn-icon" onClick={handleClose} title="閉じる" aria-label="閉じる">
            ×
          </button>
        </div>

        <div className="modal-body">
          <p className="modal-section-title">外観</p>

          <label>
            配色テーマ
            <select
              value={form.colorTheme}
              onChange={(e) => previewColorTheme(e.target.value as ColorThemeId)}
            >
              {COLOR_THEMES.map((theme) => (
                <option key={theme.id} value={theme.id}>
                  {theme.label}
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

          <p className="modal-section-title">LLM</p>

          <label>
            プロバイダ
            <select
              value={form.providerId}
              onChange={(e) =>
                setForm((prev) => switchProvider(prev, e.target.value as LlmProviderId))
              }
            >
              {LLM_PROVIDERS.map((provider) => (
                <option key={provider.id} value={provider.id}>
                  {provider.label}
                </option>
              ))}
            </select>
            <span className="field-hint">{activeProvider.hint}</span>
          </label>

          <label>
            API Base URL
            <input
              type="text"
              value={form.apiBaseUrl}
              onChange={(e) => setForm({ ...form, apiBaseUrl: e.target.value })}
              placeholder="https://api.openai.com/v1"
              readOnly={!isCustomProvider}
              className={isCustomProvider ? undefined : 'input-readonly'}
            />
            {!isCustomProvider && (
              <span className="field-hint">プロバイダ選択で自動設定されます（カスタム時のみ編集可）</span>
            )}
          </label>

          <label>
            API Key
            <input
              type="password"
              value={form.apiKey}
              onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
              placeholder={activeProvider.requiresApiKey ? 'sk-...' : '（任意）'}
            />
            {!activeProvider.requiresApiKey && (
              <span className="field-hint">このプロバイダでは API Key は必須ではありません</span>
            )}
          </label>

          <label>
            モデル
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
            <span className="field-hint">一覧から選ぶか、任意のモデル ID を入力できます</span>
          </label>

          <div className="form-row">
            <label>
              温度
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
              Max Tokens
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

          {message && <p className="form-message">{message}</p>}
        </div>

        <div className="modal-footer">
          <button className="btn-secondary" onClick={handleReset}>
            リセット
          </button>
          <button className="btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? '保存中...' : '保存'}
          </button>
        </div>
      </div>
    </div>
  )
}
