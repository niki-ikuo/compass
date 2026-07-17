export const SETTINGS_TAB_PATH = 'compass-settings://'

export function isSettingsTabPath(path: string): boolean {
  return path === SETTINGS_TAB_PATH || path.startsWith('compass-settings://')
}

export function isSettingsOpenFile(file: { viewKind?: string }): boolean {
  return file.viewKind === 'settings'
}
