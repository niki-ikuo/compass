import { afterEach, describe, expect, it } from 'vitest'
import {
  resetAgentApprovalStateForTests,
  resolveAgentApproval,
  resolveAgentContinue,
  waitForApproval,
  waitForContinue
} from './agent-approval'

afterEach(() => {
  resetAgentApprovalStateForTests()
})

describe('resolveAgentApproval', () => {
  it('returns false when nothing is pending', () => {
    expect(resolveAgentApproval({ id: 'missing', approved: true })).toBe(false)
  })

  it('resolves a waiting approval with approved=true', async () => {
    const signal = new AbortController().signal
    const pending = waitForApproval('a1', signal)
    expect(resolveAgentApproval({ id: 'a1', approved: true, detail: 'ok' })).toBe(true)
    await expect(pending).resolves.toEqual({ approved: true, detail: 'ok' })
  })

  it('resolves a waiting approval with approved=false', async () => {
    const signal = new AbortController().signal
    const pending = waitForApproval('a2', signal)
    expect(resolveAgentApproval({ id: 'a2', approved: false, detail: 'nope' })).toBe(true)
    await expect(pending).resolves.toEqual({ approved: false, detail: 'nope' })
  })

  it('rejects when the abort signal fires', async () => {
    const controller = new AbortController()
    const pending = waitForApproval('a3', controller.signal)
    controller.abort()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(resolveAgentApproval({ id: 'a3', approved: true })).toBe(false)
  })

  it('rejects immediately when already aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(waitForApproval('a4', controller.signal)).rejects.toMatchObject({
      name: 'AbortError'
    })
  })
})

describe('resolveAgentContinue', () => {
  it('returns false when nothing is pending', () => {
    expect(resolveAgentContinue({ id: 'missing', continue: true })).toBe(false)
  })

  it('resolves continue=true and continue=false', async () => {
    const signal = new AbortController().signal
    const pendingYes = waitForContinue('c1', signal)
    expect(resolveAgentContinue({ id: 'c1', continue: true })).toBe(true)
    await expect(pendingYes).resolves.toEqual({ continue: true })

    const pendingNo = waitForContinue('c2', signal)
    expect(resolveAgentContinue({ id: 'c2', continue: false })).toBe(true)
    await expect(pendingNo).resolves.toEqual({ continue: false })
  })
})
