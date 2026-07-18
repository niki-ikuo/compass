import { describe, expect, it } from 'vitest'
import { ZOOM_MAX, ZOOM_MIN, ZOOM_STEP, clampZoomLevel, nextZoomLevel } from './view-zoom'

describe('clampZoomLevel', () => {
  it('keeps values inside the allowed range', () => {
    expect(clampZoomLevel(0)).toBe(0)
    expect(clampZoomLevel(ZOOM_MIN)).toBe(ZOOM_MIN)
    expect(clampZoomLevel(ZOOM_MAX)).toBe(ZOOM_MAX)
  })

  it('clamps out-of-range values', () => {
    expect(clampZoomLevel(ZOOM_MIN - 1)).toBe(ZOOM_MIN)
    expect(clampZoomLevel(ZOOM_MAX + 1)).toBe(ZOOM_MAX)
  })
})

describe('nextZoomLevel', () => {
  it('resets to 0', () => {
    expect(nextZoomLevel(2, 'resetZoom')).toBe(0)
    expect(nextZoomLevel(-1.5, 'resetZoom')).toBe(0)
  })

  it('steps from the provided current level', () => {
    expect(nextZoomLevel(1, 'zoomIn')).toBe(1 + ZOOM_STEP)
    expect(nextZoomLevel(1, 'zoomOut')).toBe(1 - ZOOM_STEP)
  })

  it('does not move past the bounds', () => {
    expect(nextZoomLevel(ZOOM_MAX, 'zoomIn')).toBe(ZOOM_MAX)
    expect(nextZoomLevel(ZOOM_MIN, 'zoomOut')).toBe(ZOOM_MIN)
  })
})
