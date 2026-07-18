import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  resetWheelZoomThrottleForTests,
  resolveWheelZoomAction,
  shouldAcceptWheelZoom
} from './wheel-zoom'

describe('resolveWheelZoomAction', () => {
  it('ignores wheel without Ctrl/Meta', () => {
    expect(
      resolveWheelZoomAction({
        ctrlKey: false,
        metaKey: false,
        shiftKey: false,
        altKey: false,
        deltaY: -100
      })
    ).toBeNull()
  })

  it('ignores when Shift or Alt is held', () => {
    expect(
      resolveWheelZoomAction({
        ctrlKey: true,
        metaKey: false,
        shiftKey: true,
        altKey: false,
        deltaY: -40
      })
    ).toBeNull()
    expect(
      resolveWheelZoomAction({
        ctrlKey: true,
        metaKey: false,
        shiftKey: false,
        altKey: true,
        deltaY: -40
      })
    ).toBeNull()
  })

  it('maps Ctrl + wheel up to zoomIn and Meta + wheel down to zoomOut', () => {
    expect(
      resolveWheelZoomAction({
        ctrlKey: true,
        metaKey: false,
        shiftKey: false,
        altKey: false,
        deltaY: -40
      })
    ).toBe('zoomIn')
    expect(
      resolveWheelZoomAction({
        ctrlKey: false,
        metaKey: true,
        shiftKey: false,
        altKey: false,
        deltaY: 40
      })
    ).toBe('zoomOut')
  })
})

describe('shouldAcceptWheelZoom', () => {
  afterEach(() => {
    resetWheelZoomThrottleForTests()
    vi.restoreAllMocks()
  })

  it('throttles rapid successive wheel zooms', () => {
    expect(shouldAcceptWheelZoom(1_000_000)).toBe(true)
    expect(shouldAcceptWheelZoom(1_000_050)).toBe(false)
    expect(shouldAcceptWheelZoom(1_000_200)).toBe(true)
  })
})
