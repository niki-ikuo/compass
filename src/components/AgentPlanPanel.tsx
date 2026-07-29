import {
  getOpenTodos,
  rebuildPlanFromSteps,
  shouldShowAgentPlanPanel,
  type AgentPlanState,
  type AgentTodoItem
} from '@/utils/agent-plan'
import { useI18n } from '@/i18n'
import type { AgentToolStep } from '@/types'

interface AgentPlanPanelProps {
  /** Cumulative agentSteps from chat start through this message (plan rebuild). */
  steps: AgentToolStep[]
  /** This message's agentSteps only — used to hide settled plans on later turns. */
  messageSteps?: AgentToolStep[]
}

function statusMark(status: AgentTodoItem['status']): string {
  switch (status) {
    case 'done':
      return '✓'
    case 'cancelled':
      return '–'
    case 'in_progress':
      return '…'
    default:
      return '○'
  }
}

export function AgentPlanPanel({ steps, messageSteps = [] }: AgentPlanPanelProps) {
  const { t } = useI18n()
  const plan: AgentPlanState = rebuildPlanFromSteps(steps)
  if (!shouldShowAgentPlanPanel(plan, messageSteps)) return null

  const open = getOpenTodos(plan)
  const done = plan.todos.filter((todo) => todo.status === 'done').length

  return (
    <div className="agent-plan-panel" aria-label={t('chat.agentPlan')}>
      <div className="agent-plan-header">
        <span className="agent-plan-title">{t('chat.agentPlan')}</span>
        {plan.todos.length > 0 && (
          <span className="agent-plan-progress">
            {t('chat.agentPlanProgress', {
              done: String(done),
              open: String(open.length),
              total: String(plan.todos.length)
            })}
          </span>
        )}
      </div>
      {plan.checkpoint?.trim() ? (
        <div className="agent-plan-checkpoint" title={plan.checkpoint}>
          {plan.checkpoint}
        </div>
      ) : null}
      {plan.todos.length > 0 ? (
        <ul className="agent-plan-list">
          {plan.todos.map((todo) => (
            <li
              key={todo.id}
              className={`agent-plan-item status-${todo.status}`}
              title={`${todo.id}: ${todo.content}`}
            >
              <span className="agent-plan-mark" aria-hidden="true">
                {statusMark(todo.status)}
              </span>
              <span className="agent-plan-item-text">{todo.content}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
