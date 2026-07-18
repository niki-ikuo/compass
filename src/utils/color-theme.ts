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
  monacoTheme: 'vs-dark' | 'vs' | 'hc-black' | 'hc-light'
  colorScheme: 'dark' | 'light'
  terminal: TerminalThemeColors
}

const THEME_LABEL_KEYS: Record<ColorThemeId, MessageKey> = {
  dark: 'theme.dark',
  light: 'theme.light',
  midnight: 'theme.midnight',
  'high-contrast': 'theme.high-contrast',
  'high-contrast-light': 'theme.high-contrast-light',
  nord: 'theme.nord',
  monokai: 'theme.monokai',
  'solarized-dark': 'theme.solarized-dark',
  'solarized-light': 'theme.solarized-light',
  forest: 'theme.forest',
  sand: 'theme.sand',
  ocean: 'theme.ocean'
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
  },
  {
    id: 'high-contrast-light',
    monacoTheme: 'hc-light',
    colorScheme: 'light',
    terminal: {
      background: '#ffffff',
      foreground: '#000000',
      cursor: '#000000',
      selectionBackground: '#0f4a8540'
    }
  },
  {
    id: 'nord',
    monacoTheme: 'vs-dark',
    colorScheme: 'dark',
    terminal: {
      background: '#2e3440',
      foreground: '#d8dee9',
      cursor: '#d8dee9',
      selectionBackground: '#434c5e'
    }
  },
  {
    id: 'monokai',
    monacoTheme: 'vs-dark',
    colorScheme: 'dark',
    terminal: {
      background: '#272822',
      foreground: '#f8f8f2',
      cursor: '#f8f8f2',
      selectionBackground: '#49483e'
    }
  },
  {
    id: 'solarized-dark',
    monacoTheme: 'vs-dark',
    colorScheme: 'dark',
    terminal: {
      background: '#002b36',
      foreground: '#839496',
      cursor: '#839496',
      selectionBackground: '#073642'
    }
  },
  {
    id: 'solarized-light',
    monacoTheme: 'vs',
    colorScheme: 'light',
    terminal: {
      background: '#fdf6e3',
      foreground: '#657b83',
      cursor: '#657b83',
      selectionBackground: '#eee8d5'
    }
  },
  {
    id: 'forest',
    monacoTheme: 'vs-dark',
    colorScheme: 'dark',
    terminal: {
      background: '#1a1f1a',
      foreground: '#d4e0d4',
      cursor: '#d4e0d4',
      selectionBackground: '#2a322a'
    }
  },
  {
    id: 'sand',
    monacoTheme: 'vs',
    colorScheme: 'light',
    terminal: {
      background: '#f5f0e6',
      foreground: '#3d3429',
      cursor: '#3d3429',
      selectionBackground: '#d4cbb8'
    }
  },
  {
    id: 'ocean',
    monacoTheme: 'vs-dark',
    colorScheme: 'dark',
    terminal: {
      background: '#0b1c2c',
      foreground: '#c5d8e8',
      cursor: '#c5d8e8',
      selectionBackground: '#1a3348'
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
