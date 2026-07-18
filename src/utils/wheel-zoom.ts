const WHEEL_ZOOM_INTERVAL_MS = 120

let lastWheelZoomAt = 0

export type WheelZoomGesture = {
  ctrlKey: boolean
  metaKey: boolean
  shiftKey: boolean
  altKey: boolean
  deltaY: number
}

/** Ctrl/Meta + wheel のときだけ zoomIn / zoomOut を返す。 */
export function resolveWheelZoomAction(
  event: WheelZoomGesture
): 'zoomIn' | 'zoomOut' | null {
  if (!(event.ctrlKey || event.metaKey) || event.shiftKey || event.altKey) {
    return null
  }
  if (event.deltaY === 0) return null
  return event.deltaY < 0 ? 'zoomIn' : 'zoomOut'
}

export function shouldAcceptWheelZoom(now = Date.now()): boolean {
  if (now - lastWheelZoomAt < WHEEL_ZOOM_INTERVAL_MS) return false
  lastWheelZoomAt = now
  return true
}

/** テスト用にスロットル状態をリセットする。 */
export function resetWheelZoomThrottleForTests(): void {
  lastWheelZoomAt = 0
}

/** Ctrl/Meta + wheel をアプリズームへ。Monaco 等より先に capture で掴む。 */
export function handleWheelZoomEvent(event: WheelEvent): boolean {
  const action = resolveWheelZoomAction(event)
  if (!action) return false

  event.preventDefault()
  event.stopImmediatePropagation()

  if (!shouldAcceptWheelZoom()) return true
  void window.compass.shell.view(action)
  return true
}

export function registerWheelZoomListener(): () => void {
  const onWheel = (event: WheelEvent) => {
    handleWheelZoomEvent(event)
  }
  window.addEventListener('wheel', onWheel, { capture: true, passive: false })
  return () => window.removeEventListener('wheel', onWheel, { capture: true })
}
