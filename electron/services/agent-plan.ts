/** Re-export plan helpers for Electron main (shared with renderer via src/utils). */
export {
  applyCheckpoint,
  applyUpdateTodo,
  countOpenTodos,
  createAgentPlanState,
  formatAgentPlanForModel,
  formatInitialTodoPlanNudge,
  formatOpenTodosNudge,
  formatTodosList,
  getOpenTodos,
  looksLikeMultiPartAgentTask,
  rebuildPlanFromSteps,
  sanitizeCheckpointArgs,
  sanitizeUpdateTodoArgs,
  collectAgentStepsThrough,
  type AgentPlanState,
  type AgentTodoItem,
  type AgentTodoStatus
} from '../../src/utils/agent-plan'
