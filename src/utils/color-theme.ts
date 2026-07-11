import type { ColorThemeId } from '../types'
import { t, type MessageKey } from '../i18n/runtime'

export interface TerminalThemeColors {
  background: string
  foreground: string
  cursor: string
  selectionBackground: string
  black?: string
  red?: string
  green?: string
  yellow?: string
  blue?: string
  magenta?: string
  cyan?: string
  white?: string
  brightBlack?: string
  brightRed?: string
  brightGreen?: string
  brightYellow?: string
  brightBlue?: string
  brightMagenta?: string
  brightCyan?: string
  brightWhite?: string
}

export interface ColorThemeDefinition {
  id: ColorThemeId
  monacoTheme: 'vs-dark' | 'vs' | 'hc-black'
  colorScheme: 'dark' | 'light'
  terminal: TerminalThemeColors
}

const THEME_LABEL_KEYS: Record<ColorThemeId, MessageKey> = {
  dark: 'theme.dark',
  light: 'theme.light',
  midnight: 'theme.midnight',
  'high-contrast': 'theme.high-contrast'
}

export function getColorThemeLabel(id: ColorThemeId): string {
  return t(THEME_LABEL_KEYS[id])
}

export const COLOR_THEMES: ColorThemeDefinition[] = [
  {
    id: 'dark',
    monacoTheme: 'vs-dark',
    colorScheme: 'dark',
    terminal: {
      background: '#1e1e1e',
      foreground: '#cccccc',
      cursor: '#cccccc',
      selectionBackground: '#264f78'
    }
  },
  {
    id: 'light',
    monacoTheme: 'vs',
    colorScheme: 'light',
    terminal: {
      background: '#ffffff',
      foreground: '#333333',
      cursor: '#333333',
      selectionBackground: '#add6ff'
    }
  },
  {
    id: 'midnight',
    monacoTheme: 'vs-dark',
    colorScheme: 'dark',
    terminal: {
      background: '#0d1117',
      foreground: '#c9d1d9',
      cursor: '#c9d1d9',
      selectionBackground: '#264f78'
    }
  },
  {
    id: 'high-contrast',
    monacoTheme: 'hc-black',
    colorScheme: 'dark',
    terminal: {
      background: '#000000',
      foreground: '#ffffff',
      cursor: '#ffffff',
      selectionBackground: '#ffffff40'
    }
  }
]

const THEME_BY_ID = Object.fromEntries(COLOR_THEMES.map((theme) => [theme.id, theme])) as Record<
  ColorThemeId,
  ColorThemeDefinition
>

export function isColorThemeId(value: unknown): value is ColorThemeId {
  return typeof value === 'string' && value in THEME_BY_ID
}

export function getColorTheme(id: ColorThemeId | undefined | null): ColorThemeDefinition {
  if (id && isColorThemeId(id)) return THEME_BY_ID[id]
  return THEME_BY_ID.dark
}

export function applyColorTheme(id: ColorThemeId): void {
  const theme = getColorTheme(id)
  document.documentElement.dataset.theme = theme.id
  document.documentElement.style.colorScheme = theme.colorScheme
}
