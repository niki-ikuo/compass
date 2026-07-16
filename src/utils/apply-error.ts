export type ApplyErrorTone = 'warning' | 'error'

const PATCH_MISMATCH_PATTERNS = [
  /Failed to locate hunk context/i,
  /Hunk context matched \d+ locations/i
]

export function getApplyErrorTone(message: string | null | undefined): ApplyErrorTone {
  if (!message) return 'error'
  return PATCH_MISMATCH_PATTERNS.some((pattern) => pattern.test(message)) ? 'warning' : 'error'
}

export function isApplyWarning(message: string | null | undefined): boolean {
  return getApplyErrorTone(message) === 'warning'
}
