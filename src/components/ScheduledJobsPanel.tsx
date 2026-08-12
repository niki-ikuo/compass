import { useCallback, useEffect, useState } from 'react'
import type {
  ScheduledJob,
  ScheduledJobInput,
  ScheduledJobMonthlyWeek,
  ScheduledJobPolicy,
  ScheduledJobSchedule,
  ScheduledJobScheduleKind,
  UseCasePreset
} from '@/types'
import { useI18n, type MessageKey } from '@/i18n'
import { USE_CASE_PRESET_OPTIONS } from '@/utils/use-case-preset'
import { useAppStore } from '@/stores/app-store'
import {
  defaultScheduledJobSchedule,
  todayIsoDate
} from '@/utils/scheduled-job-schedule'

const DAY_KEYS: MessageKey[] = [
  'jobs.daySun',
  'jobs.dayMon',
  'jobs.dayTue',
  'jobs.dayWed',
  'jobs.dayThu',
  'jobs.dayFri',
  'jobs.daySat'
]

const MONTH_KEYS: MessageKey[] = [
  'jobs.monthJan',
  'jobs.monthFeb',
  'jobs.monthMar',
  'jobs.monthApr',
  'jobs.monthMay',
  'jobs.monthJun',
  'jobs.monthJul',
  'jobs.monthAug',
  'jobs.monthSep',
  'jobs.monthOct',
  'jobs.monthNov',
  'jobs.monthDec'
]

const WEEK_OPTIONS: Array<{ id: ScheduledJobMonthlyWeek; labelKey: MessageKey }> = [
  { id: 'FIRST', labelKey: 'jobs.monthlyWeekFirst' },
  { id: 'SECOND', labelKey: 'jobs.monthlyWeekSecond' },
  { id: 'THIRD', labelKey: 'jobs.monthlyWeekThird' },
  { id: 'FOURTH', labelKey: 'jobs.monthlyWeekFourth' },
  { id: 'LAST', labelKey: 'jobs.monthlyWeekLast' }
]

const POLICY_OPTIONS: Array<{ id: ScheduledJobPolicy; labelKey: MessageKey }> = [
  { id: 'report-only', labelKey: 'jobs.policyReportOnly' },
  { id: 'auto-apply-files', labelKey: 'jobs.policyAutoApplyFiles' },
  { id: 'auto-apply-safe', labelKey: 'jobs.policyAutoApplySafe' },
  { id: 'full-unattended', labelKey: 'jobs.policyFullUnattended' }
]

const SCHEDULE_KIND_OPTIONS: Array<{ id: ScheduledJobScheduleKind; labelKey: MessageKey }> = [
  { id: 'once', labelKey: 'jobs.schedule.once' },
  { id: 'daily', labelKey: 'jobs.schedule.daily' },
  { id: 'weekly', labelKey: 'jobs.schedule.weekly' },
  { id: 'monthly', labelKey: 'jobs.schedule.monthly' }
]

type Draft = {
  id?: string
  name: string
  enabled: boolean
  workspaceRoot: string
  prompt: string
  preset: UseCasePreset
  policy: ScheduledJobPolicy
  schedule: ScheduledJobSchedule
}

function emptyDraft(workspaceRoot: string): Draft {
  return {
    name: '',
    enabled: true,
    workspaceRoot,
    prompt: '',
    preset: 'general',
    policy: 'auto-apply-safe',
    schedule: defaultScheduledJobSchedule()
  }
}

function jobToDraft(job: ScheduledJob): Draft {
  return {
    id: job.id,
    name: job.name,
    enabled: job.enabled,
    workspaceRoot: job.workspaceRoot,
    prompt: job.prompt,
    preset: job.preset,
    policy: job.policy,
    schedule: { ...job.schedule }
  }
}

function draftToInput(draft: Draft): ScheduledJobInput {
  return {
    id: draft.id,
    name: draft.name,
    enabled: draft.enabled,
    workspaceRoot: draft.workspaceRoot,
    prompt: draft.prompt,
    preset: draft.preset,
    policy: draft.policy,
    allowExec: draft.policy === 'full-unattended',
    schedule: draft.schedule
  }
}

function toggleNumberInList(list: number[] | undefined, value: number, sorted = true): number[] {
  const set = new Set(list ?? [])
  if (set.has(value)) set.delete(value)
  else set.add(value)
  const next = [...set]
  return sorted ? next.sort((a, b) => a - b) : next
}

function formatScheduleSummary(
  schedule: ScheduledJobSchedule,
  t: (key: MessageKey, params?: Record<string, string | number>) => string
): string {
  const time = schedule.startTime
  if (schedule.kind === 'once') {
    return t('jobs.scheduleSummary.once', {
      date: schedule.startDate ?? '-',
      time
    })
  }
  if (schedule.kind === 'daily') {
    return t('jobs.scheduleSummary.daily', {
      interval: schedule.interval ?? 1,
      time
    })
  }
  if (schedule.kind === 'weekly') {
    const days = (schedule.daysOfWeek ?? [])
      .map((d) => t(DAY_KEYS[d] ?? 'jobs.dayMon'))
      .join(',')
    return t('jobs.scheduleSummary.weekly', {
      interval: schedule.interval ?? 1,
      days: days || '-',
      time
    })
  }
  if (schedule.monthlyMode === 'weekday') {
    const weekKey =
      WEEK_OPTIONS.find((w) => w.id === schedule.monthlyWeek)?.labelKey ?? 'jobs.monthlyWeekFirst'
    return t('jobs.scheduleSummary.monthlyWeekday', {
      week: t(weekKey),
      day: t(DAY_KEYS[schedule.monthlyWeekday ?? 1] ?? 'jobs.dayMon'),
      time
    })
  }
  const days = (schedule.daysOfMonth ?? []).join(',')
  return t('jobs.scheduleSummary.monthlyDays', {
    days: days || '1',
    time
  })
}

function formatLastRun(
  job: ScheduledJob,
  t: (key: MessageKey, params?: Record<string, string | number>) => string
): string {
  if (!job.lastRunAt && !job.lastRunStatus) return t('jobs.neverRun')
  const status =
    job.lastRunStatus === 'ok'
      ? t('jobs.statusOk')
      : job.lastRunStatus === 'error'
        ? t('jobs.statusError')
        : job.lastRunStatus === 'running'
          ? t('jobs.statusRunning')
          : ''
  const when = job.lastRunAt ? new Date(job.lastRunAt).toLocaleString() : ''
  return [status, when].filter(Boolean).join(' · ')
}

function setScheduleKind(schedule: ScheduledJobSchedule, kind: ScheduledJobScheduleKind): ScheduledJobSchedule {
  const base: ScheduledJobSchedule = {
    kind,
    startTime: schedule.startTime || '09:00',
    startDate: schedule.startDate || todayIsoDate(),
    endDate: schedule.endDate
  }
  if (kind === 'once') return base
  if (kind === 'daily') return { ...base, interval: schedule.interval ?? 1 }
  if (kind === 'weekly') {
    return {
      ...base,
      interval: schedule.interval ?? 1,
      daysOfWeek: schedule.daysOfWeek?.length ? schedule.daysOfWeek : [1]
    }
  }
  return {
    ...base,
    monthlyMode: schedule.monthlyMode ?? 'days',
    daysOfMonth: schedule.daysOfMonth?.length ? schedule.daysOfMonth : [1],
    monthlyWeek: schedule.monthlyWeek ?? 'FIRST',
    monthlyWeekday: schedule.monthlyWeekday ?? 1,
    months: schedule.months
  }
}

export function ScheduledJobsPanel() {
  const { t } = useI18n()
  const workspaceRoot = useAppStore((s) => s.workspaceRoot) ?? ''
  const [jobs, setJobs] = useState<ScheduledJob[]>([])
  const [draft, setDraft] = useState<Draft | null>(null)
  const [message, setMessage] = useState('')
  const [messageJobId, setMessageJobId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)

  const showMessage = (text: string, jobId: string | null = null): void => {
    setMessage(text)
    setMessageJobId(jobId)
  }

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      setJobs(await window.compass.jobs.list())
    } catch (err) {
      setMessage(err instanceof Error ? err.message : t('common.unknownError'))
      setMessageJobId(null)
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    void reload()
  }, [reload])

  const updateSchedule = (patch: Partial<ScheduledJobSchedule>): void => {
    if (!draft) return
    setDraft({ ...draft, schedule: { ...draft.schedule, ...patch } })
  }

  const handleSave = async (): Promise<void> => {
    if (!draft) return
    setBusy(true)
    showMessage('')
    try {
      const { scheduler } = await window.compass.jobs.save(draftToInput(draft))
      if (!scheduler.ok) {
        showMessage(t('jobs.schedulerWarn', { message: scheduler.message }))
      } else {
        showMessage(t('jobs.saved'))
      }
      setDraft(null)
      setJobs(await window.compass.jobs.list())
    } catch (err) {
      showMessage(err instanceof Error ? err.message : t('common.unknownError'))
    } finally {
      setBusy(false)
    }
  }

  const handleDelete = async (id: string): Promise<void> => {
    if (!window.confirm(t('jobs.confirmDelete'))) return
    setBusy(true)
    showMessage('')
    try {
      await window.compass.jobs.delete(id)
      if (draft?.id === id) setDraft(null)
      showMessage(t('jobs.deleted'))
      await reload()
    } catch (err) {
      showMessage(err instanceof Error ? err.message : t('common.unknownError'))
    } finally {
      setBusy(false)
    }
  }

  const handleRunNow = async (id: string): Promise<void> => {
    setBusy(true)
    showMessage(t('jobs.running'), id)
    try {
      const result = await window.compass.jobs.runNow(id)
      showMessage(
        result.ok
          ? t('jobs.runOk', { path: result.runDir || '-' })
          : t('jobs.runFailed', { message: result.error || result.message }),
        id
      )
      await reload()
    } catch (err) {
      showMessage(err instanceof Error ? err.message : t('common.unknownError'), id)
    } finally {
      setBusy(false)
    }
  }

  const handlePickFolder = async (): Promise<void> => {
    if (!draft) return
    const folder = await window.compass.fs.openFolder()
    if (folder) setDraft({ ...draft, workspaceRoot: folder })
  }

  const copyJobId = async (jobId: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(jobId)
      showMessage(t('jobs.idCopied', { id: jobId }), jobId)
    } catch {
      showMessage(t('jobs.idCopyFailed'), jobId)
    }
  }

  const schedule = draft?.schedule

  return (
    <div className="scheduled-jobs-panel">
      <p className="field-hint">{t('jobs.hint')}</p>

      <div className="scheduled-jobs-toolbar">
        <button
          type="button"
          className="btn-primary"
          disabled={busy}
          onClick={() => setDraft(emptyDraft(workspaceRoot))}
        >
          {t('jobs.add')}
        </button>
        <button
          type="button"
          className="btn-secondary"
          disabled={busy || loading}
          onClick={() => void reload()}
        >
          {t('jobs.refresh')}
        </button>
      </div>

      {loading ? (
        <p className="field-hint">{t('common.saving')}</p>
      ) : jobs.length === 0 && !draft ? (
        <p className="field-hint">{t('jobs.empty')}</p>
      ) : (
        <ul className="scheduled-jobs-list">
          {jobs.map((job) => (
            <li key={job.id} className="scheduled-jobs-item">
              <div className="scheduled-jobs-item-main">
                <strong>{job.name}</strong>
                <span className="field-hint">
                  {job.enabled ? t('jobs.enabled') : t('jobs.disabled')} ·{' '}
                  {formatScheduleSummary(job.schedule, t)} · {job.policy}
                </span>
                <span className="field-hint">{job.workspaceRoot}</span>
                <div className="scheduled-jobs-id-row">
                  <span className="field-hint">{t('jobs.id')}:</span>
                  <code className="scheduled-jobs-id">{job.id}</code>
                  <button
                    type="button"
                    className="btn-secondary scheduled-jobs-copy-btn"
                    disabled={busy}
                    onClick={() => void copyJobId(job.id)}
                  >
                    {t('jobs.copyId')}
                  </button>
                </div>
                <span className="field-hint">{formatLastRun(job, t)}</span>
                {job.lastRunError ? (
                  <span className="settings-connection-status status-error">{job.lastRunError}</span>
                ) : null}
                {message && messageJobId === job.id ? (
                  <p className="form-message scheduled-jobs-card-message">{message}</p>
                ) : null}
              </div>
              <div className="scheduled-jobs-item-actions">
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={busy}
                  onClick={() => setDraft(jobToDraft(job))}
                >
                  {t('jobs.edit')}
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={busy || job.lastRunStatus === 'running'}
                  onClick={() => void handleRunNow(job.id)}
                >
                  {t('jobs.runNow')}
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={busy}
                  onClick={() => void handleDelete(job.id)}
                >
                  {t('common.delete')}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {draft && schedule && (
        <div className="scheduled-jobs-editor">
          <h3>{draft.id ? t('jobs.edit') : t('jobs.add')}</h3>
          {draft.id ? (
            <div className="scheduled-jobs-id-field">
              <span className="field-hint">{t('jobs.id')}</span>
              <div className="scheduled-jobs-id-row">
                <code className="scheduled-jobs-id">{draft.id}</code>
                <button
                  type="button"
                  className="btn-secondary scheduled-jobs-copy-btn"
                  disabled={busy}
                  onClick={() => void copyJobId(draft.id!)}
                >
                  {t('jobs.copyId')}
                </button>
              </div>
            </div>
          ) : null}
          <label>
            {t('jobs.name')}
            <input
              type="text"
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
          </label>
          <label>
            {t('jobs.workspace')}
            <div className="scheduled-jobs-path-row">
              <input
                type="text"
                value={draft.workspaceRoot}
                onChange={(e) => setDraft({ ...draft, workspaceRoot: e.target.value })}
              />
              <button type="button" className="btn-secondary" onClick={() => void handlePickFolder()}>
                {t('jobs.browse')}
              </button>
            </div>
          </label>
          <label>
            {t('jobs.prompt')}
            <textarea
              rows={5}
              value={draft.prompt}
              onChange={(e) => setDraft({ ...draft, prompt: e.target.value })}
            />
          </label>
          <label>
            {t('jobs.preset')}
            <select
              value={draft.preset}
              onChange={(e) => setDraft({ ...draft, preset: e.target.value as UseCasePreset })}
            >
              {USE_CASE_PRESET_OPTIONS.map((opt) => (
                <option key={opt.id} value={opt.id}>
                  {t(opt.labelKey)}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t('jobs.policy')}
            <select
              value={draft.policy}
              onChange={(e) =>
                setDraft({ ...draft, policy: e.target.value as ScheduledJobPolicy })
              }
            >
              {POLICY_OPTIONS.map((opt) => (
                <option key={opt.id} value={opt.id}>
                  {t(opt.labelKey)}
                </option>
              ))}
            </select>
            <span className="field-hint">{t('jobs.policyHint')}</span>
          </label>

          <fieldset className="scheduled-jobs-schedule">
            <legend>{t('jobs.scheduleTitle')}</legend>
            <p className="field-hint">{t('jobs.scheduleHint')}</p>

            <label>
              {t('jobs.schedule.settings')}
              <select
                value={schedule.kind}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    schedule: setScheduleKind(schedule, e.target.value as ScheduledJobScheduleKind)
                  })
                }
              >
                {SCHEDULE_KIND_OPTIONS.map((opt) => (
                  <option key={opt.id} value={opt.id}>
                    {t(opt.labelKey)}
                  </option>
                ))}
              </select>
            </label>

            <label>
              {t('jobs.schedule.startTime')}
              <input
                type="time"
                value={schedule.startTime}
                onChange={(e) => updateSchedule({ startTime: e.target.value || '09:00' })}
              />
            </label>

            <label>
              {t('jobs.schedule.startDate')}
              <input
                type="date"
                value={schedule.startDate ?? ''}
                required={schedule.kind === 'once'}
                onChange={(e) =>
                  updateSchedule({ startDate: e.target.value || undefined })
                }
              />
              <span className="field-hint">{t('jobs.schedule.startDateHint')}</span>
            </label>

            <label>
              {t('jobs.schedule.endDate')}
              <input
                type="date"
                value={schedule.endDate ?? ''}
                onChange={(e) => updateSchedule({ endDate: e.target.value || undefined })}
              />
              <span className="field-hint">{t('jobs.schedule.endDateHint')}</span>
            </label>

            {schedule.kind === 'daily' && (
              <label>
                {t('jobs.schedule.recurEveryDays')}
                <input
                  type="number"
                  min={1}
                  max={365}
                  value={schedule.interval ?? 1}
                  onChange={(e) =>
                    updateSchedule({
                      interval: Math.max(1, Math.min(365, Number(e.target.value) || 1))
                    })
                  }
                />
              </label>
            )}

            {schedule.kind === 'weekly' && (
              <>
                <label>
                  {t('jobs.schedule.recurEveryWeeks')}
                  <input
                    type="number"
                    min={1}
                    max={52}
                    value={schedule.interval ?? 1}
                    onChange={(e) =>
                      updateSchedule({
                        interval: Math.max(1, Math.min(52, Number(e.target.value) || 1))
                      })
                    }
                  />
                </label>
                <div className="scheduled-jobs-checkgrid">
                  <span className="scheduled-jobs-checkgrid-label">{t('jobs.schedule.daysOfWeek')}</span>
                  <div className="scheduled-jobs-checkgrid-items">
                    {DAY_KEYS.map((key, i) => (
                      <label key={key} className="settings-checkbox-label scheduled-jobs-chip">
                        <input
                          type="checkbox"
                          checked={(schedule.daysOfWeek ?? []).includes(i)}
                          onChange={() =>
                            updateSchedule({
                              daysOfWeek: toggleNumberInList(schedule.daysOfWeek, i)
                            })
                          }
                        />
                        <span>{t(key)}</span>
                      </label>
                    ))}
                  </div>
                </div>
              </>
            )}

            {schedule.kind === 'monthly' && (
              <>
                <label>
                  {t('jobs.schedule.monthlyMode')}
                  <select
                    value={schedule.monthlyMode ?? 'days'}
                    onChange={(e) =>
                      updateSchedule({
                        monthlyMode: e.target.value === 'weekday' ? 'weekday' : 'days'
                      })
                    }
                  >
                    <option value="days">{t('jobs.schedule.monthlyModeDays')}</option>
                    <option value="weekday">{t('jobs.schedule.monthlyModeWeekday')}</option>
                  </select>
                </label>

                {(schedule.monthlyMode ?? 'days') === 'days' ? (
                  <div className="scheduled-jobs-checkgrid">
                    <span className="scheduled-jobs-checkgrid-label">
                      {t('jobs.schedule.daysOfMonth')}
                    </span>
                    <div className="scheduled-jobs-checkgrid-items scheduled-jobs-days-month">
                      {Array.from({ length: 31 }, (_, idx) => idx + 1).map((day) => (
                        <label key={day} className="settings-checkbox-label scheduled-jobs-chip">
                          <input
                            type="checkbox"
                            checked={(schedule.daysOfMonth ?? []).includes(day)}
                            onChange={() =>
                              updateSchedule({
                                daysOfMonth: toggleNumberInList(schedule.daysOfMonth, day)
                              })
                            }
                          />
                          <span>{day}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="scheduled-jobs-monthly-weekday">
                    <label>
                      {t('jobs.schedule.monthlyWeek')}
                      <select
                        value={schedule.monthlyWeek ?? 'FIRST'}
                        onChange={(e) =>
                          updateSchedule({
                            monthlyWeek: e.target.value as ScheduledJobMonthlyWeek
                          })
                        }
                      >
                        {WEEK_OPTIONS.map((opt) => (
                          <option key={opt.id} value={opt.id}>
                            {t(opt.labelKey)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      {t('jobs.dayOfWeek')}
                      <select
                        value={schedule.monthlyWeekday ?? 1}
                        onChange={(e) =>
                          updateSchedule({ monthlyWeekday: Number(e.target.value) })
                        }
                      >
                        {DAY_KEYS.map((key, i) => (
                          <option key={key} value={i}>
                            {t(key)}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                )}

                <div className="scheduled-jobs-checkgrid">
                  <span className="scheduled-jobs-checkgrid-label">{t('jobs.schedule.months')}</span>
                  <span className="field-hint">{t('jobs.schedule.monthsHint')}</span>
                  <div className="scheduled-jobs-checkgrid-items">
                    {MONTH_KEYS.map((key, idx) => {
                      const month = idx + 1
                      const selected = schedule.months
                      const checked = !selected || selected.length === 0 || selected.includes(month)
                      return (
                        <label key={key} className="settings-checkbox-label scheduled-jobs-chip">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => {
                              const current =
                                !schedule.months || schedule.months.length === 0
                                  ? [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]
                                  : schedule.months
                              const next = toggleNumberInList(current, month)
                              updateSchedule({
                                months: next.length === 12 ? undefined : next
                              })
                            }}
                          />
                          <span>{t(key)}</span>
                        </label>
                      )
                    })}
                  </div>
                </div>
              </>
            )}
          </fieldset>

          <label className="settings-checkbox-label">
            <input
              type="checkbox"
              checked={draft.enabled}
              onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })}
            />
            <span>
              {t('jobs.enabled')}
              <span className="field-hint">{t('jobs.enabledHint')}</span>
            </span>
          </label>
          <div className="scheduled-jobs-editor-actions">
            <button
              type="button"
              className="btn-secondary"
              disabled={busy}
              onClick={() => setDraft(null)}
            >
              {t('common.cancel')}
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={busy}
              onClick={() => void handleSave()}
            >
              {busy ? t('common.saving') : t('common.save')}
            </button>
          </div>
        </div>
      )}

      {message && !messageJobId ? <p className="form-message">{message}</p> : null}
    </div>
  )
}
