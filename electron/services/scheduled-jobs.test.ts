import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: {
    getPath: () => 'C:\\Users\\test\\AppData\\Roaming\\Compass'
  }
}))

import {
  buildScheduledJobFromInput,
  normalizeScheduledJob,
  resolveScheduledJobPolicy
} from './scheduled-jobs'

describe('resolveScheduledJobPolicy', () => {
  it('migrates legacy auto-apply-files + allowExec', () => {
    expect(resolveScheduledJobPolicy('auto-apply-files', true)).toBe('full-unattended')
  })
})

describe('normalizeScheduledJob', () => {
  it('reads schedule object', () => {
    const job = normalizeScheduledJob({
      id: '1',
      name: 'Daily',
      enabled: true,
      workspaceRoot: 'C:\\Work\\notes',
      prompt: 'Summarize',
      schedule: {
        kind: 'daily',
        startTime: '09:00',
        startDate: '2026-08-12',
        interval: 2
      }
    })
    expect(job?.schedule.kind).toBe('daily')
    expect(job?.schedule.interval).toBe(2)
  })

  it('migrates legacy frequency/time/dayOfWeek', () => {
    const job = normalizeScheduledJob({
      id: '1',
      name: 'Weekly',
      workspaceRoot: 'C:\\Work',
      prompt: 'x',
      frequency: 'weekly',
      time: '10:30',
      dayOfWeek: 3
    })
    expect(job?.schedule.kind).toBe('weekly')
    expect(job?.schedule.startTime).toBe('10:30')
    expect(job?.schedule.daysOfWeek).toEqual([3])
  })
})

describe('buildScheduledJobFromInput', () => {
  it('requires schedule validity for once', () => {
    expect(() =>
      buildScheduledJobFromInput({
        name: 'Once',
        enabled: true,
        workspaceRoot: 'C:\\a',
        prompt: 'hi',
        preset: 'general',
        policy: 'auto-apply-safe',
        allowExec: false,
        schedule: { kind: 'once', startTime: '08:00' }
      })
    ).toThrow(/start date/i)
  })

  it('persists weekly multi-day schedule', () => {
    const job = buildScheduledJobFromInput({
      name: 'Weekdays',
      enabled: true,
      workspaceRoot: 'D:\\proj',
      prompt: 'Run',
      preset: 'general',
      policy: 'full-unattended',
      allowExec: true,
      schedule: {
        kind: 'weekly',
        startTime: '07:15',
        startDate: '2026-08-12',
        interval: 1,
        daysOfWeek: [1, 2, 3, 4, 5]
      }
    })
    expect(job.schedule.daysOfWeek).toEqual([1, 2, 3, 4, 5])
    expect(job.allowExec).toBe(true)
  })
})
