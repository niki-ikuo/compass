/**
 * Focus an element after layout / dialog teardown.
 * Electron often drops keyboard focus; retry briefly like SearchPanel / ChatPanel.
 */
export function focusWithRetry(
  getTarget: () => HTMLElement | null | undefined,
  options?: { select?: boolean }
): void {
  const focus = (): void => {
    const el = getTarget()
    if (!el) return
    el.focus()
    if (options?.select && 'select' in el && typeof el.select === 'function') {
      el.select()
    }
  }

  requestAnimationFrame(() => {
    focus()
    window.setTimeout(focus, 0)
    window.setTimeout(focus, 50)
  })
}
