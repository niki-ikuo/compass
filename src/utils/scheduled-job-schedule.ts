import type {
  ScheduledJobMonthlyMode,
  ScheduledJobMonthlyWeek,
  ScheduledJobSchedule,
  ScheduledJobScheduleKind
} from '@/types'
import {
  normalizeScheduledJobFrequency,
  normalizeScheduledJobMonthlyWeek,
  normalizeScheduledJobScheduleKind
} from '@/types'

const DOW_SCHTASKS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'] as const
const MONTH_SCHTASKS = [
  'JAN',
  'FEB',
  'MAR',
  'APR',
  'MAY',
  'JUN',
  'JUL',
  'AUG',
  'SEP',
  'OCT',
  'NOV',
  'DEC'
] as const

export function isValidScheduleTime(value: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value)
}

export function isValidIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const t = Date.parse(`${value}T00:00:00`)
  return !Number.isNaN(t)
}

export function todayIsoDate(date = new Date()): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/** Format yyyy-MM-dd for schtasks /SD /ED (yyyy/MM/dd works on ja-JP and most locales). */
export function formatSchtasksDate(isoDate: string): string {
  const [y, m, d] = isoDate.split('-')
  return `${y}/${m}/${d}`
}

export function defaultScheduledJobSchedule(): ScheduledJobSchedule {
  return {
    kind: 'daily',
    startTime: '09:00',
    startDate: todayIsoDate(),
    interval: 1
  }
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  const n = Math.trunc(value)
  if (n < min) return min
  if (n > max) return max
  return n
}

function normalizeDaysOfWeek(raw: unknown): number[] {
  if (!Array.isArray(raw)) return []
  const set = new Set<number>()
  for (const item of raw) {
    const n = clampInt(item, 0, 6, -1)
    if (n >= 0) set.add(n)
  }
  return [...set].sort((a, b) => a - b)
}

function normalizeDaysOfMonth(raw: unknown): number[] {
  if (!Array.isArray(raw)) return []
  const set = new Set<number>()
  for (const item of raw) {
    const n = clampInt(item, 1, 31, -1)
    if (n >= 1) set.add(n)
  }
  return [...set].sort((a, b) => a - b)
}

function normalizeMonths(raw: unknown): number[] {
  if (!Array.isArray(raw)) return []
  const set = new Set<number>()
  for (const item of raw) {
    const n = clampInt(item, 1, 12, -1)
    if (n >= 1) set.add(n)
  }
  return [...set].sort((a, b) => a - b)
}

/** Migrate legacy frequency/time/dayOfWeek into schedule. */
export function migrateLegacySchedule(raw: Record<string, unknown>): ScheduledJobSchedule | null {
  const time = typeof raw.time === 'string' ? raw.time.trim() : ''
  if (!isValidScheduleTime(time)) return null
  const frequency = normalizeScheduledJobFrequency(raw.frequency) ?? 'daily'
  const startDate = todayIsoDate()

  if (frequency === 'weekly') {
    const day =
      typeof raw.dayOfWeek === 'number' && Number.isInteger(raw.dayOfWeek) && raw.dayOfWeek >= 0 && raw.dayOfWeek <= 6
        ? raw.dayOfWeek
        : 1
    return {
      kind: 'weekly',
      startTime: time,
      startDate,
      interval: 1,
      daysOfWeek: [day]
    }
  }

  // hourly (legacy) → daily at that clock time
  return {
    kind: 'daily',
    startTime: time,
    startDate,
    interval: 1
  }
}

export function normalizeScheduledJobSchedule(raw: unknown): ScheduledJobSchedule | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const kind = normalizeScheduledJobScheduleKind(o.kind)
  const startTime = typeof o.startTime === 'string' ? o.startTime.trim() : ''
  if (!kind || !isValidScheduleTime(startTime)) return null

  const schedule: ScheduledJobSchedule = { kind, startTime }

  if (typeof o.startDate === 'string' && isValidIsoDate(o.startDate.trim())) {
    schedule.startDate = o.startDate.trim()
  }
  if (typeof o.endDate === 'string' && isValidIsoDate(o.endDate.trim())) {
    schedule.endDate = o.endDate.trim()
  }

  if (kind === 'once') {
    if (!schedule.startDate) return null
    return schedule
  }

  if (kind === 'daily') {
    schedule.interval = clampInt(o.interval, 1, 365, 1)
    return schedule
  }

  if (kind === 'weekly') {
    schedule.interval = clampInt(o.interval, 1, 52, 1)
    const days = normalizeDaysOfWeek(o.daysOfWeek)
    schedule.daysOfWeek = days.length > 0 ? days : [1]
    return schedule
  }

  // monthly
  const mode: ScheduledJobMonthlyMode = o.monthlyMode === 'weekday' ? 'weekday' : 'days'
  schedule.monthlyMode = mode
  const months = normalizeMonths(o.months)
  if (months.length > 0) schedule.months = months

  if (mode === 'weekday') {
    const week: ScheduledJobMonthlyWeek =
      normalizeScheduledJobMonthlyWeek(o.monthlyWeek) ?? 'FIRST'
    schedule.monthlyWeek = week
    schedule.monthlyWeekday = clampInt(o.monthlyWeekday, 0, 6, 1)
    return schedule
  }

  const daysOfMonth = normalizeDaysOfMonth(o.daysOfMonth)
  schedule.daysOfMonth = daysOfMonth.length > 0 ? daysOfMonth : [1]
  return schedule
}

export function assertValidScheduledJobSchedule(schedule: ScheduledJobSchedule): void {
  if (!isValidScheduleTime(schedule.startTime)) {
    throw new Error(`Invalid start time: ${schedule.startTime}`)
  }
  if (schedule.startDate && !isValidIsoDate(schedule.startDate)) {
    throw new Error(`Invalid start date: ${schedule.startDate}`)
  }
  if (schedule.endDate && !isValidIsoDate(schedule.endDate)) {
    throw new Error(`Invalid end date: ${schedule.endDate}`)
  }
  if (schedule.kind === 'once' && !schedule.startDate) {
    throw new Error('Start date is required for a one-time schedule')
  }
  if (schedule.kind === 'weekly' && (!schedule.daysOfWeek || schedule.daysOfWeek.length === 0)) {
    throw new Error('Select at least one day of the week')
  }
  if (
    schedule.kind === 'monthly' &&
    schedule.monthlyMode !== 'weekday' &&
    (!schedule.daysOfMonth || schedule.daysOfMonth.length === 0)
  ) {
    throw new Error('Select at least one day of the month')
  }
}

export function schtasksDaysOfWeek(days: number[]): string {
  return days.map((d) => DOW_SCHTASKS[d] ?? 'MON').join(',')
}

export function schtasksMonths(months: number[] | undefined): string {
  if (!months || months.length === 0) return '*'
  return months.map((m) => MONTH_SCHTASKS[m - 1] ?? 'JAN').join(',')
}

export function scheduleKindLabelKey(kind: ScheduledJobScheduleKind): string {
  return `jobs.schedule.${kind}`
}
