import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ScheduledJob } from '../../src/types'

vi.mock('electron', () => ({
  app: {
    isPackaged: true,
    getAppPath: () => 'C:\\app',
    getPath: () => 'C:\\Users\\test\\AppData\\Roaming\\Compass'
  }
}))

import {
  buildLaunchCommand,
  buildSchtasksArgsFromSchedule,
  buildSchtasksCreateArgSets,
  escapeXmlText,
  injectTaskDescriptionXml,
  quoteForSchtasks
} from './windows-task-scheduler'

describe('quoteForSchtasks', () => {
  it('quotes paths with spaces', () => {
    expect(quoteForSchtasks('C:\\Program Files\\Compass\\Compass.exe')).toBe(
      '"C:\\Program Files\\Compass\\Compass.exe"'
    )
  })
})

describe('buildSchtasksArgsFromSchedule', () => {
  beforeEach(() => {
    Object.defineProperty(process, 'execPath', {
      value: 'C:\\Compass\\Compass.exe',
      configurable: true
    })
  })

  it('builds daily every N days', () => {
    const args = buildSchtasksArgsFromSchedule('Compass\\job-a', 'run', {
      kind: 'daily',
      startTime: '09:00',
      startDate: '2026-08-12',
      interval: 3
    })
    expect(args).toContain('DAILY')
    expect(args).toContain('/MO')
    expect(args).toContain('3')
    expect(args).toContain('09:00')
    expect(args).toContain('2026/08/12')
  })

  it('builds weekly with multiple days', () => {
    const args = buildSchtasksArgsFromSchedule('Compass\\job-a', 'run', {
      kind: 'weekly',
      startTime: '08:00',
      interval: 1,
      daysOfWeek: [1, 3, 5]
    })
    expect(args).toContain('WEEKLY')
    expect(args).toContain('MON,WED,FRI')
  })

  it('builds monthly weekday pattern', () => {
    const args = buildSchtasksArgsFromSchedule('Compass\\job-a', 'run', {
      kind: 'monthly',
      startTime: '10:00',
      monthlyMode: 'weekday',
      monthlyWeek: 'SECOND',
      monthlyWeekday: 2,
      months: [1, 6]
    })
    expect(args).toContain('MONTHLY')
    expect(args).toContain('SECOND')
    expect(args).toContain('TUE')
    expect(args).toContain('JAN,JUN')
  })

  it('builds once', () => {
    const args = buildSchtasksArgsFromSchedule('Compass\\job-a', 'run', {
      kind: 'once',
      startTime: '12:30',
      startDate: '2026-12-01'
    })
    expect(args).toContain('ONCE')
    expect(args).toContain('12:30')
  })
})

describe('buildSchtasksCreateArgSets', () => {
  beforeEach(() => {
    Object.defineProperty(process, 'execPath', {
      value: 'C:\\Compass\\Compass.exe',
      configurable: true
    })
  })

  it('splits multi-day monthly into multiple tasks', () => {
    const job: ScheduledJob = {
      id: 'abc',
      name: 'Multi',
      enabled: true,
      workspaceRoot: 'D:\\notes',
      prompt: 'Go',
      preset: 'general',
      policy: 'auto-apply-safe',
      allowExec: false,
      schedule: {
        kind: 'monthly',
        startTime: '09:00',
        monthlyMode: 'days',
        daysOfMonth: [1, 15]
      },
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z'
    }
    const sets = buildSchtasksCreateArgSets(job)
    expect(sets).toHaveLength(2)
    expect(sets[0]).toContain('Compass\\job-abc')
    expect(sets[1]).toContain('Compass\\job-abc-d15')
    expect(buildLaunchCommand('abc').tr).toContain('--run-job=abc')
  })
})

describe('task description helpers', () => {
  it('escapes XML text', () => {
    expect(escapeXmlText(`a<b>&"'`)).toBe('a&lt;b&gt;&amp;&quot;&apos;')
  })

  it('injects Description into RegistrationInfo', () => {
    const xml = `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Author>user</Author>
    <URI>\\Compass\\job-abc</URI>
  </RegistrationInfo>
</Task>`
    const out = injectTaskDescriptionXml(xml, 'Daily sync <v2>')
    expect(out).toContain('<Description>Daily sync &lt;v2&gt;</Description>')
    expect(out).toContain('</RegistrationInfo>')
  })

  it('replaces an existing Description', () => {
    const xml = `<RegistrationInfo><Description>old</Description></RegistrationInfo>`
    expect(injectTaskDescriptionXml(xml, 'new')).toBe(
      `<RegistrationInfo><Description>new</Description></RegistrationInfo>`
    )
  })
})
