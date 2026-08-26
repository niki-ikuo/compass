import { useEffect, useState } from 'react'

export type RunPeekAccordionMode = 'closed' | 'peek' | 'open'

/**
 * During an active run (or live preview), the accordion stays slightly open (`peek`).
 * The user can expand it to see everything; when the run ends it closes.
 */
export function useRunPeekAccordion(peekActive: boolean): {
  mode: RunPeekAccordionMode
  toggle: () => void
} {
  const [manualOpen, setManualOpen] = useState(false)

  useEffect(() => {
    if (!peekActive) setManualOpen(false)
  }, [peekActive])

  const mode: RunPeekAccordionMode = manualOpen ? 'open' : peekActive ? 'peek' : 'closed'

  return {
    mode,
    toggle: () => setManualOpen((prev) => !prev)
  }
}
