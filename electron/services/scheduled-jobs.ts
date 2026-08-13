import { randomUUID } from 'crypto'
import { existsSync } from 'fs'
import { mkdir, readFile, writeFile } from 'fs/promises'
import { dirname, join, resolve } from 'path'
import { app } from 'electron'
import type {
  ScheduledJob,
  ScheduledJobInput,
  ScheduledJobPolicy,
  ScheduledJobSchedule,
  UseCasePreset
} from '../../src/types'
import {
  normalizeScheduledJobPolicy,
  normalizeUseCasePreset,
  scheduledJobPolicyAllowsExec
} from '../../src/types'
import {
  assertValidScheduledJobSchedule,
  defaultScheduledJobSchedule,
  migrateLegacySchedule,
  normalizeScheduledJobSchedule
} from '../../src/utils/scheduled-job-schedule'

/** Resolve policy from stored fields; migrate legacy allowExec-only jobs. */
export function resolveScheduledJobPolicy(
  policyRaw: unknown,
  allowExecRaw: unknown
): ScheduledJobPolicy {
  const policy = normalizeScheduledJobPolicy(policyRaw)
  if (policy === 'full-unattended') return policy
  if (policy && allowExecRaw === true && policy === 'auto-apply-files') {
    return 'full-unattended'
  }
  if (policy) return policy
  if (allowExecRaw === true) return 'full-unattended'
  return 'auto-apply-files'
}

const JOBS_FILE = 'scheduled-jobs.json'

export function getScheduledJobsPath(): string {
  return join(app.getPath('userData'), JOBS_FILE)
}

function resolveSchedule(raw: Record<string, unknown>): ScheduledJobSchedule | null {
  const fromObject = normalizeScheduledJobSchedule(raw.schedule)
  if (fromObject) return fromObject
  return migrateLegacySchedule(raw)
}

export function normalizeScheduledJob(raw: unknown): ScheduledJob | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const id = typeof o.id === 'string' ? o.id.trim() : ''
  const name = typeof o.name === 'string' ? o.name.trim() : ''
  const workspaceRoot = typeof o.workspaceRoot === 'string' ? o.workspaceRoot.trim() : ''
  const prompt = typeof o.prompt === 'string' ? o.prompt : ''
  const policy = resolveScheduledJobPolicy(o.policy, o.allowExec)
  const preset = normalizeUseCasePreset(o.preset) ?? 'general'
  const createdAt = typeof o.createdAt === 'string' ? o.createdAt : new Date().toISOString()
  const updatedAt = typeof o.updatedAt === 'string' ? o.updatedAt : createdAt
  const schedule = resolveSchedule(o)
  if (!id || !name || !workspaceRoot || !prompt.trim() || !schedule) return null

  const job: ScheduledJob = {
    id,
    name,
    enabled: o.enabled === true,
    workspaceRoot: resolve(workspaceRoot),
    prompt,
    preset,
    policy,
    allowExec: scheduledJobPolicyAllowsExec(policy),
    schedule,
    createdAt,
    updatedAt
  }

  if (typeof o.rolePrompt === 'string' && o.rolePrompt.trim()) {
    job.rolePrompt = o.rolePrompt.trim()
  }

  if (typeof o.lastRunAt === 'string') job.lastRunAt = o.lastRunAt
  if (o.lastRunStatus === 'ok' || o.lastRunStatus === 'error' || o.lastRunStatus === 'running') {
    job.lastRunStatus = o.lastRunStatus
  }
  if (typeof o.lastRunError === 'string') job.lastRunError = o.lastRunError
  if (typeof o.lastRunDir === 'string') job.lastRunDir = o.lastRunDir

  return job
}

async function readJobsFile(): Promise<ScheduledJob[]> {
  const path = getScheduledJobsPath()
  if (!existsSync(path)) return []
  try {
    const raw = JSON.parse(await readFile(path, 'utf8')) as unknown
    const list = Array.isArray(raw)
      ? raw
      : Array.isArray((raw as { jobs?: unknown }).jobs)
        ? (raw as { jobs: unknown[] }).jobs
        : []
    return list.map(normalizeScheduledJob).filter((j): j is ScheduledJob => j !== null)
  } catch {
    return []
  }
}

async function writeJobsFile(jobs: ScheduledJob[]): Promise<void> {
  const path = getScheduledJobsPath()
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify({ version: 1, jobs }, null, 2)}\n`, 'utf8')
}

export async function listScheduledJobs(): Promise<ScheduledJob[]> {
  const jobs = await readJobsFile()
  return jobs.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
}

export async function getScheduledJob(id: string): Promise<ScheduledJob | null> {
  const jobs = await readJobsFile()
  return jobs.find((j) => j.id === id) ?? null
}

export function buildScheduledJobFromInput(
  input: ScheduledJobInput,
  existing?: ScheduledJob
): ScheduledJob {
  const now = new Date().toISOString()
  const policy: ScheduledJobPolicy = resolveScheduledJobPolicy(
    input.policy ?? existing?.policy,
    input.allowExec ?? existing?.allowExec
  )
  const preset: UseCasePreset =
    normalizeUseCasePreset(input.preset) ?? existing?.preset ?? 'general'
  let schedule = normalizeScheduledJobSchedule(input.schedule)
  if (!schedule && input.schedule) {
    // Surface validation errors (e.g. once without startDate) instead of silently defaulting
    assertValidScheduledJobSchedule({
      kind: input.schedule.kind,
      startTime: input.schedule.startTime || '00:00',
      startDate: input.schedule.startDate,
      endDate: input.schedule.endDate,
      interval: input.schedule.interval,
      daysOfWeek: input.schedule.daysOfWeek,
      monthlyMode: input.schedule.monthlyMode,
      daysOfMonth: input.schedule.daysOfMonth,
      monthlyWeek: input.schedule.monthlyWeek,
      monthlyWeekday: input.schedule.monthlyWeekday,
      months: input.schedule.months
    })
    throw new Error('Invalid schedule')
  }
  schedule = schedule ?? existing?.schedule ?? defaultScheduledJobSchedule()
  assertValidScheduledJobSchedule(schedule)

  const name = input.name.trim()
  const workspaceRoot = resolve(input.workspaceRoot.trim())
  const prompt = input.prompt
  const rolePrompt = (
    input.rolePrompt !== undefined ? input.rolePrompt : (existing?.rolePrompt ?? '')
  ).trim()
  if (!name) throw new Error('Job name is required')
  if (!workspaceRoot) throw new Error('Workspace folder is required')
  if (!prompt.trim()) throw new Error('Prompt is required')

  const job: ScheduledJob = {
    id: (input.id ?? existing?.id ?? randomUUID()).trim(),
    name,
    enabled: input.enabled === true,
    workspaceRoot,
    prompt,
    preset,
    policy,
    allowExec: scheduledJobPolicyAllowsExec(policy),
    schedule,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    lastRunAt: existing?.lastRunAt,
    lastRunStatus: existing?.lastRunStatus,
    lastRunError: existing?.lastRunError,
    lastRunDir: existing?.lastRunDir
  }
  if (rolePrompt) job.rolePrompt = rolePrompt
  return job
}

export async function saveScheduledJob(input: ScheduledJobInput): Promise<ScheduledJob> {
  const jobs = await readJobsFile()
  const existing = input.id ? jobs.find((j) => j.id === input.id) : undefined
  const job = buildScheduledJobFromInput(input, existing)
  const next = existing ? jobs.map((j) => (j.id === job.id ? job : j)) : [...jobs, job]
  await writeJobsFile(next)
  return job
}

export async function deleteScheduledJob(id: string): Promise<boolean> {
  const jobs = await readJobsFile()
  const next = jobs.filter((j) => j.id !== id)
  if (next.length === jobs.length) return false
  await writeJobsFile(next)
  return true
}

export async function updateScheduledJobRunState(
  id: string,
  patch: {
    lastRunAt?: string
    lastRunStatus?: ScheduledJob['lastRunStatus']
    lastRunError?: string | null
    lastRunDir?: string
  }
): Promise<ScheduledJob | null> {
  const jobs = await readJobsFile()
  const idx = jobs.findIndex((j) => j.id === id)
  if (idx < 0) return null
  const updated: ScheduledJob = {
    ...jobs[idx],
    updatedAt: new Date().toISOString()
  }
  if (patch.lastRunAt !== undefined) updated.lastRunAt = patch.lastRunAt
  if (patch.lastRunStatus !== undefined) updated.lastRunStatus = patch.lastRunStatus
  if (patch.lastRunDir !== undefined) updated.lastRunDir = patch.lastRunDir
  if (patch.lastRunError === null) delete updated.lastRunError
  else if (patch.lastRunError !== undefined) updated.lastRunError = patch.lastRunError
  jobs[idx] = updated
  await writeJobsFile(jobs)
  return updated
}

export function windowsTaskNameForJob(jobId: string): string {
  return `Compass\\job-${jobId}`
}
