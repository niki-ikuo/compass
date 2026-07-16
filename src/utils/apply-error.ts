export type ApplyErrorTone = 'warning' | 'error'
export type AgentStepTone = 'warning' | 'cancelled' | 'failed'

const PATCH_MISMATCH_PATTERNS = [
  /Failed to locate hunk context/i,
  /Hunk context matched \d+ locations/i
]

const VERIFY_UNAVAILABLE_PATTERNS = [/no verify commands available/i]

const USER_REJECTED_PATTERNS = [
  /^User rejected(?: exec)?$/i,
  /User rejected the proposed workspace actions/i,
  /User rejected this shell command/i,
  /User rejected the proposed file changes/i
]

const TRUNCATED_PROPOSE_ACTIONS_PATTERNS = [
  /proposeActions.*truncated/i,
  /arguments were truncated/i,
  /引数が途中で切れ/
]

const PROPOSE_ACTIONS_FORMAT_PATTERNS = [
  /Invalid proposeActions format/i,
  /proposeActions の形式ミス/
]

const EXEC_BLOCKED_PATTERNS = [/Choose a safer command/i]

const ABORTED_PATTERNS = [/^aborted$/i, /^（中断されました）$/, /^\(Stopped\)$/]

function stepText(step: { summary?: string; observation?: string }): string {
  return [step.summary, step.observation].filter(Boolean).join('\n')
}

export function getApplyErrorTone(message: string | null | undefined): ApplyErrorTone {
  if (!message) return 'error'
  return PATCH_MISMATCH_PATTERNS.some((pattern) => pattern.test(message)) ? 'warning' : 'error'
}

export function isApplyWarning(message: string | null | undefined): boolean {
  return getApplyErrorTone(message) === 'warning'
}

export function formatActionPreviewError(
  message: string,
  t: (key: 'chat.patchMismatchError' | 'chat.fileOpError', params: { message: string }) => string
): string {
  return isApplyWarning(message)
    ? t('chat.patchMismatchError', { message })
    : t('chat.fileOpError', { message })
}

export function isVerifyUnavailable(summary: string | null | undefined): boolean {
  if (!summary) return false
  return VERIFY_UNAVAILABLE_PATTERNS.some((pattern) => pattern.test(summary))
}

function isUserRejected(text: string): boolean {
  return USER_REJECTED_PATTERNS.some((pattern) => pattern.test(text.trim()))
}

function isTruncatedProposeActions(text: string): boolean {
  return TRUNCATED_PROPOSE_ACTIONS_PATTERNS.some((pattern) => pattern.test(text))
}

function isProposeActionsFormatError(text: string): boolean {
  return PROPOSE_ACTIONS_FORMAT_PATTERNS.some((pattern) => pattern.test(text))
}

function isExecBlocked(step: { name: string }, text: string): boolean {
  return step.name === 'exec' && EXEC_BLOCKED_PATTERNS.some((pattern) => pattern.test(text))
}

function isAbortedStep(step: { status?: string; summary?: string }): boolean {
  if (step.status !== 'error') return false
  const summary = step.summary?.trim() ?? ''
  return ABORTED_PATTERNS.some((pattern) => pattern.test(summary))
}

export function getAgentStepTone(step: {
  name: string
  ok?: boolean
  summary?: string
  observation?: string
  status?: string
}): AgentStepTone | null {
  const text = stepText(step)

  if (step.name === 'verify' && isVerifyUnavailable(step.summary)) {
    return 'warning'
  }

  if (isAbortedStep(step)) {
    return 'cancelled'
  }

  if (step.ok === false) {
    if (isUserRejected(text) && !/apply failed/i.test(text)) {
      return 'cancelled'
    }
    if (
      step.name === 'proposeActions' &&
      (isTruncatedProposeActions(text) || isProposeActionsFormatError(text))
    ) {
      return 'warning'
    }
    if (getApplyErrorTone(text) === 'warning') {
      return 'warning'
    }
    if (isExecBlocked(step, text)) {
      return 'warning'
    }
    return 'failed'
  }

  return null
}

export type AgentStepStatusLabelKey =
  | 'chat.agentToolOk'
  | 'chat.agentToolError'
  | 'chat.agentToolWarning'
  | 'chat.agentToolSkipped'
  | 'chat.agentToolCancelled'
  | 'chat.agentToolBlocked'
  | 'chat.agentWaitingApproval'
  | 'chat.agentContinueStep'
  | 'chat.agentToolRunning'

export function getAgentStepStatusLabelKey(step: {
  name: string
  ok?: boolean
  summary?: string
  observation?: string
  status?: string
}): AgentStepStatusLabelKey {
  if (step.status === 'waiting_approval') return 'chat.agentWaitingApproval'
  if (step.status === 'waiting_continue') return 'chat.agentContinueStep'
  if (step.status === 'running') return 'chat.agentToolRunning'

  const tone = getAgentStepTone(step)
  if (tone === 'cancelled') return 'chat.agentToolCancelled'
  if (tone === 'warning') {
    if (step.name === 'verify') return 'chat.agentToolSkipped'
    if (step.name === 'exec') return 'chat.agentToolBlocked'
    return 'chat.agentToolWarning'
  }
  if (step.ok === false || step.status === 'error') return 'chat.agentToolError'
  return 'chat.agentToolOk'
}
