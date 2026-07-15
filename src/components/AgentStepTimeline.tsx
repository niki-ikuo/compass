import { useState } from 'react'
import type { AgentToolStep } from '@/types'
import { useI18n } from '@/i18n'

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
    case 'proposeActions':
      return '✏️'
    default:
      return '🔧'
  }
}

function AgentStepAccordion({ step }: { step: AgentToolStep }) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)

  const statusLabel =
    step.status === 'waiting_approval'
      ? t('chat.agentWaitingApproval')
      : step.status === 'waiting_continue'
        ? t('chat.agentContinueStep')
        : step.status === 'running'
          ? t('chat.agentToolRunning')
          : step.ok === false || step.status === 'error'
            ? t('chat.agentToolError')
            : t('chat.agentToolOk')

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
      <span className="chat-code-label">{step.name}</span>
      <span className="chat-code-meta">{statusLabel}</span>
    </>
  )

  return (
    <div
      className={`chat-code-block agent-step-block agent-step-${step.status}${
        step.ok === false ? ' agent-step-failed' : ''
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

interface AgentStepTimelineProps {
  steps: AgentToolStep[]
}

export function AgentStepTimeline({ steps }: AgentStepTimelineProps) {
  const { t } = useI18n()
  if (steps.length === 0) return null

  return (
    <div className="agent-step-timeline" aria-label={t('chat.agentSteps')}>
      {steps.map((step) => (
        <AgentStepAccordion key={step.id} step={step} />
      ))}
    </div>
  )
}
