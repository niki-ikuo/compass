import { useEffect, useState } from 'react'
import type { AgentToolStep } from '@/types'
import { getAgentStepStatusLabelKey, getAgentStepTone } from '@/utils/apply-error'
import {
  formatAgentToolLabel,
  groupConsecutiveAgentSteps,
  isActiveAgentStep,
  segmentAgentSteps,
  shouldCollapseQuietSteps,
  summarizeQuietSteps,
  type AgentStepGroup,
  type QuietStepSummaryCounts
} from '@/utils/agent-step-display'
import { useI18n } from '@/i18n'
import type { MessageKey } from '@/i18n'

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

function AgentStepAccordion({ step }: { step: AgentToolStep }) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const stepTone = getAgentStepTone(step)

  const statusLabel = t(getAgentStepStatusLabelKey(step))

  const argsText = formatArgs(step.args)
  const bodyParts = [
    argsText ? argsText : null,
    step.summary && step.status !== 'waiting_approval' ? step.summary : null
  ].filter(Boolean) as string[]
  const body = bodyParts.join('\n\n')
  const canExpand = body.length > 0

  const header = (
    <>
      <span className="chat-code-chevron">{canExpand ? (open ? '▼' : '▶') : '·'}</span>
      <span className="chat-code-icon" aria-hidden="true">
        {toolIcon(step.name)}
      </span>
      <span className="chat-code-label">{formatAgentToolLabel(step.name, t)}</span>
      <span className="chat-code-meta">{statusLabel}</span>
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

function AgentStepGroupAccordion({ group }: { group: AgentStepGroup }) {
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
            <AgentStepAccordion key={step.id} step={step} />
          ))}
        </div>
      ) : null}
    </div>
  )
}

function AgentStepGroupBlock({ group }: { group: AgentStepGroup }) {
  if (group.steps.length === 1) {
    return <AgentStepAccordion step={group.steps[0]} />
  }
  return <AgentStepGroupAccordion group={group} />
}

function formatQuietSummaryMeta(
  counts: QuietStepSummaryCounts,
  t: (key: MessageKey, params?: { count: number }) => string
): string {
  const parts: string[] = []
  if (counts.ok > 0) parts.push(t('chat.agentStepsSummaryOk', { count: counts.ok }))
  if (counts.skipped > 0) parts.push(t('chat.agentStepsSummarySkipped', { count: counts.skipped }))
  if (counts.warning > 0) parts.push(t('chat.agentStepsSummaryWarning', { count: counts.warning }))
  return parts.join(' · ')
}

function QuietStepsSegmentView({ steps }: { steps: AgentToolStep[] }) {
  const { t } = useI18n()
  const hasActive = steps.some(isActiveAgentStep)
  const collapse = shouldCollapseQuietSteps(steps, hasActive)
  const [expanded, setExpanded] = useState(false)
  const groups = groupConsecutiveAgentSteps(steps)
  const firstStepId = steps[0]?.id

  // After a turn finishes, fold quiet noise back into a one-line summary.
  useEffect(() => {
    if (collapse) setExpanded(false)
  }, [collapse, firstStepId])

  if (!collapse) {
    return (
      <div className="agent-step-quiet-list">
        {groups.map((group) => (
          <AgentStepGroupBlock key={group.id} group={group} />
        ))}
      </div>
    )
  }

  const counts = summarizeQuietSteps(steps)
  const summaryLabel = t('chat.agentStepsCollapsed', { count: counts.total })
  const meta = formatQuietSummaryMeta(counts, t) || t('chat.agentToolOk')

  return (
    <div className="chat-code-block agent-step-block agent-step-quiet-summary">
      <button
        type="button"
        className="chat-code-header"
        onClick={() => setExpanded((prev) => !prev)}
        aria-expanded={expanded}
      >
        <span className="chat-code-chevron">{expanded ? '▼' : '▶'}</span>
        <span className="chat-code-icon" aria-hidden="true">
          🔧
        </span>
        <span className="chat-code-label">{summaryLabel}</span>
        <span className="chat-code-meta">{meta}</span>
      </button>
      {expanded ? (
        <div className="agent-step-group-body">
          {groups.map((group) => (
            <AgentStepGroupBlock key={group.id} group={group} />
          ))}
        </div>
      ) : null}
    </div>
  )
}

interface AgentStepTimelineProps {
  steps: AgentToolStep[]
}

export function AgentStepTimeline({ steps }: AgentStepTimelineProps) {
  const { t } = useI18n()
  if (steps.length === 0) return null

  const segments = segmentAgentSteps(steps)

  return (
    <div className="agent-step-timeline" aria-label={t('chat.agentSteps')}>
      {segments.map((segment) =>
        segment.kind === 'quiet' ? (
          <QuietStepsSegmentView key={segment.id} steps={segment.steps} />
        ) : (
          <AgentStepAccordion key={segment.step.id} step={segment.step} />
        )
      )}
    </div>
  )
}
