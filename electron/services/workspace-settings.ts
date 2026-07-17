import { mkdir, readFile, writeFile } from 'fs/promises'
import { join } from 'path'
import type { UseCasePreset, WorkspaceSettings } from '../../src/types'
import { normalizeUseCasePreset } from '../../src/types'

const COMPASS_DIR = '.compass'
const SETTINGS_FILE = 'settings.json'

function getWorkspaceSettingsPath(workspaceRoot: string): string {
  return join(workspaceRoot, COMPASS_DIR, SETTINGS_FILE)
}

export function createEmptyWorkspaceSettings(): WorkspaceSettings {
  return {}
}

export async function getWorkspaceSettings(workspaceRoot: string): Promise<WorkspaceSettings> {
  try {
    const raw = await readFile(getWorkspaceSettingsPath(workspaceRoot), 'utf-8')
    const stored = JSON.parse(raw) as Partial<WorkspaceSettings>
    const preset = normalizeUseCasePreset(stored.defaultUseCasePreset)
    return {
      ...(preset ? { defaultUseCasePreset: preset } : {})
    }
  } catch {
    return createEmptyWorkspaceSettings()
  }
}

export async function setWorkspaceSettings(
  workspaceRoot: string,
  settings: WorkspaceSettings
): Promise<WorkspaceSettings> {
  const preset = normalizeUseCasePreset(settings.defaultUseCasePreset)
  const next: WorkspaceSettings = {}
  if (preset) {
    next.defaultUseCasePreset = preset
  }

  const compassDir = join(workspaceRoot, COMPASS_DIR)
  await mkdir(compassDir, { recursive: true })
  await writeFile(getWorkspaceSettingsPath(workspaceRoot), JSON.stringify(next, null, 2), 'utf-8')
  return next
}

/** UI で「アプリ設定に従う」を選んだとき用 — キーを消す */
export async function clearWorkspaceDefaultUseCasePreset(
  workspaceRoot: string
): Promise<WorkspaceSettings> {
  return setWorkspaceSettings(workspaceRoot, {})
}

export function resolveWorkspaceDefaultUseCasePreset(
  settings: WorkspaceSettings | null | undefined
): UseCasePreset | undefined {
  return normalizeUseCasePreset(settings?.defaultUseCasePreset)
}
