import { describe, expect, it } from 'vitest'
import { setLocale } from '../../src/i18n/runtime'
import {
  applyCheckpoint,
  applyUpdateTodo,
  assistantImpliesPendingFileChanges,
  countOpenTodos,
  createAgentPlanState,
  formatAgentPlanForModel,
  formatMissingProposeActionsNudge,
  formatOpenTodosNudge,
  formatTruncatedProposeActionsNudge,
  getOpenTodos,
  looksLikeMultiPartAgentTask,
  looksLikeWorkspaceChangeRequest,
  rebuildPlanFromSteps,
  collectAgentStepsThrough,
  sanitizeCheckpointArgs,
  sanitizeUpdateTodoArgs,
  shouldNudgeMissingProposeActions,
  shouldNudgeMissingTodoPlan,
  shouldPlanFirstAgentTask,
  shouldShowAgentPlanPanel
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

  it('returns null when all todos are settled', () => {
    const state = createAgentPlanState()
    applyUpdateTodo(state, {
      todos: [
        { id: '1', content: 'Done item', status: 'done' },
        { id: '2', content: 'Skipped', status: 'cancelled' }
      ]
    })
    applyCheckpoint(state, { summary: 'Finished earlier work.' })
    expect(formatAgentPlanForModel(state)).toBeNull()
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
    expect(text).toContain('Next: mark "2" in_progress')
  })

  it('uses Japanese plan copy when locale is ja', () => {
    setLocale('ja')
    const state = createAgentPlanState()
    applyUpdateTodo(state, {
      todos: [{ id: '1', content: '作業', status: 'pending' }]
    })
    applyCheckpoint(state, { summary: '途中まで完了' })

    const text = formatAgentPlanForModel(state)
    expect(text).toContain('再開要約:')
    expect(text).toContain('途中まで完了')
    expect(text).toContain('Todos（0 完了 / 1 残り）:')
    setLocale('en')
  })
})

describe('shouldShowAgentPlanPanel', () => {
  it('hides settled plans on follow-up messages without plan tools', () => {
    const plan = createAgentPlanState()
    applyUpdateTodo(plan, {
      todos: [{ id: '1', content: 'Modularize game', status: 'done' }]
    })
    expect(
      shouldShowAgentPlanPanel(plan, [{ name: 'readFile', status: 'done' }])
    ).toBe(false)
  })

  it('shows settled plans on the message that updated them', () => {
    const plan = createAgentPlanState()
    applyUpdateTodo(plan, {
      todos: [{ id: '1', content: 'Modularize game', status: 'done' }]
    })
    expect(
      shouldShowAgentPlanPanel(plan, [{ name: 'updateTodo', status: 'done' }])
    ).toBe(true)
  })

  it('keeps open plans visible across follow-up tool turns', () => {
    const plan = createAgentPlanState()
    applyUpdateTodo(plan, {
      todos: [{ id: '1', content: 'Still working', status: 'in_progress' }]
    })
    expect(
      shouldShowAgentPlanPanel(plan, [{ name: 'readFile', status: 'done' }])
    ).toBe(true)
  })
})

describe('looksLikeMultiPartAgentTask', () => {
  it('detects numbered or bulleted multi-item asks', () => {
    expect(
      looksLikeMultiPartAgentTask('1. Fix the bug\n2. Add a test\n3. Update docs')
    ).toBe(true)
    expect(looksLikeMultiPartAgentTask('- Read foo\n- Patch bar')).toBe(true)
  })

  it('detects many path mentions', () => {
    expect(
      looksLikeMultiPartAgentTask('Look at @[a.ts] @[b.ts] @[c.ts] and fix them')
    ).toBe(true)
  })

  it('detects multiple imperative change clauses', () => {
    expect(
      looksLikeMultiPartAgentTask('foo.ts を修正して、テストも追加してください')
    ).toBe(true)
    expect(looksLikeMultiPartAgentTask('Fix the bug in foo.ts and update the docs')).toBe(true)
    expect(looksLikeMultiPartAgentTask('エラー修正とテスト追加をお願い')).toBe(true)
  })

  it('ignores short single asks', () => {
    expect(looksLikeMultiPartAgentTask('What does this function do?')).toBe(false)
    expect(looksLikeWorkspaceChangeRequest('Fix the typo in README.')).toBe(true)
    expect(looksLikeMultiPartAgentTask('Fix the typo in README.')).toBe(false)
  })
})

describe('shouldPlanFirstAgentTask', () => {
  it('plans multi-part and substantial edits first', () => {
    expect(shouldPlanFirstAgentTask('1. Fix A\n2. Fix B')).toBe(true)
    expect(
      shouldPlanFirstAgentTask(
        'src/components/ChatPanel.tsx の Agent 表示崩れを直してください。タイムラインと計画パネルの順も確認して。'
      )
    ).toBe(true)
    expect(shouldPlanFirstAgentTask('foo.ts と bar.ts を修正してください')).toBe(true)
  })

  it('skips tiny edits and pure Q&A', () => {
    expect(shouldPlanFirstAgentTask('Fix the typo in README.')).toBe(false)
    expect(shouldPlanFirstAgentTask('この修正方針を説明して')).toBe(false)
    expect(shouldPlanFirstAgentTask('What does this file do?')).toBe(false)
  })
})

describe('shouldNudgeMissingTodoPlan', () => {
  it('nudges multi-part asks until updateTodo runs', () => {
    expect(
      shouldNudgeMissingTodoPlan({
        userText: '1. Fix A\n2. Fix B',
        openTodoCount: 0,
        updateTodoCalledThisRun: false,
        alreadyNudging: false
      })
    ).toBe(true)

    expect(
      shouldNudgeMissingTodoPlan({
        userText: '1. Fix A\n2. Fix B',
        openTodoCount: 0,
        updateTodoCalledThisRun: true,
        alreadyNudging: false
      })
    ).toBe(false)

    expect(
      shouldNudgeMissingTodoPlan({
        userText: '1. Fix A\n2. Fix B',
        openTodoCount: 2,
        updateTodoCalledThisRun: false,
        alreadyNudging: false
      })
    ).toBe(false)
  })

  it('also nudges substantial single-clause edit asks', () => {
    expect(
      shouldNudgeMissingTodoPlan({
        userText:
          'ChatPanel.tsx の計画パネルが後からしか出ない問題を直してください',
        openTodoCount: 0,
        updateTodoCalledThisRun: false,
        alreadyNudging: false
      })
    ).toBe(true)
  })
})

describe('open todo helpers', () => {
  it('counts pending and in_progress only', () => {
    const state = createAgentPlanState()
    applyUpdateTodo(state, {
      todos: [
        { id: '1', content: 'Done', status: 'done' },
        { id: '2', content: 'Next', status: 'pending' },
        { id: '3', content: 'Working', status: 'in_progress' },
        { id: '4', content: 'Skipped', status: 'cancelled' }
      ]
    })
    expect(countOpenTodos(state)).toBe(2)
    expect(getOpenTodos(state).map((t) => t.id)).toEqual(['2', '3'])
  })

  it('formatOpenTodosNudge returns null when nothing is open', () => {
    const state = createAgentPlanState()
    applyUpdateTodo(state, {
      todos: [{ id: '1', content: 'Done', status: 'done' }]
    })
    expect(formatOpenTodosNudge(state)).toBeNull()
    expect(formatOpenTodosNudge(createAgentPlanState())).toBeNull()
  })

  it('formatOpenTodosNudge lists remaining open items', () => {
    const state = createAgentPlanState()
    applyUpdateTodo(state, {
      todos: [
        { id: '1', content: 'Done', status: 'done' },
        { id: '2', content: 'Still open', status: 'pending' }
      ]
    })
    const nudge = formatOpenTodosNudge(state)
    expect(nudge).toContain('Open todos remain')
    expect(nudge).toContain('Still open')
    expect(nudge).not.toContain('Done')
  })

  it('formatOpenTodosNudge uses Japanese copy when locale is ja', () => {
    setLocale('ja')
    const state = createAgentPlanState()
    applyUpdateTodo(state, {
      todos: [{ id: '1', content: '残り作業', status: 'pending' }]
    })
    const nudge = formatOpenTodosNudge(state)
    expect(nudge).toContain('未完了の todo が残っています')
    expect(nudge).toContain('残り作業')
    setLocale('en')
  })
})

describe('proposeActions finish nudges', () => {
  it('detects workspace change requests', () => {
    expect(looksLikeWorkspaceChangeRequest('Fix the bug in note.txt')).toBe(true)
    expect(looksLikeWorkspaceChangeRequest('実装してください')).toBe(true)
    expect(looksLikeWorkspaceChangeRequest('同様に bar.ts も')).toBe(true)
    expect(looksLikeWorkspaceChangeRequest('same for utils.ts')).toBe(true)
    expect(looksLikeWorkspaceChangeRequest('List the workspace')).toBe(false)
    expect(looksLikeWorkspaceChangeRequest('What does this file do?')).toBe(false)
    expect(looksLikeWorkspaceChangeRequest('この修正方針を説明して')).toBe(false)
    expect(looksLikeWorkspaceChangeRequest('How should I fix this bug?')).toBe(false)
    expect(looksLikeWorkspaceChangeRequest('修正方法を教えて')).toBe(false)
  })

  it('detects fake pending file changes in assistant text', () => {
    expect(
      assistantImpliesPendingFileChanges(
        '```compass-actions\n{"actions":[{"type":"writeFile","path":"a.md","content":"x"}]}\n```'
      )
    ).toBe(true)
    expect(assistantImpliesPendingFileChanges('承認してください')).toBe(true)
    expect(assistantImpliesPendingFileChanges('Here is what I found.')).toBe(false)
  })

  it('shouldNudgeMissingProposeActions covers truncation and skips after preview', () => {
    expect(
      shouldNudgeMissingProposeActions({
        userText: 'List files',
        assistantText: '',
        proposeActionsApplied: false,
        proposeActionsTruncated: true,
        proposeActionsReachedPreview: false,
        alreadyNudging: false
      })
    ).toBe(true)

    expect(
      shouldNudgeMissingProposeActions({
        userText: 'Fix note.txt',
        assistantText: 'Stopped.',
        proposeActionsApplied: false,
        proposeActionsTruncated: false,
        proposeActionsReachedPreview: true,
        alreadyNudging: false
      })
    ).toBe(false)

    expect(
      shouldNudgeMissingProposeActions({
        userText: 'Fix note.txt',
        assistantText: '```compass-actions\n{"actions":[]}\n```',
        proposeActionsApplied: false,
        proposeActionsTruncated: false,
        proposeActionsReachedPreview: true,
        alreadyNudging: false
      })
    ).toBe(true)

    expect(
      shouldNudgeMissingProposeActions({
        userText: 'What is in this folder?',
        assistantText: 'Stopping without tool.',
        proposeActionsApplied: false,
        proposeActionsTruncated: false,
        proposeActionsReachedPreview: false,
        alreadyNudging: true
      })
    ).toBe(true)
  })

  it('formats propose nudge copy', () => {
    expect(formatMissingProposeActionsNudge()).toContain('proposeActions was not called')
    expect(formatTruncatedProposeActionsNudge()).toContain('truncated')
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

describe('collectAgentStepsThrough', () => {
  it('includes assistant steps up to the given index only', () => {
    const messages: Array<{
      role: string
      content?: string
      agentSteps?: Array<{ name: string; status: string; args: Record<string, unknown> }>
    }> = [
      { role: 'user', content: 'a' },
      {
        role: 'assistant',
        agentSteps: [{ name: 'updateTodo', status: 'done', args: { todos: [] } }]
      },
      { role: 'user', content: 'b' },
      {
        role: 'assistant',
        agentSteps: [{ name: 'readFile', status: 'done', args: { path: 'x' } }]
      }
    ]

    expect(collectAgentStepsThrough(messages, 1)).toHaveLength(1)
    expect(collectAgentStepsThrough(messages, 3).map((s) => s.name)).toEqual([
      'updateTodo',
      'readFile'
    ])
    expect(collectAgentStepsThrough(messages, 0)).toEqual([])
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
