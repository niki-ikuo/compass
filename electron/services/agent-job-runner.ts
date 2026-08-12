import { existsSync } from 'fs'
import { mkdir, readdir, stat, writeFile } from 'fs/promises'
import { join } from 'path'
import type { WebContents } from 'electron'
import type {
  AgentNeedApprovalEvent,
  AgentNeedContinueEvent,
  AgentNeedExecApprovalEvent,
  ScheduledJob,
  ScheduledJobPolicy,
  ScheduledJobRunResult,
  WorkspaceAction
} from '../../src/types'
import {
  scheduledJobPolicyAllowsExec,
  scheduledJobPolicyAppliesFiles
} from '../../src/types'
import { shouldAutoApplyAgentProposal } from '../../src/utils/agent-auto-apply'
import { resolveAgentApproval, resolveAgentContinue } from './agent-approval'
import { runAgent } from './agent-runner'
import { applyWorkspaceActionsRecordingUndo } from './ai-undo'
import { setActiveWorkspaceRoot } from './path-guard'
import { getScheduledJob, updateScheduledJobRunState } from './scheduled-jobs'

const HEADLESS_WC_ID = 910_001
const MAX_AUTO_CONTINUES = 2
const SKIP_DIR_NAMES = new Set(['.compass', '.git', 'node_modules', '.hg', '.svn'])

const runningJobIds = new Set<string>()
const workspaceLocks = new Set<string>()

type RunStats = {
  execRejected: number
  execApproved: number
  /** toolStart name===exec (includes commands that did not need approval) */
  execStarts: number
  proposeApplied: number
  proposeRejected: number
  toolStarts: number
}

const HEADLESS_TASK_PREFIX = [
  '[Scheduled unattended run]',
  'Complete the user task using tools. Do not stop with only a chat reply.',
  'If the task should create or update files in the workspace, make sure those files exist before you finish.',
  ''
].join('\n')

function stampRunId(date = new Date()): string {
  return date.toISOString().replace(/[:.]/g, '-').replace(/Z$/, 'Z')
}

function createRunDir(workspaceRoot: string, runId: string): string {
  return join(workspaceRoot, '.compass', 'runs', runId)
}

async function appendLog(lines: string[], line: string): Promise<void> {
  lines.push(`[${new Date().toISOString()}] ${line}`)
}

export function canAutoApplyForJobPolicy(
  policy: ScheduledJob['policy'],
  actions: WorkspaceAction[]
): boolean {
  if (!scheduledJobPolicyAppliesFiles(policy)) return false
  return shouldAutoApplyAgentProposal(true, actions)
}

export function evaluateScheduledJobOutcome(input: {
  doneChannel: 'ai:done' | 'ai:error' | 'ai:aborted' | null
  doneDetail?: string
  changedFiles: string[]
  policy: ScheduledJobPolicy
  stats: RunStats
}): { ok: boolean; error?: string; message: string } {
  const { doneChannel, doneDetail, changedFiles, policy, stats } = input

  if (doneChannel === 'ai:error' || doneChannel === 'ai:aborted') {
    const error = doneDetail || 'Agent error'
    return { ok: false, error, message: error }
  }

  if (changedFiles.length > 0) {
    return {
      ok: true,
      message: `Completed with ${changedFiles.length} file change(s)`
    }
  }

  // report-only: workspace writes are not required
  if (policy === 'report-only') {
    return { ok: true, message: 'Completed' }
  }

  // auto-apply-files: needing exec but rejecting it with no writes is a hard failure
  if (policy === 'auto-apply-files' && stats.execRejected > 0) {
    const error =
      'Exec was rejected and no files were written. Use policy “full-unattended” if scripts must run, or “auto-apply-safe” to skip exec without failing.'
    return { ok: false, error, message: error }
  }

  // Exec ran (approved or allowed without approval UI) but produced no workspace changes
  if (stats.execStarts > 0 || stats.execApproved > 0) {
    const error = 'Exec ran but no workspace files changed.'
    return { ok: false, error, message: error }
  }

  // auto-apply-safe: skipped dangerous exec with no other work is acceptable
  if (policy === 'auto-apply-safe' && stats.execRejected > 0) {
    return { ok: true, message: 'Completed (dangerous exec skipped)' }
  }

  // File-writing policies: chatting with no tools / no side effects is a failure
  // (matches flaky “Run now” runs that finish in one text-only turn).
  if (scheduledJobPolicyAppliesFiles(policy)) {
    const error =
      stats.toolStarts === 0
        ? 'Agent finished without using tools or changing any workspace files.'
        : 'Agent finished without changing any workspace files.'
    return { ok: false, error, message: error }
  }

  return { ok: true, message: 'Completed' }
}

/** Files modified at/after `sinceMs` (excludes .compass / VCS / node_modules). */
export async function collectWorkspaceChangesSince(
  workspaceRoot: string,
  sinceMs: number
): Promise<string[]> {
  const changed: string[] = []
  const skewMs = 1500

  async function walk(dir: string, rel: string): Promise<void> {
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (SKIP_DIR_NAMES.has(entry.name)) continue
      const abs = join(dir, entry.name)
      const nextRel = rel ? `${rel}/${entry.name}` : entry.name
      if (entry.isDirectory()) {
        await walk(abs, nextRel)
        continue
      }
      if (!entry.isFile()) continue
      try {
        const info = await stat(abs)
        if (info.mtimeMs >= sinceMs - skewMs) changed.push(nextRel.replace(/\\/g, '/'))
      } catch {
        // ignore
      }
    }
  }

  await walk(workspaceRoot, '')
  return changed
}

async function writeRunArtifacts(
  runDir: string,
  job: ScheduledJob,
  logLines: string[],
  result: Omit<ScheduledJobRunResult, 'jobId' | 'runDir'>,
  stats: RunStats
): Promise<void> {
  await mkdir(runDir, { recursive: true })
  const status = {
    ok: result.ok,
    status: result.status,
    error: result.error ?? null,
    changedFiles: result.changedFiles,
    message: result.message,
    jobId: job.id,
    jobName: job.name,
    policy: job.policy,
    allowExec: scheduledJobPolicyAllowsExec(job.policy),
    stats,
    finishedAt: new Date().toISOString()
  }
  await writeFile(join(runDir, 'status.json'), `${JSON.stringify(status, null, 2)}\n`, 'utf8')
  await writeFile(join(runDir, 'run.log'), `${logLines.join('\n')}\n`, 'utf8')

  const report = [
    `# Scheduled job: ${job.name}`,
    '',
    `- Status: **${result.status}**`,
    `- Policy: \`${job.policy}\``,
    `- Workspace: \`${job.workspaceRoot}\``,
    `- Finished: ${status.finishedAt}`,
    '',
    '## Message',
    '',
    result.message,
    '',
    '## Changed files',
    '',
    result.changedFiles.length > 0
      ? result.changedFiles.map((p) => `- \`${p}\``).join('\n')
      : '_None_',
    '',
    result.error ? `## Error\n\n\`\`\`\n${result.error}\n\`\`\`\n` : ''
  ].join('\n')
  await writeFile(join(runDir, 'report.md'), report, 'utf8')
}

function createHeadlessBridge(options: {
  job: ScheduledJob
  chatId: string
  workspaceRoot: string
  logLines: string[]
  changedFiles: string[]
  stats: RunStats
  onTerminal: (channel: 'ai:done' | 'ai:error' | 'ai:aborted', detail?: string) => void
}): WebContents {
  let autoContinues = 0
  const { job, chatId, workspaceRoot, logLines, changedFiles, stats, onTerminal } = options

  const handleNeedApproval = (event: AgentNeedApprovalEvent): void => {
    void (async () => {
      await appendLog(logLines, `proposeActions (${event.actions.length} action(s))`)
      if (!canAutoApplyForJobPolicy(job.policy, event.actions)) {
        stats.proposeRejected += 1
        const reason =
          job.policy === 'report-only'
            ? 'Rejected: job policy is report-only (file writes are not applied).'
            : 'Rejected: proposal includes deletes or sensitive paths.'
        await appendLog(logLines, reason)
        resolveAgentApproval({
          id: event.id,
          approved: false,
          detail: `${reason} Stop or revise without those actions.`
        })
        return
      }

      try {
        await applyWorkspaceActionsRecordingUndo(workspaceRoot, event.actions, {
          undo: { chatId, source: 'preview-all' }
        })
        for (const action of event.actions) {
          if (typeof action.path === 'string' && action.path.trim()) {
            changedFiles.push(action.path)
          }
        }
        stats.proposeApplied += 1
        const detail =
          `Headless job auto-applied ${event.actions.length} action(s):\n` +
          event.actions.map((a) => `- ${a.type}: ${a.path}`).join('\n')
        await appendLog(logLines, detail)
        resolveAgentApproval({ id: event.id, approved: true, detail })
      } catch (err) {
        stats.proposeRejected += 1
        const message = err instanceof Error ? err.message : String(err)
        await appendLog(logLines, `Apply failed: ${message}`)
        resolveAgentApproval({
          id: event.id,
          approved: false,
          detail: `Headless apply failed: ${message}`
        })
      }
    })()
  }

  const handleNeedExecApproval = (event: AgentNeedExecApprovalEvent): void => {
    void (async () => {
      if (scheduledJobPolicyAllowsExec(job.policy)) {
        stats.execApproved += 1
        const detail = `Approved exec (full-unattended): ${event.command} (${event.reason})`
        await appendLog(logLines, detail)
        resolveAgentApproval({ id: event.id, approved: true, detail })
        return
      }
      stats.execRejected += 1
      const mode =
        job.policy === 'auto-apply-safe'
          ? 'Skipped dangerous exec (auto-apply-safe)'
          : `Rejected exec (${job.policy})`
      const detail = `${mode}: ${event.command} (${event.reason})`
      await appendLog(logLines, detail)
      resolveAgentApproval({ id: event.id, approved: false, detail })
    })()
  }

  const handleNeedContinue = (event: AgentNeedContinueEvent): void => {
    void (async () => {
      if (autoContinues >= MAX_AUTO_CONTINUES) {
        await appendLog(logLines, `Continue denied (max ${MAX_AUTO_CONTINUES} reached)`)
        resolveAgentContinue({ id: event.id, continue: false })
        return
      }
      autoContinues += 1
      await appendLog(
        logLines,
        `Auto-continue #${autoContinues} (${event.reason}; turns=${event.turnsUsed}, tools=${event.toolsUsed})`
      )
      resolveAgentContinue({ id: event.id, continue: true })
    })()
  }

  return {
    id: HEADLESS_WC_ID,
    send: (channel: string, _chatId: string, ...payload: unknown[]) => {
      if (channel === 'ai:needApproval') {
        setImmediate(() => handleNeedApproval(payload[0] as AgentNeedApprovalEvent))
        return
      }
      if (channel === 'ai:needExecApproval') {
        setImmediate(() => handleNeedExecApproval(payload[0] as AgentNeedExecApprovalEvent))
        return
      }
      if (channel === 'ai:needContinue') {
        setImmediate(() => handleNeedContinue(payload[0] as AgentNeedContinueEvent))
        return
      }
      if (channel === 'ai:step') {
        const label =
          payload[0] && typeof payload[0] === 'object' && 'label' in payload[0]
            ? String((payload[0] as { label: string }).label)
            : ''
        if (label) void appendLog(logLines, `step: ${label}`)
        return
      }
      if (channel === 'ai:toolStart') {
        const name =
          payload[0] && typeof payload[0] === 'object' && 'name' in payload[0]
            ? String((payload[0] as { name: string }).name)
            : 'tool'
        stats.toolStarts += 1
        if (name === 'exec') stats.execStarts += 1
        void appendLog(logLines, `toolStart: ${name}`)
        return
      }
      if (channel === 'ai:error') {
        const detail = typeof payload[0] === 'string' ? payload[0] : 'Unknown error'
        void appendLog(logLines, `error: ${detail}`)
        onTerminal('ai:error', detail)
        return
      }
      if (channel === 'ai:aborted') {
        void appendLog(logLines, 'aborted')
        onTerminal('ai:aborted')
        return
      }
      if (channel === 'ai:done') {
        void appendLog(logLines, 'done')
        onTerminal('ai:done')
      }
    }
  } as unknown as WebContents
}

export async function runScheduledJob(job: ScheduledJob): Promise<ScheduledJobRunResult> {
  const runId = stampRunId()
  const runDir = createRunDir(job.workspaceRoot, runId)
  const logLines: string[] = []
  const changedFiles: string[] = []
  const stats: RunStats = {
    execRejected: 0,
    execApproved: 0,
    execStarts: 0,
    proposeApplied: 0,
    proposeRejected: 0,
    toolStarts: 0
  }
  const chatId = `job-${job.id}-${runId}`

  if (runningJobIds.has(job.id)) {
    return {
      ok: false,
      jobId: job.id,
      runDir,
      status: 'error',
      error: 'Job is already running',
      changedFiles: [],
      message: 'Job is already running'
    }
  }

  const lockKey = job.workspaceRoot.toLowerCase()
  if (workspaceLocks.has(lockKey)) {
    return {
      ok: false,
      jobId: job.id,
      runDir,
      status: 'error',
      error: 'Another scheduled job is running in this workspace',
      changedFiles: [],
      message: 'Another scheduled job is running in this workspace'
    }
  }

  if (!existsSync(job.workspaceRoot)) {
    const message = `Workspace folder not found: ${job.workspaceRoot}`
    try {
      await mkdir(runDir, { recursive: true })
      await appendLog(logLines, message)
      const result: ScheduledJobRunResult = {
        ok: false,
        jobId: job.id,
        runDir,
        status: 'error',
        error: message,
        changedFiles: [],
        message
      }
      await writeRunArtifacts(runDir, job, logLines, result, stats)
      await updateScheduledJobRunState(job.id, {
        lastRunAt: new Date().toISOString(),
        lastRunStatus: 'error',
        lastRunError: message,
        lastRunDir: runDir
      })
      return result
    } catch {
      return {
        ok: false,
        jobId: job.id,
        runDir,
        status: 'error',
        error: message,
        changedFiles: [],
        message
      }
    }
  }

  runningJobIds.add(job.id)
  workspaceLocks.add(lockKey)

  try {
    await updateScheduledJobRunState(job.id, {
      lastRunAt: new Date().toISOString(),
      lastRunStatus: 'running',
      lastRunError: null,
      lastRunDir: runDir
    })

    await mkdir(runDir, { recursive: true })
    const startedAtMs = Date.now()
    await appendLog(logLines, `Start job "${job.name}" (${job.id})`)
    await appendLog(logLines, `Workspace: ${job.workspaceRoot}`)
    await appendLog(
      logLines,
      `Policy: ${job.policy}; exec: ${scheduledJobPolicyAllowsExec(job.policy) ? 'auto-approve' : 'deny/skip'}`
    )

    setActiveWorkspaceRoot(job.workspaceRoot)

    let doneChannel: 'ai:done' | 'ai:error' | 'ai:aborted' | null = null
    let doneDetail: string | undefined
    let resolveDone!: () => void
    const donePromise = new Promise<void>((r) => {
      resolveDone = r
    })

    const webContents = createHeadlessBridge({
      job,
      chatId,
      workspaceRoot: job.workspaceRoot,
      logLines,
      changedFiles,
      stats,
      onTerminal: (channel, detail) => {
        if (doneChannel) return
        doneChannel = channel
        doneDetail = detail ?? (channel === 'ai:aborted' ? 'Aborted' : undefined)
        resolveDone()
      }
    })

    try {
      await runAgent(webContents, {
        chatId,
        mode: 'agent',
        workspaceRoot: job.workspaceRoot,
        preset: job.preset,
        messages: [{ role: 'user', content: `${HEADLESS_TASK_PREFIX}${job.prompt}` }]
      })
      await Promise.race([donePromise, new Promise<void>((r) => setTimeout(r, 500))])
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      doneChannel = 'ai:error'
      doneDetail = message
      await appendLog(logLines, `runAgent threw: ${message}`)
    }

    // Shell redirects / script side effects are not proposeActions — pick them up from mtime.
    try {
      const fsChanged = await collectWorkspaceChangesSince(job.workspaceRoot, startedAtMs)
      for (const path of fsChanged) {
        if (!changedFiles.includes(path)) changedFiles.push(path)
      }
      if (fsChanged.length > 0) {
        await appendLog(logLines, `Filesystem changes detected: ${fsChanged.join(', ')}`)
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      await appendLog(logLines, `Filesystem scan failed: ${message}`)
    }

    const uniqueChanged = [...new Set(changedFiles)]
    const outcome = evaluateScheduledJobOutcome({
      doneChannel,
      doneDetail,
      changedFiles: uniqueChanged,
      policy: job.policy,
      stats
    })

    const result: ScheduledJobRunResult = {
      ok: outcome.ok,
      jobId: job.id,
      runDir,
      status: outcome.ok ? 'ok' : 'error',
      error: outcome.error,
      changedFiles: uniqueChanged,
      message: outcome.message
    }

    await writeRunArtifacts(runDir, job, logLines, result, stats)
    await updateScheduledJobRunState(job.id, {
      lastRunAt: new Date().toISOString(),
      lastRunStatus: result.status,
      lastRunError: result.error ?? null,
      lastRunDir: runDir
    })
    return result
  } finally {
    runningJobIds.delete(job.id)
    workspaceLocks.delete(lockKey)
  }
}

export async function runScheduledJobById(jobId: string): Promise<ScheduledJobRunResult> {
  const job = await getScheduledJob(jobId)
  if (!job) {
    return {
      ok: false,
      jobId,
      runDir: '',
      status: 'error',
      error: `Job not found: ${jobId}`,
      changedFiles: [],
      message: `Job not found: ${jobId}`
    }
  }
  return runScheduledJob(job)
}

export function isScheduledJobRunning(jobId: string): boolean {
  return runningJobIds.has(jobId)
}
