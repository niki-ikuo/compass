import { afterEach, describe, expect, it } from 'vitest'
import {
  resetAgentApprovalStateForTests,
  resolveAgentApproval,
  resolveAgentApprovalForSender,
  resolveAgentContinue,
  resolveAgentContinueForSender,
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
    const pending = waitForApproval('a1', signal, 1)
    expect(resolveAgentApproval({ id: 'a1', approved: true, detail: 'ok' })).toBe(true)
    await expect(pending).resolves.toEqual({ approved: true, detail: 'ok' })
  })

  it('resolves a waiting approval with approved=false', async () => {
    const signal = new AbortController().signal
    const pending = waitForApproval('a2', signal, 1)
    expect(resolveAgentApproval({ id: 'a2', approved: false, detail: 'nope' })).toBe(true)
    await expect(pending).resolves.toEqual({ approved: false, detail: 'nope' })
  })

  it('rejects when the abort signal fires', async () => {
    const controller = new AbortController()
    const pending = waitForApproval('a3', controller.signal, 1)
    controller.abort()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(resolveAgentApproval({ id: 'a3', approved: true })).toBe(false)
  })

  it('rejects immediately when already aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(waitForApproval('a4', controller.signal, 1)).rejects.toMatchObject({
      name: 'AbortError'
    })
  })

  it('rejects resolve from a different webContents sender', async () => {
    const signal = new AbortController().signal
    const pending = waitForApproval('a5', signal, 10)
    expect(resolveAgentApprovalForSender(99, { id: 'a5', approved: true })).toBe(false)
    expect(resolveAgentApprovalForSender(10, { id: 'a5', approved: true })).toBe(true)
    await expect(pending).resolves.toEqual({ approved: true, detail: undefined })
  })
})

describe('resolveAgentContinue', () => {
  it('returns false when nothing is pending', () => {
    expect(resolveAgentContinue({ id: 'missing', continue: true })).toBe(false)
  })

  it('resolves continue=true and continue=false', async () => {
    const signal = new AbortController().signal
    const pendingYes = waitForContinue('c1', signal, 1)
    expect(resolveAgentContinue({ id: 'c1', continue: true })).toBe(true)
    await expect(pendingYes).resolves.toEqual({ continue: true })

    const pendingNo = waitForContinue('c2', signal, 1)
    expect(resolveAgentContinue({ id: 'c2', continue: false })).toBe(true)
    await expect(pendingNo).resolves.toEqual({ continue: false })
  })

  it('rejects continue from a different sender', async () => {
    const signal = new AbortController().signal
    const pending = waitForContinue('c3', signal, 7)
    expect(resolveAgentContinueForSender(1, { id: 'c3', continue: true })).toBe(false)
    expect(resolveAgentContinueForSender(7, { id: 'c3', continue: false })).toBe(true)
    await expect(pending).resolves.toEqual({ continue: false })
  })
})
