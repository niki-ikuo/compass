export const MIN_SIDE_PANEL = 120
export const MAX_SIDE_PANEL = 1200
export const MIN_EDITOR = 200
export const PANEL_HANDLE_WIDTH = 4

/** Baseline window width used when migrating legacy pixel widths to ratios. */
export const REFERENCE_LAYOUT_WIDTH = 1280

export const PANEL_LAYOUT_DEFAULTS = {
  fileTreeWidthRatio: 240 / REFERENCE_LAYOUT_WIDTH,
  chatWidthRatio: 360 / REFERENCE_LAYOUT_WIDTH,
  terminalHeight: 220
} as const

export const PANEL_LAYOUT_LIMITS = {
  fileTree: { min: MIN_SIDE_PANEL, max: MAX_SIDE_PANEL },
  chat: { min: MIN_SIDE_PANEL, max: MAX_SIDE_PANEL }
} as const

export const TERMINAL_LAYOUT_LIMITS = {
  min: 100,
  max: 600
} as const

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export interface ProportionalPanelWidthInput {
  containerWidth: number
  showLeft: boolean
  showRight: boolean
  leftRatio: number
  rightRatio: number
}

export function resolveProportionalPanelWidths({
  containerWidth,
  showLeft,
  showRight,
  leftRatio,
  rightRatio
}: ProportionalPanelWidthInput): { leftWidth: number; rightWidth: number } {
  if (containerWidth <= 0) {
    return { leftWidth: 0, rightWidth: 0 }
  }

  const handleSpace =
    (showLeft ? PANEL_HANDLE_WIDTH : 0) + (showRight ? PANEL_HANDLE_WIDTH : 0)
  const maxSideTotal = Math.max(0, containerWidth - handleSpace - MIN_EDITOR)

  let left = showLeft ? leftRatio * containerWidth : 0
  let right = showRight ? rightRatio * containerWidth : 0

  if (showLeft) {
    left = clamp(left, MIN_SIDE_PANEL, MAX_SIDE_PANEL)
  }
  if (showRight) {
    right = clamp(right, MIN_SIDE_PANEL, MAX_SIDE_PANEL)
  }

  const sideTotal = left + right
  if (sideTotal > maxSideTotal && sideTotal > 0) {
    const scale = maxSideTotal / sideTotal
    if (showLeft) left *= scale
    if (showRight) right *= scale

    if (showLeft) left = Math.max(MIN_SIDE_PANEL, left)
    if (showRight) right = Math.max(MIN_SIDE_PANEL, right)

    const adjustedTotal = left + right
    if (adjustedTotal > maxSideTotal && adjustedTotal > 0) {
      const fallbackScale = maxSideTotal / adjustedTotal
      if (showLeft) left *= fallbackScale
      if (showRight) right *= fallbackScale
    }
  }

  return {
    leftWidth: showLeft ? Math.round(left) : 0,
    rightWidth: showRight ? Math.round(right) : 0
  }
}

export function ratioFromPixelWidth(width: number, containerWidth: number): number {
  if (containerWidth <= 0) return 0
  return width / containerWidth
}

export function getMaxLeftWidth(
  containerWidth: number,
  showRight: boolean,
  rightWidth: number
): number {
  const handleSpace =
    (showRight ? PANEL_HANDLE_WIDTH : 0) + PANEL_HANDLE_WIDTH
  return Math.min(
    MAX_SIDE_PANEL,
    Math.max(MIN_SIDE_PANEL, containerWidth - handleSpace - (showRight ? rightWidth : 0) - MIN_EDITOR)
  )
}

export function getMaxRightWidth(
  containerWidth: number,
  showLeft: boolean,
  leftWidth: number
): number {
  const handleSpace =
    (showLeft ? PANEL_HANDLE_WIDTH : 0) + PANEL_HANDLE_WIDTH
  return Math.min(
    MAX_SIDE_PANEL,
    Math.max(MIN_SIDE_PANEL, containerWidth - handleSpace - (showLeft ? leftWidth : 0) - MIN_EDITOR)
  )
}
