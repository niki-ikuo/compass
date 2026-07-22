import {
  PANEL_LAYOUT_DEFAULTS,
  PANEL_LAYOUT_LIMITS,
  REFERENCE_LAYOUT_WIDTH,
  TERMINAL_LAYOUT_LIMITS
} from '@/utils/proportional-panel-widths'

const STORAGE_KEY = 'compass-panel-layout'

export const PANEL_VISIBILITY_DEFAULTS = {
  showFileTree: true,
  showChat: true,
  showTerminal: false
} as const

export interface PanelLayout {
  fileTreeWidthRatio: number
  chatWidthRatio: number
  terminalHeight: number
  showFileTree: boolean
  showChat: boolean
  showTerminal: boolean
}

export type PanelSizeLayout = Pick<
  PanelLayout,
  'fileTreeWidthRatio' | 'chatWidthRatio' | 'terminalHeight'
>

type StoredPanelLayout = Partial<PanelLayout> & {
  fileTreeWidth?: number
  chatWidth?: number
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function clampRatio(ratio: number): number {
  const minRatio = PANEL_LAYOUT_LIMITS.fileTree.min / REFERENCE_LAYOUT_WIDTH
  const maxRatio = PANEL_LAYOUT_LIMITS.fileTree.max / REFERENCE_LAYOUT_WIDTH
  return clamp(ratio, minRatio, maxRatio)
}

function parseBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function migrateLegacyWidths(parsed: StoredPanelLayout): PanelLayout {
  const fileTreeWidthRatio =
    parsed.fileTreeWidthRatio ??
    (parsed.fileTreeWidth != null
      ? parsed.fileTreeWidth / REFERENCE_LAYOUT_WIDTH
      : PANEL_LAYOUT_DEFAULTS.fileTreeWidthRatio)

  const chatWidthRatio =
    parsed.chatWidthRatio ??
    (parsed.chatWidth != null
      ? parsed.chatWidth / REFERENCE_LAYOUT_WIDTH
      : PANEL_LAYOUT_DEFAULTS.chatWidthRatio)

  return {
    fileTreeWidthRatio: clampRatio(fileTreeWidthRatio),
    chatWidthRatio: clampRatio(chatWidthRatio),
    terminalHeight: clamp(
      parsed.terminalHeight ?? PANEL_LAYOUT_DEFAULTS.terminalHeight,
      TERMINAL_LAYOUT_LIMITS.min,
      TERMINAL_LAYOUT_LIMITS.max
    ),
    showFileTree: parseBoolean(parsed.showFileTree, PANEL_VISIBILITY_DEFAULTS.showFileTree),
    showChat: parseBoolean(parsed.showChat, PANEL_VISIBILITY_DEFAULTS.showChat),
    showTerminal: parseBoolean(parsed.showTerminal, PANEL_VISIBILITY_DEFAULTS.showTerminal)
  }
}

export function loadPanelLayout(): PanelLayout {
  if (typeof localStorage === 'undefined') {
    return { ...PANEL_LAYOUT_DEFAULTS, ...PANEL_VISIBILITY_DEFAULTS }
  }

  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...PANEL_LAYOUT_DEFAULTS, ...PANEL_VISIBILITY_DEFAULTS }

    const parsed = JSON.parse(raw) as StoredPanelLayout
    return migrateLegacyWidths(parsed)
  } catch {
    return { ...PANEL_LAYOUT_DEFAULTS, ...PANEL_VISIBILITY_DEFAULTS }
  }
}

export function savePanelLayout(layout: PanelLayout): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(layout))
  } catch {
    // ignore quota errors
  }
}

/** Merge size layout with visibility flags for persistence. */
export function toPersistedPanelLayout(
  sizes: PanelSizeLayout,
  visibility: Pick<PanelLayout, 'showFileTree' | 'showChat' | 'showTerminal'>
): PanelLayout {
  return {
    ...sizes,
    showFileTree: visibility.showFileTree,
    showChat: visibility.showChat,
    showTerminal: visibility.showTerminal
  }
}
