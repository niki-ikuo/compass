import { useState } from 'react'
import type { AgentToolStep } from '@/types'
import { getAgentStepStatusLabelKey, getAgentStepTone } from '@/utils/apply-error'
import {
  formatAgentToolLabel,
  filterTimelineAgentSteps,
  groupConsecutiveAgentSteps,
  isActiveAgentStep,
  latestAgentStep,
  partitionLiveAgentSteps,
  shouldShowHistoryAccordion,
  summarizeSettledAgentSteps,
  type AgentStepGroup,
  type QuietStepSummaryCounts
} from '@/utils/agent-step-display'
import { useI18n } from '@/i18n'
import type { MessageKey } from '@/i18n'
import { AnimatedStatus } from './AnimatedEllipsis'
import { useRunPeekAccordion } from '@/hooks/use-run-peek-accordion'

function formatArgs(args: Record<string, unknown>): string {
  const entries = Object.entries(args)
  if (entries.length === 0) return ''
  try {
    return JSON.stringify(args, null, 2)
  } catch {
    return entries
      .map(([key, value]) => `${key}=${typeof value === 'string' ? value : String(value)}`)
      .join('\n')
  }
}

function toolIcon(name: string): string {
  switch (name) {
    case 'listDir':
      return '📁'
    case 'readFile':
      return '📄'
    case 'search':
    case 'searchMeaning':
      return '🔎'
    case 'exec':
      return '⌨️'
    case 'verify':
      return '✅'
    case 'profileData':
      return '📊'
    case 'queryData':
      return '🧮'
    case 'proposeActions':
      return '✏️'
    case 'updateTodo':
      return '☑️'
    case 'checkpoint':
      return '📌'
    case 'remember':
      return '🧠'
    default:
      return '🔧'
  }
}

function groupStatusLabel(
  group: AgentStepGroup,
  t: (key: ReturnType<typeof getAgentStepStatusLabelKey>) => string
): string {
  if (group.steps.length === 1) {
    return t(getAgentStepStatusLabelKey(group.steps[0]))
  }
  const labels = new Set(group.steps.map((step) => t(getAgentStepStatusLabelKey(step))))
  if (labels.size === 1) return [...labels][0]
  return t(getAgentStepStatusLabelKey(group.steps[group.steps.length - 1]))
}

function groupToneClass(group: AgentStepGroup): string {
  for (const step of group.steps) {
    const tone = getAgentStepTone(step)
    if (tone) return ` agent-step-${tone}`
  }
  return ''
}

function groupStatusClass(group: AgentStepGroup): string {
  if (group.steps.some((s) => s.status === 'error')) return 'error'
  if (group.steps.some((s) => s.status === 'running')) return 'running'
  if (group.steps.some((s) => s.status === 'waiting_approval')) return 'waiting_approval'
  if (group.steps.some((s) => s.status === 'waiting_continue')) return 'waiting_continue'
  return group.steps[group.steps.length - 1]?.status ?? 'done'
}

function AgentStepStatusMeta({
  step,
  animate
}: {
  step: AgentToolStep
  animate: boolean
}) {
  const { t } = useI18n()
  const label = t(getAgentStepStatusLabelKey(step))
  return (
    <span className="chat-code-meta">
      {animate ? <AnimatedStatus label={label} /> : label}
    </span>
  )
}

function AgentStepAccordion({
  step,
  animateStatus = false
}: {
  step: AgentToolStep
  animateStatus?: boolean
}) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const stepTone = getAgentStepTone(step)

  const argsText = formatArgs(step.args)
  const bodyParts = [
    argsText ? argsText : null,
    step.summary && step.status !== 'waiting_approval' ? step.summary : null
  ].filter(Boolean) as string[]
  const body = bodyParts.join('\n\n')
  const canExpand = body.length > 0
  const animate =
    animateStatus &&
    (step.status === 'running' ||
      step.status === 'waiting_approval' ||
      step.status === 'waiting_continue')

  const header = (
    <>
      <span className="chat-code-chevron">{canExpand ? (open ? '▼' : '▶') : '·'}</span>
      <span className="chat-code-icon" aria-hidden="true">
        {toolIcon(step.name)}
      </span>
      <span className="chat-code-label">{formatAgentToolLabel(step.name, t)}</span>
      <AgentStepStatusMeta step={step} animate={animate} />
    </>
  )

  return (
    <div
      className={`chat-code-block agent-step-block agent-step-${step.status}${
        stepTone ? ` agent-step-${stepTone}` : ''
      }`}
    >
      {canExpand ? (
        <button
          type="button"
          className="chat-code-header"
          onClick={() => setOpen((prev) => !prev)}
          aria-expanded={open}
        >
          {header}
        </button>
      ) : (
        <div className="chat-code-header static">{header}</div>
      )}
      {open && canExpand ? <pre className="chat-code-body">{body}</pre> : null}
    </div>
  )
}

function AgentStepGroupAccordion({
  group,
  runActive = false
}: {
  group: AgentStepGroup
  runActive?: boolean
}) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const label = `${formatAgentToolLabel(group.name, t)} ×${group.steps.length}`
  const statusLabel = groupStatusLabel(group, t)
  const toneClass = groupToneClass(group)
  const statusClass = groupStatusClass(group)

  return (
    <div className={`chat-code-block agent-step-block agent-step-${statusClass}${toneClass}`}>
      <button
        type="button"
        className="chat-code-header"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
      >
        <span className="chat-code-chevron">{open ? '▼' : '▶'}</span>
        <span className="chat-code-icon" aria-hidden="true">
          {toolIcon(group.name)}
        </span>
        <span className="chat-code-label">{label}</span>
        <span className="chat-code-meta">{statusLabel}</span>
      </button>
      {open ? (
        <div className="agent-step-group-body">
          {group.steps.map((step) => (
            <AgentStepAccordion
              key={step.id}
              step={step}
              animateStatus={runActive && isActiveAgentStep(step)}
            />
          ))}
        </div>
      ) : null}
    </div>
  )
}

function AgentStepGroupBlock({
  group,
  runActive = false
}: {
  group: AgentStepGroup
  runActive?: boolean
}) {
  if (group.steps.length === 1) {
    const step = group.steps[0]
    return (
      <AgentStepAccordion
        step={step}
        animateStatus={runActive && isActiveAgentStep(step)}
      />
    )
  }
  return <AgentStepGroupAccordion group={group} runActive={runActive} />
}

function formatQuietSummaryMeta(
  counts: QuietStepSummaryCounts,
  t: (key: MessageKey, params?: { count: number }) => string
): string {
  const parts: string[] = []
  if (counts.ok > 0) parts.push(t('chat.agentStepsSummaryOk', { count: counts.ok }))
  if (counts.skipped > 0) parts.push(t('chat.agentStepsSummarySkipped', { count: counts.skipped }))
  if (counts.warning > 0) parts.push(t('chat.agentStepsSummaryWarning', { count: counts.warning }))
  if (counts.error > 0) parts.push(t('chat.agentStepsSummaryError', { count: counts.error }))
  if (counts.cancelled > 0) {
    parts.push(t('chat.agentStepsSummaryCancelled', { count: counts.cancelled }))
  }
  return parts.join(' · ')
}

function ToolsHistoryAccordion({
  steps,
  live,
  runActive
}: {
  steps: AgentToolStep[]
  live: AgentToolStep[]
  runActive: boolean
}) {
  const { t } = useI18n()
  const { mode, toggle } = useRunPeekAccordion(runActive)
  const groups = groupConsecutiveAgentSteps(steps)
  const counts = summarizeSettledAgentSteps(steps)
  const summaryLabel = t('chat.agentStepsCollapsed', { count: counts.total })
  const meta =
    counts.total === 0 ? '' : formatQuietSummaryMeta(counts, t) || t('chat.agentToolOk')
  const latest = latestAgentStep(steps, live)
  const toneClass =
    counts.error > 0
      ? ' agent-step-failed'
      : counts.warning > 0
        ? ' agent-step-warning'
        : counts.cancelled > 0
          ? ' agent-step-cancelled'
          : ''
  const chevron = mode === 'open' || mode === 'peek' ? '▼' : '▶'

  return (
    <div
      className={`chat-code-block agent-step-block agent-step-quiet-summary agent-step-settled-summary${toneClass}${
        mode === 'peek' ? ' is-peek' : ''
      }`}
    >
      <button
        type="button"
        className="chat-code-header"
        onClick={toggle}
        aria-expanded={mode !== 'closed'}
      >
        <span className="chat-code-chevron">{chevron}</span>
        <span className="chat-code-icon" aria-hidden="true">
          🔧
        </span>
        <span className="chat-code-label">{summaryLabel}</span>
        {meta ? <span className="chat-code-meta">{meta}</span> : null}
      </button>
      {mode !== 'closed' ? (
        <div className={`agent-step-group-body${mode === 'peek' ? ' is-peek' : ''}`}>
          {mode === 'open'
            ? groups.map((group) => (
                <AgentStepGroupBlock key={group.id} group={group} runActive={runActive} />
              ))
            : latest
              ? (
                  <AgentStepAccordion
                    step={latest}
                    animateStatus={runActive && isActiveAgentStep(latest)}
                  />
                )
              : null}
        </div>
      ) : null}
    </div>
  )
}

interface AgentStepTimelineProps {
  steps: AgentToolStep[]
  /** When true, hide updateTodo/checkpoint rows (they are shown in AgentPlanPanel). */
  planPanelVisible?: boolean
  /** Live run: peek the latest tool inside the accordion; settled runs stay collapsed. */
  runActive?: boolean
}

export function AgentStepTimeline({
  steps,
  planPanelVisible = false,
  runActive = false
}: AgentStepTimelineProps) {
  const { t } = useI18n()
  const visibleSteps = filterTimelineAgentSteps(steps, { planPanelVisible })
  const { live } = partitionLiveAgentSteps(visibleSteps)
  if (!shouldShowHistoryAccordion(visibleSteps.length, runActive)) return null

  return (
    <div className="agent-step-timeline" aria-label={t('chat.agentSteps')}>
      <ToolsHistoryAccordion steps={visibleSteps} live={live} runActive={runActive} />
    </div>
  )
}
