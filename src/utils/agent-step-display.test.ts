import { describe, expect, it } from 'vitest'
import type { AgentToolStep } from '@/types'
import {
  formatAgentToolLabel,
  filterTimelineAgentSteps,
  getAgentToolLabelKey,
  groupConsecutiveAgentSteps,
  isPlanPanelMirroredStep,
  isQuietAgentStep,
  segmentAgentSteps,
  shouldCollapseQuietSteps,
  summarizeQuietSteps
} from './agent-step-display'

function step(partial: Partial<AgentToolStep> & Pick<AgentToolStep, 'id' | 'name'>): AgentToolStep {
  return {
    args: {},
    status: 'done',
    ok: true,
    ...partial
  }
}

describe('getAgentToolLabelKey / formatAgentToolLabel', () => {
  it('maps known tools to i18n keys and falls back for unknown names', () => {
    expect(getAgentToolLabelKey('proposeActions')).toBe('chat.agentToolName.proposeActions')
    expect(getAgentToolLabelKey('mysteryTool')).toBeNull()
    expect(formatAgentToolLabel('search', (key) => key)).toBe('chat.agentToolName.search')
    expect(formatAgentToolLabel('searchMeaning', (key) => key)).toBe(
      'chat.agentToolName.searchMeaning'
    )
    expect(formatAgentToolLabel('mysteryTool', (key) => key)).toBe('mysteryTool')
  })
})

describe('isQuietAgentStep', () => {
  it('treats successful inspect/meta tools as quiet', () => {
    expect(isQuietAgentStep(step({ id: '1', name: 'search' }))).toBe(true)
    expect(isQuietAgentStep(step({ id: '2', name: 'remember' }))).toBe(true)
    expect(isQuietAgentStep(step({ id: '3', name: 'verify', summary: 'no verify commands available; skipped' }))).toBe(
      true
    )
  })

  it('keeps proposeActions, failures, and active steps prominent', () => {
    expect(isQuietAgentStep(step({ id: '1', name: 'proposeActions' }))).toBe(false)
    expect(isQuietAgentStep(step({ id: '2', name: 'search', status: 'running' }))).toBe(false)
    expect(isQuietAgentStep(step({ id: '3', name: 'search', ok: false, status: 'error' }))).toBe(false)
    expect(
      isQuietAgentStep(
        step({
          id: '4',
          name: 'exec',
          ok: false,
          summary: 'Choose a safer command'
        })
      )
    ).toBe(false)
  })
})

describe('isPlanPanelMirroredStep / filterTimelineAgentSteps', () => {
  it('hides successful updateTodo and checkpoint only when the plan panel is visible', () => {
    expect(
      isPlanPanelMirroredStep(step({ id: '1', name: 'updateTodo' }), {
        planPanelVisible: true
      })
    ).toBe(true)
    expect(
      isPlanPanelMirroredStep(step({ id: '2', name: 'checkpoint' }), {
        planPanelVisible: true
      })
    ).toBe(true)
    expect(
      isPlanPanelMirroredStep(step({ id: '3', name: 'updateTodo', status: 'running' }), {
        planPanelVisible: true
      })
    ).toBe(true)
    expect(
      isPlanPanelMirroredStep(step({ id: '4', name: 'updateTodo' }), {
        planPanelVisible: false
      })
    ).toBe(false)
    expect(isPlanPanelMirroredStep(step({ id: '5', name: 'search' }))).toBe(false)
  })

  it('keeps failed plan tools visible and filters mirrors only when plan is shown', () => {
    const steps = [
      step({ id: '1', name: 'updateTodo' }),
      step({ id: '2', name: 'search' }),
      step({ id: '3', name: 'checkpoint' }),
      step({ id: '4', name: 'updateTodo', ok: false, status: 'error' })
    ]
    expect(filterTimelineAgentSteps(steps, { planPanelVisible: true }).map((s) => s.id)).toEqual([
      '2',
      '4'
    ])
    expect(filterTimelineAgentSteps(steps, { planPanelVisible: false }).map((s) => s.id)).toEqual([
      '1',
      '2',
      '3',
      '4'
    ])
  })
})

describe('groupConsecutiveAgentSteps', () => {
  it('merges consecutive same-name steps', () => {
    const groups = groupConsecutiveAgentSteps([
      step({ id: '1', name: 'search' }),
      step({ id: '2', name: 'search' }),
      step({ id: '3', name: 'listDir' }),
      step({ id: '4', name: 'search' })
    ])
    expect(groups.map((g) => [g.name, g.steps.length])).toEqual([
      ['search', 2],
      ['listDir', 1],
      ['search', 1]
    ])
  })
})

describe('segmentAgentSteps', () => {
  it('keeps chronological quiet runs and prominent steps', () => {
    const segments = segmentAgentSteps([
      step({ id: '1', name: 'listDir' }),
      step({ id: '2', name: 'search' }),
      step({ id: '3', name: 'proposeActions' }),
      step({ id: '4', name: 'verify', summary: 'no verify commands available; skipped' })
    ])
    expect(segments).toHaveLength(3)
    expect(segments[0]).toMatchObject({ kind: 'quiet', steps: [{ id: '1' }, { id: '2' }] })
    expect(segments[1]).toMatchObject({ kind: 'prominent', step: { id: '3', name: 'proposeActions' } })
    expect(segments[2]).toMatchObject({ kind: 'quiet', steps: [{ id: '4' }] })
  })
})

describe('shouldCollapseQuietSteps', () => {
  it('collapses only when enough quiet steps and nothing is active', () => {
    const quiet = [
      step({ id: '1', name: 'search' }),
      step({ id: '2', name: 'search' }),
      step({ id: '3', name: 'listDir' })
    ]
    expect(shouldCollapseQuietSteps(quiet, false)).toBe(true)
    expect(shouldCollapseQuietSteps(quiet, true)).toBe(false)
    expect(shouldCollapseQuietSteps(quiet.slice(0, 2), false)).toBe(false)
  })
})

describe('summarizeQuietSteps', () => {
  it('counts ok and skipped verify separately', () => {
    expect(
      summarizeQuietSteps([
        step({ id: '1', name: 'search' }),
        step({ id: '2', name: 'verify', summary: 'no verify commands available; skipped' }),
        step({ id: '3', name: 'listDir' })
      ])
    ).toEqual({ total: 3, ok: 2, skipped: 1, warning: 0 })
  })
})
