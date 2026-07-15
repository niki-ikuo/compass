export type ApprovalDecision = { approved: boolean; detail?: string }
export type ContinueDecision = { continue: boolean }

const pendingApprovals = new Map<
  string,
  {
    resolve: (decision: ApprovalDecision) => void
  }
>()

const pendingContinues = new Map<
  string,
  {
    resolve: (decision: ContinueDecision) => void
  }
>()

/** Renderer が preview / exec 承認・却下後に呼ぶ */
export function resolveAgentApproval(payload: {
  id: string
  approved: boolean
  detail?: string
}): boolean {
  const pending = pendingApprovals.get(payload.id)
  if (!pending) return false
  pendingApprovals.delete(payload.id)
  pending.resolve({ approved: payload.approved, detail: payload.detail })
  return true
}

/** Renderer がターン上限の続行/停止後に呼ぶ */
export function resolveAgentContinue(payload: { id: string; continue: boolean }): boolean {
  const pending = pendingContinues.get(payload.id)
  if (!pending) return false
  pendingContinues.delete(payload.id)
  pending.resolve({ continue: payload.continue })
  return true
}

export function waitForApproval(id: string, signal: AbortSignal): Promise<ApprovalDecision> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException('Aborted', 'AbortError'))
      return
    }

    const onAbort = (): void => {
      pendingApprovals.delete(id)
      signal.removeEventListener('abort', onAbort)
      reject(new DOMException('Aborted', 'AbortError'))
    }

    signal.addEventListener('abort', onAbort)
    pendingApprovals.set(id, {
      resolve: (decision) => {
        signal.removeEventListener('abort', onAbort)
        pendingApprovals.delete(id)
        resolve(decision)
      }
    })
  })
}

export function waitForContinue(id: string, signal: AbortSignal): Promise<ContinueDecision> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException('Aborted', 'AbortError'))
      return
    }

    const onAbort = (): void => {
      pendingContinues.delete(id)
      signal.removeEventListener('abort', onAbort)
      reject(new DOMException('Aborted', 'AbortError'))
    }

    signal.addEventListener('abort', onAbort)
    pendingContinues.set(id, {
      resolve: (decision) => {
        signal.removeEventListener('abort', onAbort)
        pendingContinues.delete(id)
        resolve(decision)
      }
    })
  })
}

/** テスト用に pending を空にする */
export function resetAgentApprovalStateForTests(): void {
  pendingApprovals.clear()
  pendingContinues.clear()
}
