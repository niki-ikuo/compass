import type { AgentToolStep } from '@/types'
import { getAgentStepTone } from '@/utils/apply-error'

/** Collapse quiet tool rows once this many quiet steps exist in a run. */
export const QUIET_STEP_COLLAPSE_THRESHOLD = 3

export function isQuietAgentStep(step: AgentToolStep): boolean {
  if (
    step.status === 'running' ||
    step.status === 'waiting_approval' ||
    step.status === 'waiting_continue'
  ) {
    return false
  }
  if (step.name === 'proposeActions') return false
  if (step.status === 'error' || step.ok === false) return false

  const tone = getAgentStepTone(step)
  if (tone === 'failed' || tone === 'cancelled') return false
  // Blocked exec should stay visible; skipped verify can fold into the summary.
  if (tone === 'warning' && step.name === 'exec') return false

  return true
}

export function isActiveAgentStep(step: AgentToolStep): boolean {
  return (
    step.status === 'running' ||
    step.status === 'waiting_approval' ||
    step.status === 'waiting_continue'
  )
}

export type AgentStepGroup = {
  id: string
  name: string
  steps: AgentToolStep[]
}

/** Merge consecutive steps that share the same tool name. */
export function groupConsecutiveAgentSteps(steps: AgentToolStep[]): AgentStepGroup[] {
  const groups: AgentStepGroup[] = []
  for (const step of steps) {
    const last = groups[groups.length - 1]
    if (last && last.name === step.name) {
      last.steps.push(step)
    } else {
      groups.push({ id: step.id, name: step.name, steps: [step] })
    }
  }
  return groups
}

export type QuietStepsSegment = {
  kind: 'quiet'
  id: string
  steps: AgentToolStep[]
}

export type ProminentStepSegment = {
  kind: 'prominent'
  step: AgentToolStep
}

export type AgentStepSegment = QuietStepsSegment | ProminentStepSegment

/** Keep chronological order: fold quiet runs, leave prominent steps as their own segments. */
export function segmentAgentSteps(steps: AgentToolStep[]): AgentStepSegment[] {
  const segments: AgentStepSegment[] = []
  let quietBuffer: AgentToolStep[] = []

  const flushQuiet = () => {
    if (quietBuffer.length === 0) return
    segments.push({
      kind: 'quiet',
      id: quietBuffer[0].id,
      steps: quietBuffer
    })
    quietBuffer = []
  }

  for (const step of steps) {
    if (isQuietAgentStep(step)) {
      quietBuffer.push(step)
      continue
    }
    flushQuiet()
    segments.push({ kind: 'prominent', step })
  }
  flushQuiet()
  return segments
}

export function shouldCollapseQuietSteps(steps: AgentToolStep[], hasActiveStep: boolean): boolean {
  if (hasActiveStep) return false
  return steps.length >= QUIET_STEP_COLLAPSE_THRESHOLD
}

export type QuietStepSummaryCounts = {
  total: number
  ok: number
  skipped: number
  warning: number
}

export function summarizeQuietSteps(steps: AgentToolStep[]): QuietStepSummaryCounts {
  let ok = 0
  let skipped = 0
  let warning = 0

  for (const step of steps) {
    const tone = getAgentStepTone(step)
    if (tone === 'warning') {
      if (step.name === 'verify') skipped += 1
      else warning += 1
      continue
    }
    ok += 1
  }

  return { total: steps.length, ok, skipped, warning }
}
