import { useCallback, useEffect, useState } from 'react'
import { useAppStore } from '@/stores/app-store'
import { openWorkspaceFile } from '@/utils/open-workspace-file'
import { buildDigestRequest, buildOutboxDraftRequest } from '@/utils/desk-presets'
import { getOutboxPresets } from '@/utils/desk-frontmatter'
import type {
  DeskDigestItem,
  DeskInboxItem,
  DeskOutboxItem,
  OutboxPresetId,
  ShipFinding
} from '@/types'
import { useI18n, type MessageKey } from '@/i18n'

function statusLabelKey(status: string): MessageKey {
  if (status === 'ready') return 'desk.status.ready'
  if (status === 'archived') return 'desk.status.archived'
  return 'desk.status.draft'
}

function presetLabelKey(preset: OutboxPresetId): MessageKey {
  return `desk.preset.${preset}` as MessageKey
}

export function DeskPanel() {
  const { t, locale } = useI18n()
  const workspaceRoot = useAppStore((s) => s.workspaceRoot)
  const leftSidebarView = useAppStore((s) => s.leftSidebarView)
  const activeFilePath = useAppStore((s) => s.activeFilePath)
  const lastAiApplyUndo = useAppStore((s) => s.lastAiApplyUndo)
  const requestChatComposerSend = useAppStore((s) => s.requestChatComposerSend)
  const setShowChat = useAppStore((s) => s.setShowChat)

  const [inbox, setInbox] = useState<DeskInboxItem[]>([])
  const [outbox, setOutbox] = useState<DeskOutboxItem[]>([])
  const [digests, setDigests] = useState<DeskDigestItem[]>([])
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [draftOpen, setDraftOpen] = useState(false)
  const [draftPreset, setDraftPreset] = useState<OutboxPresetId>('mail')
  const [shipPath, setShipPath] = useState<string | null>(null)
  const [shipFindings, setShipFindings] = useState<ShipFinding[]>([])
  const [shipBusy, setShipBusy] = useState(false)

  const refresh = useCallback(async () => {
    if (!workspaceRoot) {
      setInbox([])
      setOutbox([])
      setDigests([])
      return
    }
    setLoading(true)
    try {
      await window.compass.desk.ensureDirs(workspaceRoot)
      const [nextInbox, nextOutbox, nextDigests] = await Promise.all([
        window.compass.desk.listInbox(workspaceRoot),
        window.compass.desk.listOutbox(workspaceRoot),
        window.compass.desk.listDigests(workspaceRoot)
      ])
      setInbox(nextInbox)
      setOutbox(nextOutbox)
      setDigests(nextDigests)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setLoading(false)
    }
  }, [workspaceRoot])

  useEffect(() => {
    if (leftSidebarView !== 'desk') return
    void refresh()
  }, [leftSidebarView, refresh, workspaceRoot])

  // After AI Apply (draft / digest write), reload lists while Desk is visible.
  useEffect(() => {
    if (leftSidebarView !== 'desk' || !lastAiApplyUndo) return
    void refresh()
  }, [lastAiApplyUndo?.changeSetId, leftSidebarView, refresh])

  useEffect(() => {
    return window.compass.desk.onCaptureResult((result) => {
      if (!result.ok) return
      if (useAppStore.getState().leftSidebarView !== 'desk') return
      void refresh()
    })
  }, [refresh])

  const closeOpenDeskFile = (absolutePath: string) => {
    const norm = absolutePath.replace(/\\/g, '/').toLowerCase()
    const store = useAppStore.getState()
    const open = store.openFiles.find(
      (f) => f.path.replace(/\\/g, '/').toLowerCase() === norm
    )
    if (open) store.closeFile(open.path)
  }

  const handleMarkDone = async (item: DeskInboxItem) => {
    if (!workspaceRoot) return
    const result = await window.compass.desk.markInboxDone(workspaceRoot, item.absolutePath)
    if (!result.ok) {
      setMessage(result.message)
      return
    }
    // File moved to done/ — close the old editor tab.
    closeOpenDeskFile(item.absolutePath)
    setInbox((prev) => prev.filter((row) => row.absolutePath !== item.absolutePath))
    await refresh()
  }

  const handleArchiveOutbox = async (item: DeskOutboxItem) => {
    if (!workspaceRoot) return
    const result = await window.compass.desk.archiveOutbox(workspaceRoot, item.absolutePath)
    if (!result.ok) {
      setMessage(result.message)
      return
    }
    if (shipPath === item.absolutePath) {
      setShipPath(null)
      setShipFindings([])
    }
    closeOpenDeskFile(item.absolutePath)
    setOutbox((prev) => prev.filter((row) => row.absolutePath !== item.absolutePath))
    await refresh()
  }

  const handleDeleteOutbox = async (item: DeskOutboxItem) => {
    if (!workspaceRoot) return
    const ok = window.confirm(t('desk.deleteConfirm', { name: item.fileName }))
    if (!ok) return
    // Close editor first so Windows can unlink an open file.
    closeOpenDeskFile(item.absolutePath)
    if (shipPath === item.absolutePath) {
      setShipPath(null)
      setShipFindings([])
    }
    // Let the editor release the file handle before unlink.
    await new Promise((r) => setTimeout(r, 50))
    try {
      const result = await window.compass.desk.deleteOutbox(workspaceRoot, item.absolutePath)
      if (!result.ok) {
        setMessage(result.message)
        return
      }
      setOutbox((prev) => prev.filter((row) => row.absolutePath !== item.absolutePath))
      await refresh()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    }
  }

  const handleDeleteDigest = async (item: DeskDigestItem) => {
    if (!workspaceRoot) return
    const ok = window.confirm(t('desk.deleteDigestConfirm', { name: item.fileName }))
    if (!ok) return
    // Close editor first so Windows can unlink an open file.
    closeOpenDeskFile(item.absolutePath)
    await new Promise((r) => setTimeout(r, 50))
    try {
      const result = await window.compass.desk.deleteDigest(workspaceRoot, item.absolutePath)
      if (!result.ok) {
        setMessage(result.message)
        return
      }
      setDigests((prev) => prev.filter((row) => row.absolutePath !== item.absolutePath))
      await refresh()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    }
  }

  const handleCreateDraft = () => {
    if (!workspaceRoot) return
    const request = buildOutboxDraftRequest(activeFilePath, workspaceRoot, draftPreset, locale)
    setShowChat(true)
    requestChatComposerSend(request)
    setDraftOpen(false)
    setMessage('')
    void refresh()
  }

  const runShipCheck = async (absolutePath: string) => {
    setShipBusy(true)
    setShipPath(absolutePath)
    try {
      const result = await window.compass.desk.runShipCheck(absolutePath)
      setShipFindings(result.findings)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
      setShipPath(null)
    } finally {
      setShipBusy(false)
    }
  }

  const copyShip = async (anyway: boolean) => {
    if (!shipPath) return
    const hasError = shipFindings.some((f) => f.severity === 'error')
    if (hasError && !anyway) return
    const result = await window.compass.desk.copyOutboxPayload(shipPath)
    if (!result.ok) {
      setMessage(result.message)
      return
    }
    setMessage(t('desk.shipCopied'))
    setShipPath(null)
    setShipFindings([])
    void refresh()
  }

  const handleDigest = async () => {
    if (!workspaceRoot) return
    setMessage(t('desk.digestStarting'))
    try {
      const collected = await window.compass.desk.collectDigestContext(workspaceRoot)
      if (collected.empty) {
        setMessage(t('desk.digestEmptyPeriod'))
        return
      }
      const note = collected.truncated
        ? `\n(Note: truncated. filesConsidered=${collected.filesConsidered})`
        : `\n(filesConsidered=${collected.filesConsidered})`
      const request = buildDigestRequest(
        collected.digestRelativePath,
        collected.contextBlock + note,
        collected.periodStart,
        collected.periodEnd,
        locale
      )
      setShowChat(true)
      requestChatComposerSend(request)
      setMessage('')
      void refresh()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    }
  }

  if (!workspaceRoot) {
    return (
      <div className="desk-panel">
        <p className="desk-empty">{t('desk.noWorkspace')}</p>
      </div>
    )
  }

  const presets = getOutboxPresets()
  const shipHasError = shipFindings.some((f) => f.severity === 'error')

  return (
    <div className="desk-panel">
      <div className="desk-toolbar">
        <button type="button" className="desk-btn" onClick={() => void refresh()} disabled={loading}>
          {t('desk.refresh')}
        </button>
        <button type="button" className="desk-btn primary" onClick={() => setDraftOpen(true)}>
          {t('desk.createDraft')}
        </button>
      </div>

      {message ? <p className="desk-message">{message}</p> : null}

      <section className="desk-section">
        <h3 className="desk-section-title">{t('desk.inbox')}</h3>
        {inbox.length === 0 ? (
          <p className="desk-empty">{t('desk.inboxEmpty')}</p>
        ) : (
          <ul className="desk-list">
            {inbox.map((item) => (
              <li key={item.absolutePath} className="desk-row">
                <button
                  type="button"
                  className="desk-row-main"
                  onClick={() => void openWorkspaceFile(item.absolutePath)}
                  title={item.relativePath}
                >
                  <span className="desk-row-name">{item.fileName}</span>
                  <span className="desk-row-meta">{item.snippet || item.capturedAt}</span>
                </button>
                <button
                  type="button"
                  className="desk-btn compact"
                  onClick={() => void handleMarkDone(item)}
                >
                  {t('desk.markDone')}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="desk-section">
        <h3 className="desk-section-title">{t('desk.outbox')}</h3>
        {outbox.length === 0 ? (
          <p className="desk-empty">{t('desk.outboxEmpty')}</p>
        ) : (
          <ul className="desk-list">
            {outbox.map((item) => (
              <li key={item.absolutePath} className="desk-row">
                <button
                  type="button"
                  className="desk-row-main"
                  onClick={() => void openWorkspaceFile(item.absolutePath)}
                  title={item.relativePath}
                >
                  <span className="desk-row-name">
                    {t(presetLabelKey(item.preset))} · {t(statusLabelKey(item.status))}
                  </span>
                  <span className="desk-row-meta">
                    {item.subject || item.snippet || item.fileName}
                  </span>
                </button>
                <div className="desk-row-actions">
                  <button
                    type="button"
                    className="desk-btn compact"
                    onClick={() => void runShipCheck(item.absolutePath)}
                    disabled={shipBusy}
                  >
                    {t('desk.shipCheck')}
                  </button>
                  <button
                    type="button"
                    className="desk-btn compact"
                    onClick={() => void handleArchiveOutbox(item)}
                    title={t('desk.status.archived')}
                  >
                    {t('desk.archive')}
                  </button>
                  <button
                    type="button"
                    className="desk-btn compact danger"
                    onClick={() => void handleDeleteOutbox(item)}
                  >
                    {t('desk.delete')}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="desk-section">
        <h3 className="desk-section-title">{t('desk.digest')}</h3>
        <button type="button" className="desk-btn" onClick={() => void handleDigest()}>
          {t('desk.createDigest')}
        </button>
        {digests.length === 0 ? (
          <p className="desk-empty">{t('desk.digestEmpty')}</p>
        ) : (
          <ul className="desk-list">
            {digests.map((item) => (
              <li key={item.absolutePath} className="desk-row">
                <button
                  type="button"
                  className="desk-row-main"
                  onClick={() => void openWorkspaceFile(item.absolutePath)}
                >
                  <span className="desk-row-name">{item.fileName}</span>
                  <span className="desk-row-meta">
                    {item.periodStart && item.periodEnd
                      ? `${item.periodStart} → ${item.periodEnd}`
                      : item.snippet}
                  </span>
                </button>
                <div className="desk-row-actions">
                  <button
                    type="button"
                    className="desk-btn compact danger"
                    onClick={() => void handleDeleteDigest(item)}
                  >
                    {t('desk.delete')}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {draftOpen ? (
        <div className="desk-modal" role="dialog" aria-label={t('desk.draftTitle')}>
          <div className="desk-modal-body">
            <h3>{t('desk.draftTitle')}</h3>
            <div className="desk-preset-list">
              {presets.map((preset) => (
                <label key={preset} className="desk-preset-option">
                  <input
                    type="radio"
                    name="desk-preset"
                    checked={draftPreset === preset}
                    onChange={() => setDraftPreset(preset)}
                  />
                  <span>{t(presetLabelKey(preset))}</span>
                </label>
              ))}
            </div>
            <div className="desk-modal-actions">
              <button type="button" className="desk-btn" onClick={() => setDraftOpen(false)}>
                {t('common.cancel')}
              </button>
              <button type="button" className="desk-btn primary" onClick={handleCreateDraft}>
                {t('desk.draftCreate')}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {shipPath ? (
        <div className="desk-modal" role="dialog" aria-label={t('desk.shipTitle')}>
          <div className="desk-modal-body">
            <h3>{t('desk.shipTitle')}</h3>
            {shipFindings.length === 0 ? (
              <p className="desk-empty">{t('desk.shipNoFindings')}</p>
            ) : (
              <ul className="desk-findings">
                {shipFindings.map((f, i) => (
                  <li key={`${f.id}-${i}`} className={`desk-finding is-${f.severity}`}>
                    <strong>{f.severity}</strong> {f.message}
                    {f.excerpt ? <span className="desk-finding-excerpt">{f.excerpt}</span> : null}
                  </li>
                ))}
              </ul>
            )}
            <div className="desk-modal-actions">
              <button
                type="button"
                className="desk-btn"
                onClick={() => {
                  setShipPath(null)
                  setShipFindings([])
                }}
              >
                {t('desk.ship.close')}
              </button>
              {shipHasError ? (
                <button type="button" className="desk-btn" onClick={() => void copyShip(true)}>
                  {t('desk.shipCopyAnyway')}
                </button>
              ) : null}
              <button
                type="button"
                className="desk-btn primary"
                onClick={() => void copyShip(false)}
                disabled={shipHasError}
              >
                {t('desk.shipCopy')}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
