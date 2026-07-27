import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS } from '../../src/types'

const electronState = {
  userData: ''
}

vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => (name === 'userData' ? electronState.userData : '')
  },
  BrowserWindow: {
    getAllWindows: () => []
  }
}))

vi.mock('./settings', () => ({
  getSettings: vi.fn(async () => ({
    ...DEFAULT_SETTINGS,
    usageResetDay: 15
  }))
}))

import {
  getUsage,
  recordChatCompletionUsage,
  resetUsage
} from './usage'

function makeUserData(name: string): string {
  const root = join(
    tmpdir(),
    `compass-usage-${name}-${Date.now()}-${Math.random().toString(36).slice(2)}`
  )
  mkdirSync(root, { recursive: true })
  return root
}

const tempRoots: string[] = []

beforeEach(() => {
  electronState.userData = makeUserData('ud')
  tempRoots.push(electronState.userData)
  vi.useFakeTimers()
  vi.setSystemTime(new Date(2026, 6, 20)) // 2026-07-20 → period 2026-07-15
})

afterEach(() => {
  vi.useRealTimers()
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe('usage service', () => {
  it('starts empty for the current period', async () => {
    const snapshot = await getUsage()
    expect(snapshot).toMatchObject({
      periodStart: '2026-07-15',
      periodEnd: '2026-08-14',
      requestCount: 0,
      promptTokens: 0,
      completionTokens: 0,
      usageMissingCount: 0
    })
  })

  it('records requests and tokens', async () => {
    await recordChatCompletionUsage({ promptTokens: 100, completionTokens: 50 })
    await recordChatCompletionUsage(null)
    const snapshot = await getUsage()
    expect(snapshot.requestCount).toBe(2)
    expect(snapshot.promptTokens).toBe(100)
    expect(snapshot.completionTokens).toBe(50)
    expect(snapshot.usageMissingCount).toBe(1)

    const raw = JSON.parse(readFileSync(join(electronState.userData, 'usage.json'), 'utf-8'))
    expect(raw.periodStart).toBe('2026-07-15')
    expect(raw.requestCount).toBe(2)
  })

  it('rolls over when period changes', async () => {
    await recordChatCompletionUsage({ promptTokens: 10, completionTokens: 5 })
    vi.setSystemTime(new Date(2026, 7, 16)) // 2026-08-16 → period 2026-08-15
    const snapshot = await getUsage()
    expect(snapshot.periodStart).toBe('2026-08-15')
    expect(snapshot.requestCount).toBe(0)
    expect(snapshot.promptTokens).toBe(0)
  })

  it('manual reset clears counters for current period', async () => {
    await recordChatCompletionUsage({ promptTokens: 1, completionTokens: 2 })
    const snapshot = await resetUsage()
    expect(snapshot.periodStart).toBe('2026-07-15')
    expect(snapshot.requestCount).toBe(0)
    expect(snapshot.promptTokens).toBe(0)
    expect(snapshot.completionTokens).toBe(0)
  })

  it('ignores stale stored period on read', async () => {
    writeFileSync(
      join(electronState.userData, 'usage.json'),
      JSON.stringify({
        periodStart: '2026-06-15',
        requestCount: 99,
        promptTokens: 1000,
        completionTokens: 500,
        usageMissingCount: 3,
        updatedAt: '2026-06-20T00:00:00.000Z'
      })
    )
    const snapshot = await getUsage()
    expect(snapshot.periodStart).toBe('2026-07-15')
    expect(snapshot.requestCount).toBe(0)
  })
})
