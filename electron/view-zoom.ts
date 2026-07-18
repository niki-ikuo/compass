export const ZOOM_STEP = 0.5
export const ZOOM_MIN = -3
export const ZOOM_MAX = 5

export function clampZoomLevel(level: number): number {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, level))
}

export function nextZoomLevel(
  currentLevel: number,
  action: 'resetZoom' | 'zoomIn' | 'zoomOut'
): number {
  switch (action) {
    case 'resetZoom':
      return 0
    case 'zoomIn':
      return clampZoomLevel(currentLevel + ZOOM_STEP)
    case 'zoomOut':
      return clampZoomLevel(currentLevel - ZOOM_STEP)
  }
}
