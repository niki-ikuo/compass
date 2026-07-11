import { PANEL_LAYOUT_DEFAULTS, PANEL_LAYOUT_LIMITS, TERMINAL_LAYOUT_LIMITS } from '@/components/ResizableLayout'

const STORAGE_KEY = 'compass-panel-layout'

export interface PanelLayout {
  fileTreeWidth: number
  chatWidth: number
  terminalHeight: number
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export function loadPanelLayout(): PanelLayout {
  if (typeof localStorage === 'undefined') {
    return { ...PANEL_LAYOUT_DEFAULTS }
  }

  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...PANEL_LAYOUT_DEFAULTS }

    const parsed = JSON.parse(raw) as Partial<PanelLayout>
    return {
      fileTreeWidth: clamp(
        parsed.fileTreeWidth ?? PANEL_LAYOUT_DEFAULTS.fileTreeWidth,
        PANEL_LAYOUT_LIMITS.fileTree.min,
        PANEL_LAYOUT_LIMITS.fileTree.max
      ),
      chatWidth: clamp(
        parsed.chatWidth ?? PANEL_LAYOUT_DEFAULTS.chatWidth,
        PANEL_LAYOUT_LIMITS.chat.min,
        PANEL_LAYOUT_LIMITS.chat.max
      ),
      terminalHeight: clamp(
        parsed.terminalHeight ?? PANEL_LAYOUT_DEFAULTS.terminalHeight,
        TERMINAL_LAYOUT_LIMITS.min,
        TERMINAL_LAYOUT_LIMITS.max
      )
    }
  } catch {
    return { ...PANEL_LAYOUT_DEFAULTS }
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
