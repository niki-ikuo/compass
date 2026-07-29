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

/** Light themes remap ANSI "white" to dark ink — PSReadLine often emits SGR 37. */
const ANSI_DARK = {
  black: '#0c0c0c',
  red: '#cd3131',
  green: '#0dbc79',
  yellow: '#e5e510',
  blue: '#2472c8',
  magenta: '#bc3fbc',
  cyan: '#11a8cd',
  white: '#e5e5e5',
  brightBlack: '#767676',
  brightRed: '#f14c4c',
  brightGreen: '#23d18b',
  brightYellow: '#f5f543',
  brightBlue: '#3b8eea',
  brightMagenta: '#d670d6',
  brightCyan: '#29b8db',
  brightWhite: '#e5e5e5'
} as const

const ANSI_LIGHT = {
  black: '#000000',
  red: '#cd3131',
  green: '#00a300',
  yellow: '#949800',
  blue: '#0451a5',
  magenta: '#bc05bc',
  cyan: '#0598bc',
  white: '#383838',
  brightBlack: '#666666',
  brightRed: '#cd3131',
  brightGreen: '#14ce14',
  brightYellow: '#b5ba00',
  brightBlue: '#0451a5',
  brightMagenta: '#bc05bc',
  brightCyan: '#0598bc',
  brightWhite: '#1a1a1a'
} as const

function terminalColors(
  base: Pick<
    TerminalThemeColors,
    'background' | 'foreground' | 'cursor' | 'selectionBackground'
  >,
  scheme: 'dark' | 'light'
): TerminalThemeColors {
  return { ...base, ...(scheme === 'light' ? ANSI_LIGHT : ANSI_DARK) }
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
    terminal: terminalColors(
      {
        background: '#1e1e1e',
        foreground: '#cccccc',
        cursor: '#cccccc',
        selectionBackground: '#264f78'
      },
      'dark'
    )
  },
  {
    id: 'light',
    monacoTheme: 'vs',
    colorScheme: 'light',
    terminal: terminalColors(
      {
        background: '#ffffff',
        foreground: '#333333',
        cursor: '#333333',
        selectionBackground: '#add6ff'
      },
      'light'
    )
  },
  {
    id: 'midnight',
    monacoTheme: 'vs-dark',
    colorScheme: 'dark',
    terminal: terminalColors(
      {
        background: '#0d1117',
        foreground: '#c9d1d9',
        cursor: '#c9d1d9',
        selectionBackground: '#264f78'
      },
      'dark'
    )
  },
  {
    id: 'high-contrast',
    monacoTheme: 'hc-black',
    colorScheme: 'dark',
    terminal: terminalColors(
      {
        background: '#000000',
        foreground: '#ffffff',
        cursor: '#ffffff',
        selectionBackground: '#ffffff40'
      },
      'dark'
    )
  },
  {
    id: 'high-contrast-light',
    monacoTheme: 'hc-light',
    colorScheme: 'light',
    terminal: terminalColors(
      {
        background: '#ffffff',
        foreground: '#000000',
        cursor: '#000000',
        selectionBackground: '#0f4a8540'
      },
      'light'
    )
  },
  {
    id: 'nord',
    monacoTheme: 'vs-dark',
    colorScheme: 'dark',
    terminal: terminalColors(
      {
        background: '#2e3440',
        foreground: '#d8dee9',
        cursor: '#d8dee9',
        selectionBackground: '#434c5e'
      },
      'dark'
    )
  },
  {
    id: 'monokai',
    monacoTheme: 'vs-dark',
    colorScheme: 'dark',
    terminal: terminalColors(
      {
        background: '#272822',
        foreground: '#f8f8f2',
        cursor: '#f8f8f2',
        selectionBackground: '#49483e'
      },
      'dark'
    )
  },
  {
    id: 'solarized-dark',
    monacoTheme: 'vs-dark',
    colorScheme: 'dark',
    terminal: terminalColors(
      {
        background: '#002b36',
        foreground: '#839496',
        cursor: '#839496',
        selectionBackground: '#073642'
      },
      'dark'
    )
  },
  {
    id: 'solarized-light',
    monacoTheme: 'vs',
    colorScheme: 'light',
    terminal: terminalColors(
      {
        background: '#fdf6e3',
        foreground: '#657b83',
        cursor: '#657b83',
        selectionBackground: '#eee8d5'
      },
      'light'
    )
  },
  {
    id: 'forest',
    monacoTheme: 'vs-dark',
    colorScheme: 'dark',
    terminal: terminalColors(
      {
        background: '#1a1f1a',
        foreground: '#d4e0d4',
        cursor: '#d4e0d4',
        selectionBackground: '#2a322a'
      },
      'dark'
    )
  },
  {
    id: 'sand',
    monacoTheme: 'vs',
    colorScheme: 'light',
    terminal: terminalColors(
      {
        background: '#f5f0e6',
        foreground: '#3d3429',
        cursor: '#3d3429',
        selectionBackground: '#d4cbb8'
      },
      'light'
    )
  },
  {
    id: 'ocean',
    monacoTheme: 'vs-dark',
    colorScheme: 'dark',
    terminal: terminalColors(
      {
        background: '#0b1c2c',
        foreground: '#c5d8e8',
        cursor: '#c5d8e8',
        selectionBackground: '#1a3348'
      },
      'dark'
    )
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

/** BrowserWindow / 起動フラッシュ防止用。CSS の --bg-primary と揃える */
export function getThemeBackgroundColor(id: ColorThemeId | undefined | null): string {
  return getColorTheme(id).terminal.background
}

/** main → renderer へ起動テーマを渡す additionalArguments の接頭辞 */
export const COLOR_THEME_ARG_PREFIX = '--compass-color-theme='

export function parseColorThemeArg(argv: readonly string[]): ColorThemeId | null {
  const arg = argv.find((entry) => entry.startsWith(COLOR_THEME_ARG_PREFIX))
  if (!arg) return null
  const id = arg.slice(COLOR_THEME_ARG_PREFIX.length)
  return isColorThemeId(id) ? id : null
}

export function applyColorTheme(id: ColorThemeId): void {
  const theme = getColorTheme(id)
  document.documentElement.dataset.theme = theme.id
  document.documentElement.style.colorScheme = theme.colorScheme
  document.documentElement.style.backgroundColor = theme.terminal.background
}
