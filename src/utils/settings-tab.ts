import type { LeftSidebarView } from '@/types'

export const SETTINGS_TAB_PATH = 'compass-settings://'

export type SettingsTabId = 'appearance' | 'chat' | 'llm' | 'terminal' | 'desk'

export type SettingsOpenOptions = {
  tab?: SettingsTabId
  /** Open the given tab and focus the first form control in its panel */
  focusFirstField?: boolean
}

export type SettingsFocusRequest = {
  id: number
}

/** One-shot focus request for left-sidebar panels (search / outline / git). */
export type SidebarFocusRequest = {
  id: number
  view: LeftSidebarView
}

/** One-shot focus request for the chat composer. */
export type ChatComposerFocusRequest = {
  id: number
}

export function isSettingsTabPath(path: string): boolean {
  return path === SETTINGS_TAB_PATH || path.startsWith('compass-settings://')
}

export function isSettingsOpenFile(file: { viewKind?: string }): boolean {
  return file.viewKind === 'settings'
}
