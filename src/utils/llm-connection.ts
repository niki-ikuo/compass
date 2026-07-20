import { useAppStore } from '@/stores/app-store'
import type { LlmConnectionState } from '@/types'

let testSeq = 0

export async function refreshLlmConnection(): Promise<LlmConnectionState> {
  const seq = ++testSeq
  const setLlmConnection = useAppStore.getState().setLlmConnection

  setLlmConnection({
    status: 'checking',
    error: null,
    code: null,
    method: null
  })
  void window.compass.menu.setAiHelpVisible(false)

  try {
    const result = await window.compass.ai.testConnection()
    if (seq !== testSeq) {
      return useAppStore.getState().llmConnection
    }

    const next: LlmConnectionState = result.ok
      ? {
          status: 'connected',
          error: null,
          code: null,
          method: result.method ?? null
        }
      : {
          status: result.status === 'incomplete' ? 'incomplete' : 'error',
          error: result.error ?? null,
          code: result.code ?? null,
          method: null
        }
    setLlmConnection(next)
    void window.compass.menu.setAiHelpVisible(next.status === 'connected')
    return next
  } catch (err) {
    if (seq !== testSeq) {
      return useAppStore.getState().llmConnection
    }
    const next: LlmConnectionState = {
      status: 'error',
      error: err instanceof Error ? err.message : 'Connection test failed',
      code: 'unknown',
      method: null
    }
    setLlmConnection(next)
    void window.compass.menu.setAiHelpVisible(false)
    return next
  }
}
