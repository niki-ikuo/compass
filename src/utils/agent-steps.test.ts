import { describe, expect, it } from 'vitest'
import type { AgentToolStep } from '@/types'
import { failInFlightAgentSteps, updateAgentStepById } from '@/utils/agent-steps'

function step(
  partial: Partial<AgentToolStep> & Pick<AgentToolStep, 'id' | 'status'>
): AgentToolStep {
  return {
    name: 'readFile',
    args: {},
    ...partial
  }
}

describe('updateAgentStepById', () => {
  it('patches only the matching step', () => {
    const steps = [
      step({ id: 'a', status: 'running' }),
      step({ id: 'b', status: 'running' })
    ]
    const next = updateAgentStepById(steps, 'b', {
      status: 'done',
      ok: true,
      summary: 'ok'
    })
    expect(next[0]).toEqual(steps[0])
    expect(next[1]).toMatchObject({
      id: 'b',
      status: 'done',
      ok: true,
      summary: 'ok'
    })
  })
})

describe('failInFlightAgentSteps', () => {
  it('marks running / waiting steps as error and leaves done alone', () => {
    const steps = [
      step({ id: '1', status: 'running' }),
      step({ id: '2', status: 'waiting_approval', summary: 'wait' }),
      step({ id: '3', status: 'waiting_continue' }),
      step({ id: '4', status: 'done', ok: true, summary: 'done' })
    ]
    const next = failInFlightAgentSteps(steps, 'boom')
    expect(next[0]).toMatchObject({ status: 'error', ok: false, summary: 'boom' })
    expect(next[1]).toMatchObject({ status: 'error', ok: false, summary: 'boom' })
    expect(next[2]).toMatchObject({ status: 'error', ok: false, summary: 'boom' })
    expect(next[3]).toEqual(steps[3])
  })

  it('keeps existing summary on abort when preferExistingSummary is set', () => {
    const steps = [
      step({ id: '1', status: 'running', summary: 'reading' }),
      step({ id: '2', status: 'waiting_approval' })
    ]
    const next = failInFlightAgentSteps(steps, 'aborted', {
      preferExistingSummary: true
    })
    expect(next[0].summary).toBe('reading')
    expect(next[1].summary).toBe('aborted')
  })
})
