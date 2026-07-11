import { useState, useEffect } from 'react'
import { useAppStore } from '@/stores/app-store'
import type { AppSettings, ColorThemeId } from '@/types'
import { DEFAULT_SETTINGS } from '@/types'
import { COLOR_THEMES } from '@/utils/color-theme'

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
      const snapshot = { ...settings }
      setForm(snapshot)
      setOpenSnapshot(snapshot)
      setMessage('')
    }
    // ダイアログを開いた時点の設定だけを取り込む
    // eslint-disable-next-line react-hooks/exhaustive-deps -- open snapshot only
  }, [settingsOpen])

  if (!settingsOpen) return null

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
      await window.compass.settings.set(form)
      setSettings(form)
      setApiConnected(form.apiKey ? true : null)
      setSettingsOpen(false)
    } catch {
      setMessage('保存に失敗しました')
    } finally {
      setSaving(false)
    }
  }

  const handleReset = () => {
    setForm({ ...openSnapshot })
    restoreColorTheme(openSnapshot.colorTheme)
    setMessage('')
  }

  const selectedTheme = COLOR_THEMES.find((theme) => theme.id === form.colorTheme) ?? COLOR_THEMES[0]

  return (
    <div className="modal-overlay" onClick={handleClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>設定</h2>
          <button className="btn-icon" onClick={handleClose}>
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

          <p className="modal-section-title">API</p>

          <label>
            API Base URL
            <input
              type="text"
              value={form.apiBaseUrl}
              onChange={(e) => setForm({ ...form, apiBaseUrl: e.target.value })}
              placeholder="https://api.openai.com/v1"
            />
          </label>

          <label>
            API Key
            <input
              type="password"
              value={form.apiKey}
              onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
              placeholder="sk-..."
            />
          </label>

          <label>
            モデル
            <input
              type="text"
              value={form.model}
              onChange={(e) => setForm({ ...form, model: e.target.value })}
              placeholder="gpt-4o-mini"
            />
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
