import { execFile } from 'child_process'
import { randomBytes } from 'crypto'
import { unlink, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { promisify } from 'util'
import iconv from 'iconv-lite'
import { app } from 'electron'
import type { ScheduledJob, ScheduledJobSchedule } from '../../src/types'
import {
  formatSchtasksDate,
  schtasksDaysOfWeek,
  schtasksMonths
} from '../../src/utils/scheduled-job-schedule'
import { RUN_JOB_ARG_PREFIX } from './run-job-arg'
import { windowsTaskNameForJob } from './scheduled-jobs'

const execFileAsync = promisify(execFile)
const DOW_NAMES = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'] as const

export type TaskSchedulerResult = { ok: true } | { ok: false; message: string }

/** Quote a Windows path/arg for schtasks /tr */
export function quoteForSchtasks(value: string): string {
  if (!/[ \t"]/.test(value)) return value
  return `"${value.replace(/"/g, '\\"')}"`
}

export function buildLaunchCommand(jobId: string): { exe: string; args: string[]; tr: string } {
  const runArg = `${RUN_JOB_ARG_PREFIX}${jobId}`
  if (app.isPackaged) {
    const exe = process.execPath
    return { exe, args: [runArg], tr: `${quoteForSchtasks(exe)} ${runArg}` }
  }
  const exe = process.execPath
  const appPath = app.getAppPath()
  return {
    exe,
    args: [appPath, runArg],
    tr: `${quoteForSchtasks(exe)} ${quoteForSchtasks(appPath)} ${runArg}`
  }
}

function appendDateBounds(args: string[], schedule: ScheduledJobSchedule): void {
  if (schedule.startDate) {
    args.push('/SD', formatSchtasksDate(schedule.startDate))
  }
  if (schedule.endDate) {
    args.push('/ED', formatSchtasksDate(schedule.endDate))
  }
}

/** Build schtasks /Create args from a Task Scheduler–style schedule. */
export function buildSchtasksArgsFromSchedule(
  taskName: string,
  tr: string,
  schedule: ScheduledJobSchedule
): string[] {
  const args = ['/Create', '/TN', taskName, '/TR', tr, '/F', '/IT', '/RL', 'LIMITED']

  if (schedule.kind === 'once') {
    args.push('/SC', 'ONCE', '/ST', schedule.startTime)
    appendDateBounds(args, schedule)
    return args
  }

  if (schedule.kind === 'daily') {
    const interval = schedule.interval && schedule.interval > 0 ? schedule.interval : 1
    args.push('/SC', 'DAILY', '/MO', String(interval), '/ST', schedule.startTime)
    appendDateBounds(args, schedule)
    return args
  }

  if (schedule.kind === 'weekly') {
    const interval = schedule.interval && schedule.interval > 0 ? schedule.interval : 1
    const days =
      schedule.daysOfWeek && schedule.daysOfWeek.length > 0 ? schedule.daysOfWeek : [1]
    args.push(
      '/SC',
      'WEEKLY',
      '/MO',
      String(interval),
      '/D',
      schtasksDaysOfWeek(days),
      '/ST',
      schedule.startTime
    )
    appendDateBounds(args, schedule)
    return args
  }

  // monthly
  const months = schtasksMonths(schedule.months)
  if (schedule.monthlyMode === 'weekday') {
    const week = schedule.monthlyWeek ?? 'FIRST'
    const weekday = DOW_NAMES[schedule.monthlyWeekday ?? 1] ?? 'MON'
    args.push('/SC', 'MONTHLY', '/MO', week, '/D', weekday, '/M', months, '/ST', schedule.startTime)
    appendDateBounds(args, schedule)
    return args
  }

  // days-of-month: schtasks accepts one /D value; create with first day.
  // Multiple days → comma join when supported (Vista+ often accepts one day only).
  const dayList =
    schedule.daysOfMonth && schedule.daysOfMonth.length > 0 ? schedule.daysOfMonth : [1]
  args.push('/SC', 'MONTHLY', '/D', String(dayList[0]), '/M', months, '/ST', schedule.startTime)
  appendDateBounds(args, schedule)
  return args
}

export function buildSchtasksCreateArgs(job: ScheduledJob): string[] {
  const taskName = windowsTaskNameForJob(job.id)
  const { tr } = buildLaunchCommand(job.id)
  return buildSchtasksArgsFromSchedule(taskName, tr, job.schedule)
}

/**
 * Monthly days-of-month with multiple days: register one task per day
 * (schtasks /D is unreliable with lists). Primary task uses first day; extras get suffix.
 */
export function buildSchtasksCreateArgSets(job: ScheduledJob): string[][] {
  const { tr } = buildLaunchCommand(job.id)
  const baseName = windowsTaskNameForJob(job.id)
  const schedule = job.schedule

  if (
    schedule.kind === 'monthly' &&
    schedule.monthlyMode !== 'weekday' &&
    schedule.daysOfMonth &&
    schedule.daysOfMonth.length > 1
  ) {
    return schedule.daysOfMonth.map((day, index) => {
      const name = index === 0 ? baseName : `${baseName}-d${day}`
      return buildSchtasksArgsFromSchedule(name, tr, {
        ...schedule,
        daysOfMonth: [day]
      })
    })
  }

  return [buildSchtasksCreateArgs(job)]
}

export function listTaskNamesForJob(job: ScheduledJob): string[] {
  const base = windowsTaskNameForJob(job.id)
  const schedule = job.schedule
  if (
    schedule.kind === 'monthly' &&
    schedule.monthlyMode !== 'weekday' &&
    schedule.daysOfMonth &&
    schedule.daysOfMonth.length > 1
  ) {
    return schedule.daysOfMonth.map((day, index) =>
      index === 0 ? base : `${base}-d${day}`
    )
  }
  return [base]
}

export function escapeXmlText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/**
 * Insert or replace RegistrationInfo/Description in a schtasks /Query /XML document.
 * Set-ScheduledTask cannot update Description for interactive (/IT) tasks (Access Denied).
 */
export function injectTaskDescriptionXml(xml: string, description: string): string {
  const escaped = escapeXmlText(description)
  if (/<Description(?:\s[^>]*)?>[\s\S]*?<\/Description>/i.test(xml)) {
    return xml.replace(
      /<Description(?:\s[^>]*)?>[\s\S]*?<\/Description>/i,
      `<Description>${escaped}</Description>`
    )
  }
  if (/<\/RegistrationInfo>/i.test(xml)) {
    return xml.replace(
      /<\/RegistrationInfo>/i,
      `    <Description>${escaped}</Description>\r\n  </RegistrationInfo>`
    )
  }
  throw new Error('Task XML missing RegistrationInfo')
}

function execErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error) return err.message
  if (typeof err === 'object' && err && 'stderr' in err) {
    return String((err as { stderr: Buffer | string }).stderr)
  }
  return String(err) || fallback
}

async function runSchtasks(args: string[]): Promise<TaskSchedulerResult> {
  if (process.platform !== 'win32') {
    return { ok: false, message: 'Windows Task Scheduler is only available on Windows' }
  }
  try {
    await execFileAsync('schtasks.exe', args, {
      windowsHide: true,
      timeout: 30_000,
      maxBuffer: 1024 * 1024
    })
    return { ok: true }
  } catch (err) {
    return { ok: false, message: execErrorMessage(err, 'schtasks failed').trim() || 'schtasks failed' }
  }
}

/** Decode schtasks /Query /XML stdout (UTF-16 BOM, UTF-8, or CP932 console). */
export function decodeSchtasksXml(stdout: Buffer): string {
  if (stdout.length >= 2 && stdout[0] === 0xff && stdout[1] === 0xfe) {
    return stdout.subarray(2).toString('utf16le')
  }
  if (stdout.length >= 2 && stdout[0] === 0xfe && stdout[1] === 0xff) {
    const swapped = Buffer.from(stdout.subarray(2))
    swapped.swap16()
    return swapped.toString('utf16le')
  }
  const asUtf8 = stdout.toString('utf8').replace(/^\uFEFF/, '')
  if (asUtf8.includes('<Task') && !asUtf8.includes('\uFFFD')) return asUtf8
  // Japanese Windows may deliver legacy code page bytes through the pipe.
  const asCp932 = iconv.decode(stdout, 'cp932')
  if (asCp932.includes('<Task')) return asCp932
  return asUtf8
}

async function queryTaskXml(
  taskName: string
): Promise<{ ok: true; xml: string } | { ok: false; message: string }> {
  if (process.platform !== 'win32') {
    return { ok: false, message: 'Windows Task Scheduler is only available on Windows' }
  }
  try {
    const { stdout } = await execFileAsync('schtasks.exe', ['/Query', '/TN', taskName, '/XML'], {
      windowsHide: true,
      timeout: 30_000,
      maxBuffer: 2 * 1024 * 1024,
      encoding: 'buffer'
    })
    const xml = decodeSchtasksXml(stdout)
    if (!xml.includes('<Task')) {
      return { ok: false, message: 'schtasks /Query /XML returned empty task definition' }
    }
    return { ok: true, xml }
  } catch (err) {
    return { ok: false, message: execErrorMessage(err, 'schtasks query failed').trim() || 'schtasks query failed' }
  }
}

/** Rewrite task XML with Description = job name, then re-register via schtasks /XML. */
async function setTaskDescription(
  taskName: string,
  description: string
): Promise<TaskSchedulerResult> {
  const queried = await queryTaskXml(taskName)
  if (!queried.ok) return queried

  let xml: string
  try {
    xml = injectTaskDescriptionXml(queried.xml, description)
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) }
  }

  const tmpPath = join(tmpdir(), `compass-task-${randomBytes(8).toString('hex')}.xml`)
  try {
    const payload = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(xml, 'utf16le')])
    await writeFile(tmpPath, payload)
    return await runSchtasks(['/Create', '/TN', taskName, '/XML', tmpPath, '/F'])
  } catch (err) {
    return {
      ok: false,
      message:
        execErrorMessage(err, 'failed to set task description').trim() ||
        'failed to set task description'
    }
  } finally {
    await unlink(tmpPath).catch(() => undefined)
  }
}

export async function installScheduledTask(job: ScheduledJob): Promise<TaskSchedulerResult> {
  await uninstallAllTasksForJob(job.id)

  const sets = buildSchtasksCreateArgSets(job)
  const names = listTaskNamesForJob(job)
  for (let i = 0; i < sets.length; i++) {
    const result = await runSchtasks(sets[i]!)
    if (!result.ok) return result
    const descResult = await setTaskDescription(names[i]!, job.name)
    if (!descResult.ok) return descResult
  }
  return { ok: true }
}

export async function uninstallScheduledTask(jobId: string): Promise<TaskSchedulerResult> {
  return runSchtasks(['/Delete', '/TN', windowsTaskNameForJob(jobId), '/F'])
}

/** Best-effort: ignore "not found" on delete */
export async function uninstallScheduledTaskIfPresent(jobId: string): Promise<TaskSchedulerResult> {
  const result = await uninstallScheduledTask(jobId)
  if (result.ok) return result
  if (/cannot find|does not exist|存在しません|見つかりません/i.test(result.message)) {
    return { ok: true }
  }
  return result
}

/** Remove primary task and any monthly day-suffix tasks for a job id. */
export async function uninstallAllTasksForJob(jobId: string): Promise<TaskSchedulerResult> {
  await uninstallScheduledTaskIfPresent(jobId)
  for (let day = 1; day <= 31; day++) {
    await uninstallScheduledTaskIfPresent(`${jobId}-d${day}`)
  }
  return { ok: true }
}

export async function syncJobWithTaskScheduler(job: ScheduledJob): Promise<TaskSchedulerResult> {
  if (!job.enabled) {
    return uninstallAllTasksForJob(job.id)
  }
  return installScheduledTask(job)
}
