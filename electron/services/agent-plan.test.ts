import { describe, expect, it } from 'vitest'
import {
  applyCheckpoint,
  applyUpdateTodo,
  createAgentPlanState,
  formatAgentPlanForModel,
  rebuildPlanFromSteps,
  sanitizeCheckpointArgs,
  sanitizeUpdateTodoArgs
} from './agent-plan'

describe('applyUpdateTodo', () => {
  it('replaces the full list by default', () => {
    const state = createAgentPlanState()
    state.todos = [{ id: 'old', content: 'old', status: 'pending' }]

    const result = applyUpdateTodo(state, {
      todos: [
        { id: '1', content: 'Read files', status: 'done' },
        { id: '2', content: 'Propose fix', status: 'in_progress' }
      ]
    })

    expect(result.ok).toBe(true)
    expect(state.todos).toHaveLength(2)
    expect(state.todos[0].id).toBe('1')
    expect(result.content).toContain('[x] 1:')
    expect(result.content).toContain('(in_progress)')
  })

  it('merges by id when merge=true', () => {
    const state = createAgentPlanState()
    applyUpdateTodo(state, {
      todos: [
        { id: '1', content: 'A', status: 'pending' },
        { id: '2', content: 'B', status: 'pending' }
      ]
    })

    const result = applyUpdateTodo(state, {
      merge: true,
      todos: [{ id: '1', content: 'A done', status: 'done' }]
    })

    expect(result.ok).toBe(true)
    expect(state.todos).toEqual([
      { id: '1', content: 'A done', status: 'done' },
      { id: '2', content: 'B', status: 'pending' }
    ])
  })

  it('rejects empty or invalid todos', () => {
    const state = createAgentPlanState()
    expect(applyUpdateTodo(state, { todos: [] }).ok).toBe(false)
    expect(applyUpdateTodo(state, { todos: [{ id: '1' }] }).ok).toBe(false)
    expect(state.todos).toHaveLength(0)
  })
})

describe('applyCheckpoint', () => {
  it('stores a resume summary and includes current todos', () => {
    const state = createAgentPlanState()
    applyUpdateTodo(state, {
      todos: [{ id: '1', content: 'Remaining work', status: 'pending' }]
    })

    const result = applyCheckpoint(state, {
      summary: 'Read src/foo.ts; still need proposeActions for the bugfix.'
    })

    expect(result.ok).toBe(true)
    expect(state.checkpoint).toContain('Read src/foo.ts')
    expect(result.content).toContain('Current todos:')
    expect(result.content).toContain('Remaining work')
  })

  it('rejects empty summary', () => {
    const state = createAgentPlanState()
    expect(applyCheckpoint(state, { summary: '  ' }).ok).toBe(false)
    expect(state.checkpoint).toBeNull()
  })
})

describe('formatAgentPlanForModel', () => {
  it('returns null when empty', () => {
    expect(formatAgentPlanForModel(createAgentPlanState())).toBeNull()
  })

  it('includes checkpoint and open/done counts', () => {
    const state = createAgentPlanState()
    applyUpdateTodo(state, {
      todos: [
        { id: '1', content: 'Done item', status: 'done' },
        { id: '2', content: 'Next', status: 'pending' }
      ]
    })
    applyCheckpoint(state, { summary: 'Halfway through.' })

    const text = formatAgentPlanForModel(state)
    expect(text).toContain('Resume summary:')
    expect(text).toContain('Halfway through.')
    expect(text).toContain('1 done / 1 remaining')
    expect(text).toContain('Next')
  })
})

describe('rebuildPlanFromSteps', () => {
  it('replays updateTodo and checkpoint in order', () => {
    const state = rebuildPlanFromSteps([
      {
        name: 'updateTodo',
        status: 'done',
        args: {
          todos: [{ id: '1', content: 'A', status: 'pending' }]
        }
      },
      {
        name: 'checkpoint',
        status: 'done',
        args: { summary: 'Started A' }
      },
      {
        name: 'updateTodo',
        status: 'done',
        args: {
          merge: true,
          todos: [{ id: '1', content: 'A', status: 'done' }]
        }
      },
      {
        name: 'updateTodo',
        status: 'error',
        ok: false,
        args: {
          todos: [{ id: 'x', content: 'should skip', status: 'pending' }]
        }
      }
    ])

    expect(state.checkpoint).toBe('Started A')
    expect(state.todos).toEqual([{ id: '1', content: 'A', status: 'done' }])
  })
})

describe('sanitize helpers', () => {
  it('truncates todo content for UI', () => {
    const sanitized = sanitizeUpdateTodoArgs({
      merge: true,
      todos: [{ id: '1', content: 'x'.repeat(100), status: 'pending' }]
    })
    expect(sanitized.merge).toBe(true)
    expect(sanitized.todoCount).toBe(1)
    const todos = sanitized.todos as Array<{ content: string }>
    expect(todos[0].content.endsWith('…')).toBe(true)
  })

  it('truncates checkpoint summary for UI', () => {
    const sanitized = sanitizeCheckpointArgs({ summary: 'y'.repeat(250) })
    expect(sanitized.summaryChars).toBe(250)
    expect(String(sanitized.summary).endsWith('…')).toBe(true)
  })
})
