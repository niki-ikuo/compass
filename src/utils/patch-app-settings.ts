import type { AppSettings } from '@/types'
import { useAppStore } from '@/stores/app-store'

/** ストアを更新し、可能なら永続化する */
export async function patchAppSettings(patch: Partial<AppSettings>): Promise<void> {
  const { settings, setSettings } = useAppStore.getState()
  const next: AppSettings = {
    ...settings,
    ...patch,
    providerKeys: {
      ...settings.providerKeys,
      [settings.providerId]: settings.apiKey
    }
  }
  setSettings(next)
  try {
    await window.compass.settings.set(next)
  } catch {
    // ストアは更新済み。永続化失敗時は次回起動で戻る
  }
}
