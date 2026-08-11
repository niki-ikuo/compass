import type { AgentToolStep, AgentToolStepStatus } from '@/types'

/** Patch a single step by id; other steps are unchanged. */
export function updateAgentStepById(
  steps: AgentToolStep[],
  id: string,
  patch: Partial<Omit<AgentToolStep, 'id'>>
): AgentToolStep[] {
  return steps.map((step) => (step.id === id ? { ...step, ...patch } : step))
}

const IN_FLIGHT_STATUSES: ReadonlySet<AgentToolStepStatus> = new Set([
  'running',
  'waiting_approval',
  'waiting_continue'
])

/**
 * Mark in-flight steps as error.
 * When `preferExistingSummary` is true (abort), keep a non-empty step.summary.
 */
export function failInFlightAgentSteps(
  steps: AgentToolStep[],
  summary: string,
  options?: { preferExistingSummary?: boolean }
): AgentToolStep[] {
  const preferExisting = options?.preferExistingSummary === true
  return steps.map((step) =>
    IN_FLIGHT_STATUSES.has(step.status)
      ? {
          ...step,
          status: 'error' as const,
          ok: false,
          summary: preferExisting ? step.summary || summary : summary
        }
      : step
  )
}
