export type ApplyErrorTone = 'warning' | 'error'
export type AgentStepTone = 'warning' | 'failed'

const PATCH_MISMATCH_PATTERNS = [
  /Failed to locate hunk context/i,
  /Hunk context matched \d+ locations/i
]

const VERIFY_UNAVAILABLE_PATTERNS = [/no verify commands available/i]

export function getApplyErrorTone(message: string | null | undefined): ApplyErrorTone {
  if (!message) return 'error'
  return PATCH_MISMATCH_PATTERNS.some((pattern) => pattern.test(message)) ? 'warning' : 'error'
}

export function isApplyWarning(message: string | null | undefined): boolean {
  return getApplyErrorTone(message) === 'warning'
}

export function isVerifyUnavailable(summary: string | null | undefined): boolean {
  if (!summary) return false
  return VERIFY_UNAVAILABLE_PATTERNS.some((pattern) => pattern.test(summary))
}

export function getAgentStepTone(step: {
  name: string
  ok?: boolean
  summary?: string
}): AgentStepTone | null {
  if (step.name === 'verify' && isVerifyUnavailable(step.summary)) {
    return 'warning'
  }
  if (step.ok === false && step.name === 'proposeActions' && getApplyErrorTone(step.summary) === 'warning') {
    return 'warning'
  }
  if (step.ok === false) return 'failed'
  return null
}
