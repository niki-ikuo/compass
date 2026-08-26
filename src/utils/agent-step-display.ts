import type { AgentToolName, AgentToolStep } from '@/types'
import { getAgentStepTone } from '@/utils/apply-error'

/** Collapse quiet tool rows once this many quiet steps exist in a run. */
export const QUIET_STEP_COLLAPSE_THRESHOLD = 3

export type AgentToolLabelKey =
  | 'chat.agentToolName.readFile'
  | 'chat.agentToolName.listDir'
  | 'chat.agentToolName.search'
  | 'chat.agentToolName.searchMeaning'
  | 'chat.agentToolName.globFiles'
  | 'chat.agentToolName.strReplace'
  | 'chat.agentToolName.writeFile'
  | 'chat.agentToolName.deleteFile'
  | 'chat.agentToolName.deleteDir'
  | 'chat.agentToolName.mkdir'
  | 'chat.agentToolName.replaceSection'
  | 'chat.agentToolName.proposeActions'
  | 'chat.agentToolName.readLints'
  | 'chat.agentToolName.gitStatus'
  | 'chat.agentToolName.gitDiff'
  | 'chat.agentToolName.webSearch'
  | 'chat.agentToolName.fetchUrl'
  | 'chat.agentToolName.exec'
  | 'chat.agentToolName.verify'
  | 'chat.agentToolName.profileData'
  | 'chat.agentToolName.queryData'
  | 'chat.agentToolName.updateTodo'
  | 'chat.agentToolName.checkpoint'
  | 'chat.agentToolName.remember'

const AGENT_TOOL_LABEL_KEYS: Record<AgentToolName, AgentToolLabelKey> = {
  readFile: 'chat.agentToolName.readFile',
  listDir: 'chat.agentToolName.listDir',
  search: 'chat.agentToolName.search',
  searchMeaning: 'chat.agentToolName.searchMeaning',
  globFiles: 'chat.agentToolName.globFiles',
  strReplace: 'chat.agentToolName.strReplace',
  writeFile: 'chat.agentToolName.writeFile',
  deleteFile: 'chat.agentToolName.deleteFile',
  deleteDir: 'chat.agentToolName.deleteDir',
  mkdir: 'chat.agentToolName.mkdir',
  replaceSection: 'chat.agentToolName.replaceSection',
  proposeActions: 'chat.agentToolName.proposeActions',
  readLints: 'chat.agentToolName.readLints',
  gitStatus: 'chat.agentToolName.gitStatus',
  gitDiff: 'chat.agentToolName.gitDiff',
  webSearch: 'chat.agentToolName.webSearch',
  fetchUrl: 'chat.agentToolName.fetchUrl',
  exec: 'chat.agentToolName.exec',
  verify: 'chat.agentToolName.verify',
  profileData: 'chat.agentToolName.profileData',
  queryData: 'chat.agentToolName.queryData',
  updateTodo: 'chat.agentToolName.updateTodo',
  checkpoint: 'chat.agentToolName.checkpoint',
  remember: 'chat.agentToolName.remember'
}

/** Map internal tool ids to i18n keys; unknown names fall back to the raw id. */
export function getAgentToolLabelKey(name: string): AgentToolLabelKey | null {
  return (AGENT_TOOL_LABEL_KEYS as Record<string, AgentToolLabelKey | undefined>)[name] ?? null
}

export function formatAgentToolLabel(
  name: string,
  t: (key: AgentToolLabelKey) => string
): string {
  const key = getAgentToolLabelKey(name)
  return key ? t(key) : name
}

export function isQuietAgentStep(step: AgentToolStep): boolean {
  if (
    step.status === 'running' ||
    step.status === 'waiting_approval' ||
    step.status === 'waiting_continue'
  ) {
    return false
  }
  if (
    step.name === 'proposeActions' ||
    step.name === 'strReplace' ||
    step.name === 'writeFile' ||
    step.name === 'deleteFile' ||
    step.name === 'deleteDir' ||
    step.name === 'mkdir' ||
    step.name === 'replaceSection'
  ) {
    return false
  }
  if (step.status === 'error' || step.ok === false) return false

  const tone = getAgentStepTone(step)
  if (tone === 'failed' || tone === 'cancelled') return false
  // Blocked exec should stay visible; skipped verify can fold into the summary.
  if (tone === 'warning' && step.name === 'exec') return false

  return true
}

/**
 * updateTodo / checkpoint are mirrored by AgentPlanPanel when it is visible.
 * Only hide them from the tool timeline in that case — otherwise the user sees
 * neither the plan nor "タスクを更新", which feels like the plan never appears.
 * Failures stay visible so the user can see what went wrong.
 */
export function isPlanPanelMirroredStep(
  step: AgentToolStep,
  options?: { planPanelVisible?: boolean }
): boolean {
  if (step.name !== 'updateTodo' && step.name !== 'checkpoint') return false
  if (step.status === 'error' || step.ok === false) return false
  // Keep the timeline row until the plan panel actually has something to show.
  if (options?.planPanelVisible === false) return false
  return true
}

/** Steps that should appear in AgentStepTimeline (plan panel mirrors are omitted). */
export function filterTimelineAgentSteps(
  steps: AgentToolStep[],
  options?: { planPanelVisible?: boolean }
): AgentToolStep[] {
  return steps.filter((step) => !isPlanPanelMirroredStep(step, options))
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

export function partitionLiveAgentSteps(steps: AgentToolStep[]): {
  settled: AgentToolStep[]
  live: AgentToolStep[]
} {
  const settled: AgentToolStep[] = []
  const live: AgentToolStep[] = []
  for (const step of steps) {
    if (isActiveAgentStep(step)) live.push(step)
    else settled.push(step)
  }
  return { settled, live }
}

/** Show the tools / file-update history accordion once there is at least one item. */
export function shouldShowHistoryAccordion(itemCount: number, _runActive?: boolean): boolean {
  return itemCount > 0
}

/** The step currently in progress, or the last completed step. */
export function latestAgentStep(
  steps: AgentToolStep[],
  live: AgentToolStep[]
): AgentToolStep | undefined {
  if (live.length > 0) return live[live.length - 1]
  return steps[steps.length - 1]
}

/** Fold the whole timeline into one accordion after the run has settled. */
export function shouldCollapseSettledAgentSteps(
  steps: AgentToolStep[],
  runActive: boolean
): boolean {
  if (runActive) return false
  if (steps.some(isActiveAgentStep)) return false
  return shouldShowHistoryAccordion(steps.length, false)
}

export type QuietStepSummaryCounts = {
  total: number
  ok: number
  skipped: number
  warning: number
  error: number
  cancelled: number
}

function countStepSummary(steps: AgentToolStep[]): QuietStepSummaryCounts {
  let ok = 0
  let skipped = 0
  let warning = 0
  let error = 0
  let cancelled = 0

  for (const step of steps) {
    const tone = getAgentStepTone(step)
    if (tone === 'cancelled') {
      cancelled += 1
      continue
    }
    if (tone === 'failed' || step.status === 'error' || step.ok === false) {
      error += 1
      continue
    }
    if (tone === 'warning') {
      if (step.name === 'verify') skipped += 1
      else warning += 1
      continue
    }
    ok += 1
  }

  return { total: steps.length, ok, skipped, warning, error, cancelled }
}

export function summarizeQuietSteps(steps: AgentToolStep[]): QuietStepSummaryCounts {
  return countStepSummary(steps)
}

export function summarizeSettledAgentSteps(steps: AgentToolStep[]): QuietStepSummaryCounts {
  return countStepSummary(steps)
}
