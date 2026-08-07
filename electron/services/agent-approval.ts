export type ApprovalDecision = { approved: boolean; detail?: string }
export type ContinueDecision = { continue: boolean }

const pendingApprovals = new Map<
  string,
  {
    senderId: number
    resolve: (decision: ApprovalDecision) => void
  }
>()

const pendingContinues = new Map<
  string,
  {
    senderId: number
    resolve: (decision: ContinueDecision) => void
  }
>()

/** Renderer が preview / exec 承認・却下後に呼ぶ（送信元 webContents と一致必須） */
export function resolveAgentApprovalForSender(
  senderId: number,
  payload: {
    id: string
    approved: boolean
    detail?: string
  }
): boolean {
  const pending = pendingApprovals.get(payload.id)
  if (!pending) return false
  if (pending.senderId !== senderId) return false
  pendingApprovals.delete(payload.id)
  pending.resolve({ approved: payload.approved, detail: payload.detail })
  return true
}

/** @deprecated Prefer resolveAgentApprovalForSender — tests only */
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

export function resolveAgentContinueForSender(
  senderId: number,
  payload: { id: string; continue: boolean }
): boolean {
  const pending = pendingContinues.get(payload.id)
  if (!pending) return false
  if (pending.senderId !== senderId) return false
  pendingContinues.delete(payload.id)
  pending.resolve({ continue: payload.continue })
  return true
}

/** @deprecated Prefer resolveAgentContinueForSender — tests only */
export function resolveAgentContinue(payload: { id: string; continue: boolean }): boolean {
  const pending = pendingContinues.get(payload.id)
  if (!pending) return false
  pendingContinues.delete(payload.id)
  pending.resolve({ continue: payload.continue })
  return true
}

export function waitForApproval(
  id: string,
  signal: AbortSignal,
  senderId: number
): Promise<ApprovalDecision> {
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
      senderId,
      resolve: (decision) => {
        signal.removeEventListener('abort', onAbort)
        pendingApprovals.delete(id)
        resolve(decision)
      }
    })
  })
}

export function waitForContinue(
  id: string,
  signal: AbortSignal,
  senderId: number
): Promise<ContinueDecision> {
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
      senderId,
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
