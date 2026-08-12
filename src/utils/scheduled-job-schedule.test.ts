import { describe, expect, it } from 'vitest'
import {
  migrateLegacySchedule,
  normalizeScheduledJobSchedule,
  schtasksDaysOfWeek,
  schtasksMonths
} from './scheduled-job-schedule'

describe('normalizeScheduledJobSchedule', () => {
  it('normalizes weekly days', () => {
    const s = normalizeScheduledJobSchedule({
      kind: 'weekly',
      startTime: '09:00',
      daysOfWeek: [5, 1, 1]
    })
    expect(s?.daysOfWeek).toEqual([1, 5])
  })

  it('requires startDate for once', () => {
    expect(
      normalizeScheduledJobSchedule({
        kind: 'once',
        startTime: '09:00'
      })
    ).toBeNull()
  })
})

describe('migrateLegacySchedule', () => {
  it('maps hourly to daily', () => {
    const s = migrateLegacySchedule({ frequency: 'hourly', time: '08:15' })
    expect(s?.kind).toBe('daily')
    expect(s?.startTime).toBe('08:15')
  })
})

describe('schtasks helpers', () => {
  it('formats days and months', () => {
    expect(schtasksDaysOfWeek([0, 6])).toBe('SUN,SAT')
    expect(schtasksMonths(undefined)).toBe('*')
    expect(schtasksMonths([1, 12])).toBe('JAN,DEC')
  })
})
