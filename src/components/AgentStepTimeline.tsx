import type { AgentToolStep } from '@/types'
import { useI18n } from '@/i18n'

function formatArgs(args: Record<string, unknown>): string {
  const entries = Object.entries(args)
  if (entries.length === 0) return ''
  return entries
    .map(([key, value]) => `${key}=${typeof value === 'string' ? value : String(value)}`)
    .join(', ')
}

interface AgentStepTimelineProps {
  steps: AgentToolStep[]
}

export function AgentStepTimeline({ steps }: AgentStepTimelineProps) {
  const { t } = useI18n()
  if (steps.length === 0) return null

  return (
    <div className="agent-step-timeline" aria-label={t('chat.agentSteps')}>
      {steps.map((step) => {
        const statusLabel =
          step.status === 'running'
            ? t('chat.agentToolRunning')
            : step.ok === false || step.status === 'error'
              ? t('chat.agentToolError')
              : t('chat.agentToolOk')
        const argsText = formatArgs(step.args)

        return (
          <div
            key={step.id}
            className={`agent-step agent-step-${step.status}${
              step.ok === false ? ' agent-step-failed' : ''
            }`}
          >
            <div className="agent-step-header">
              <span className="agent-step-name">{step.name}</span>
              <span className="agent-step-status">{statusLabel}</span>
            </div>
            {argsText ? <div className="agent-step-args">{argsText}</div> : null}
            {step.summary ? <div className="agent-step-summary">{step.summary}</div> : null}
          </div>
        )
      })}
    </div>
  )
}
