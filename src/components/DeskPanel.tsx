import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAppStore } from '@/stores/app-store'
import { openWorkspaceFile } from '@/utils/open-workspace-file'
import { buildOutboxDraftRequest } from '@/utils/desk-presets'
import { getOutboxPresets } from '@/utils/desk-frontmatter'
import { getFileName } from '@/utils/language'
import { useDialogA11y } from '@/hooks/use-dialog-a11y'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import type {
  DeskInboxItem,
  DeskOutboxItem,
  OutboxPresetId,
  ShipFinding,
  ShipFindingSeverity
} from '@/types'
import { useI18n, type MessageKey } from '@/i18n'

const DESK_LIST_LIMIT = 20

function statusLabelKey(status: string): MessageKey {
  if (status === 'ready') return 'desk.status.ready'
  if (status === 'archived') return 'desk.status.archived'
  return 'desk.status.draft'
}

function presetLabelKey(preset: OutboxPresetId): MessageKey {
  return `desk.preset.${preset}` as MessageKey
}

function severityLabelKey(severity: ShipFindingSeverity): MessageKey {
  if (severity === 'error') return 'desk.ship.severity.error'
  if (severity === 'warning') return 'desk.ship.severity.warning'
  return 'desk.ship.severity.info'
}

function sourceBaseName(sourcePath: string): string {
  const norm = sourcePath.replace(/\\/g, '/')
  const parts = norm.split('/')
  return parts[parts.length - 1] || sourcePath
}

function normKey(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase()
}

function joinWorkspacePath(root: string, ...parts: string[]): string {
  const sep = root.includes('\\') ? '\\' : '/'
  return [root.replace(/[/\\]+$/, ''), ...parts].join(sep)
}

/** Keys that identify an inbox file as the source of an outbox draft. */
function collectOutboxSourceKeys(items: DeskOutboxItem[]): Set<string> {
  const keys = new Set<string>()
  for (const item of items) {
    const raw = item.sourcePath?.trim()
    if (!raw) continue
    const key = normKey(raw)
    keys.add(key)
    const base = sourceBaseName(raw)
    if (base) keys.add(normKey(base))
  }
  return keys
}

function inboxHasOutboxDraft(item: DeskInboxItem, sourceKeys: Set<string>): boolean {
  if (sourceKeys.size === 0) return false
  if (sourceKeys.has(normKey(item.relativePath))) return true
  if (sourceKeys.has(normKey(item.absolutePath))) return true
  if (sourceKeys.has(normKey(item.fileName))) return true
  return false
}

function formatShipFindingMessage(
  finding: ShipFinding,
  t: (key: MessageKey, params?: Record<string, string | number>) => string
): string {
  if (finding.messageKey) {
    return t(finding.messageKey as MessageKey, finding.messageParams)
  }
  return finding.message
}

export function DeskPanel() {
  const { t, locale } = useI18n()
  const workspaceRoot = useAppStore((s) => s.workspaceRoot)
  const leftSidebarView = useAppStore((s) => s.leftSidebarView)
  const lastAiApplyUndo = useAppStore((s) => s.lastAiApplyUndo)
  const requestChatComposerSend = useAppStore((s) => s.requestChatComposerSend)
  const setShowChat = useAppStore((s) => s.setShowChat)

  const [inbox, setInbox] = useState<DeskInboxItem[]>([])
  const [outbox, setOutbox] = useState<DeskOutboxItem[]>([])
  const [inboxHasMore, setInboxHasMore] = useState(false)
  const [outboxHasMore, setOutboxHasMore] = useState(false)
  /** Active + archived outbox, used only to mark inbox rows that already have a draft. */
  const [outboxForSourceMatch, setOutboxForSourceMatch] = useState<DeskOutboxItem[]>([])
  const [message, setMessage] = useState('')
  const [draftOpen, setDraftOpen] = useState(false)
  const [draftPreset, setDraftPreset] = useState<OutboxPresetId>('mail')
  /** null = no source file selected yet. */
  const [draftSourcePath, setDraftSourcePath] = useState<string | null>(null)
  const [shipPath, setShipPath] = useState<string | null>(null)
  const [shipFindings, setShipFindings] = useState<ShipFinding[]>([])
  const [shipBusy, setShipBusy] = useState(false)
  const [copyAnywayConfirmOpen, setCopyAnywayConfirmOpen] = useState(false)

  const draftModalRef = useRef<HTMLDivElement>(null)
  const shipModalRef = useRef<HTMLDivElement>(null)

  const closeDraftModal = useCallback(() => {
    setDraftOpen(false)
  }, [])

  const closeShipModal = useCallback(() => {
    setCopyAnywayConfirmOpen(false)
    setShipPath(null)
    setShipFindings([])
  }, [])

  useDialogA11y(draftOpen && Boolean(draftSourcePath), closeDraftModal, draftModalRef)
  useDialogA11y(
    Boolean(shipPath) && !copyAnywayConfirmOpen,
    closeShipModal,
    shipModalRef
  )

  const refresh = useCallback(async () => {
    if (!workspaceRoot) {
      setInbox([])
      setOutbox([])
      setOutboxForSourceMatch([])
      setInboxHasMore(false)
      setOutboxHasMore(false)
      return
    }
    try {
      await window.compass.desk.ensureDirs(workspaceRoot)
      const [nextInboxRaw, nextOutboxRaw, nextOutboxAll] = await Promise.all([
        window.compass.desk.listInbox(workspaceRoot, DESK_LIST_LIMIT + 1),
        window.compass.desk.listOutbox(workspaceRoot, DESK_LIST_LIMIT + 1),
        window.compass.desk.listOutbox(workspaceRoot, 200, true)
      ])
      setInboxHasMore(nextInboxRaw.length > DESK_LIST_LIMIT)
      setOutboxHasMore(nextOutboxRaw.length > DESK_LIST_LIMIT)
      setInbox(nextInboxRaw.slice(0, DESK_LIST_LIMIT))
      setOutbox(nextOutboxRaw.slice(0, DESK_LIST_LIMIT))
      setOutboxForSourceMatch(nextOutboxAll)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    }
  }, [workspaceRoot])

  const outboxSourceKeys = useMemo(
    () => collectOutboxSourceKeys(outboxForSourceMatch),
    [outboxForSourceMatch]
  )

  useEffect(() => {
    if (leftSidebarView !== 'desk') return
    void refresh()
  }, [leftSidebarView, refresh, workspaceRoot])

  // After AI Apply (draft write), reload lists while Desk is visible.
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

  const openDeskFolder = async (subdir: 'inbox' | 'outbox') => {
    if (!workspaceRoot) return
    try {
      await window.compass.shell.openPath(joinWorkspacePath(workspaceRoot, '.compass', subdir))
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    }
  }

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

  const handleMarkAllInboxDone = async () => {
    if (!workspaceRoot || inbox.length === 0) return
    const ok = window.confirm(t('desk.markAllDoneConfirm'))
    if (!ok) return
    const paths = inbox.map((item) => item.absolutePath)
    for (const path of paths) {
      closeOpenDeskFile(path)
    }
    await new Promise((r) => setTimeout(r, 50))
    try {
      const result = await window.compass.desk.markAllInboxDone(workspaceRoot)
      if (!result.ok) {
        setMessage(result.message)
        return
      }
      setInbox([])
      setMessage('')
      await refresh()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    }
  }

  const handleDeleteInbox = async (item: DeskInboxItem) => {
    if (!workspaceRoot) return
    const ok = window.confirm(t('desk.deleteInboxConfirm', { name: item.fileName }))
    if (!ok) return
    closeOpenDeskFile(item.absolutePath)
    await new Promise((r) => setTimeout(r, 50))
    try {
      const result = await window.compass.desk.deleteInbox(workspaceRoot, item.absolutePath)
      if (!result.ok) {
        setMessage(result.message)
        return
      }
      setInbox((prev) => prev.filter((row) => row.absolutePath !== item.absolutePath))
      await refresh()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    }
  }

  const handleArchiveOutbox = async (item: DeskOutboxItem) => {
    if (!workspaceRoot) return
    const result = await window.compass.desk.archiveOutbox(workspaceRoot, item.absolutePath)
    if (!result.ok) {
      setMessage(result.message)
      return
    }
    if (shipPath === item.absolutePath) {
      closeShipModal()
    }
    closeOpenDeskFile(item.absolutePath)
    setOutbox((prev) => prev.filter((row) => row.absolutePath !== item.absolutePath))
    await refresh()
  }

  const handleArchiveAllOutbox = async () => {
    if (!workspaceRoot || outbox.length === 0) return
    const ok = window.confirm(t('desk.archiveAllConfirm'))
    if (!ok) return
    if (shipPath) {
      closeShipModal()
    }
    for (const item of outbox) {
      closeOpenDeskFile(item.absolutePath)
    }
    await new Promise((r) => setTimeout(r, 50))
    try {
      const result = await window.compass.desk.archiveAllOutbox(workspaceRoot)
      if (!result.ok) {
        setMessage(result.message)
        return
      }
      setOutbox([])
      setMessage('')
      await refresh()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    }
  }

  const handleDeleteOutbox = async (item: DeskOutboxItem) => {
    if (!workspaceRoot) return
    const ok = window.confirm(t('desk.deleteConfirm', { name: item.fileName }))
    if (!ok) return
    // Close editor first so Windows can unlink an open file.
    closeOpenDeskFile(item.absolutePath)
    if (shipPath === item.absolutePath) {
      closeShipModal()
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

  const openDraftModal = (sourceAbsolutePath: string) => {
    setDraftSourcePath(sourceAbsolutePath)
    setMessage('')
    setDraftOpen(true)
  }

  const handleCreateDraft = () => {
    if (!workspaceRoot || !draftSourcePath) return
    // Pass existing outbox names; in-memory reservation covers same-second creates before Apply.
    const occupied = outbox.map((item) => item.fileName)
    const request = buildOutboxDraftRequest(
      draftSourcePath,
      workspaceRoot,
      draftPreset,
      locale,
      occupied
    )
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
    const needsConfirm = shipFindings.some(
      (f) => f.severity === 'error' || f.severity === 'warning'
    )
    if (needsConfirm && !anyway) return
    if (anyway) {
      setCopyAnywayConfirmOpen(true)
      return
    }
    await performCopyShip()
  }

  const performCopyShip = async () => {
    if (!shipPath) return
    setCopyAnywayConfirmOpen(false)
    const result = await window.compass.desk.copyOutboxPayload(shipPath)
    if (!result.ok) {
      setMessage(result.message)
      return
    }
    if (result.markedReady) {
      const store = useAppStore.getState()
      const norm = shipPath.replace(/\\/g, '/').toLowerCase()
      const open = store.openFiles.find(
        (f) => f.path.replace(/\\/g, '/').toLowerCase() === norm
      )
      if (open) {
        store.updateFileContent(open.path, result.content)
        store.markFileSaved(open.path)
      }
    }
    setMessage(t('desk.shipCopied'))
    closeShipModal()
    void refresh()
  }

  if (!workspaceRoot) {
    return (
      <div className="desk-panel">
        <p className="desk-empty">{t('desk.noWorkspace')}</p>
      </div>
    )
  }

  const presets = getOutboxPresets()
  const shipNeedsConfirm = shipFindings.some(
    (f) => f.severity === 'error' || f.severity === 'warning'
  )

  return (
    <div className="desk-panel">
      {message ? <p className="desk-message">{message}</p> : null}

      <section className="desk-section">
        <div className="desk-section-header">
          <h3 className="desk-section-title">{t('desk.inbox')}</h3>
          {inbox.length > 0 ? (
            <button
              type="button"
              className="desk-btn compact"
              onClick={() => void handleMarkAllInboxDone()}
              title={t('desk.markAllDone')}
            >
              {t('desk.markAllDone')}
            </button>
          ) : null}
        </div>
        {inbox.length === 0 ? (
          <p className="desk-empty">{t('desk.inboxEmpty')}</p>
        ) : (
          <>
            <ul className="desk-list">
              {inbox.map((item) => {
                const hasOutbox = inboxHasOutboxDraft(item, outboxSourceKeys)
                return (
                  <li
                    key={item.absolutePath}
                    className={`desk-row${hasOutbox ? ' has-outbox' : ''}`}
                  >
                    <button
                      type="button"
                      className="desk-row-main"
                      onClick={() => void openWorkspaceFile(item.absolutePath)}
                      title={item.relativePath}
                    >
                      <span className="desk-row-name">
                        {item.fileName}
                        {hasOutbox ? (
                          <span className="desk-badge">{t('desk.hasOutbox')}</span>
                        ) : null}
                      </span>
                      <span className="desk-row-meta">{item.snippet || item.capturedAt}</span>
                    </button>
                    <div className="desk-row-actions">
                      <button
                        type="button"
                        className="desk-btn compact primary"
                        onClick={() => openDraftModal(item.absolutePath)}
                        title={t('desk.createDraft')}
                      >
                        {t('desk.createDraftShort')}
                      </button>
                      <button
                        type="button"
                        className="desk-btn compact"
                        onClick={() => void handleMarkDone(item)}
                      >
                        {t('desk.markDone')}
                      </button>
                      <button
                        type="button"
                        className="desk-btn compact danger"
                        onClick={() => void handleDeleteInbox(item)}
                      >
                        {t('desk.delete')}
                      </button>
                    </div>
                  </li>
                )
              })}
            </ul>
            {inboxHasMore ? (
              <div className="desk-list-footer">
                <p className="desk-list-truncated">{t('desk.listTruncated', { limit: DESK_LIST_LIMIT })}</p>
                <button
                  type="button"
                  className="desk-link-btn"
                  onClick={() => void openDeskFolder('inbox')}
                >
                  {t('desk.openFolder')}
                </button>
              </div>
            ) : null}
          </>
        )}
      </section>

      <section className="desk-section">
        <div className="desk-section-header">
          <h3 className="desk-section-title">{t('desk.outbox')}</h3>
          {outbox.length > 0 ? (
            <button
              type="button"
              className="desk-btn compact"
              onClick={() => void handleArchiveAllOutbox()}
              title={t('desk.archiveAll')}
            >
              {t('desk.archiveAll')}
            </button>
          ) : null}
        </div>
        {outbox.length === 0 ? (
          <p className="desk-empty">{t('desk.outboxEmpty')}</p>
        ) : (
          <>
            <ul className="desk-list">
              {outbox.map((item) => {
                const copied = item.status === 'ready'
                return (
                  <li
                    key={item.absolutePath}
                    className={`desk-row${copied ? ' has-copied' : ''}`}
                  >
                    <button
                      type="button"
                      className="desk-row-main"
                      onClick={() => void openWorkspaceFile(item.absolutePath)}
                      title={item.relativePath}
                    >
                      <span className="desk-row-name">
                        {t(presetLabelKey(item.preset))}
                        {copied ? (
                          <span className="desk-badge">{t('desk.copied')}</span>
                        ) : (
                          <span className="desk-row-status">
                            · {t(statusLabelKey(item.status))}
                          </span>
                        )}
                      </span>
                      <span className="desk-row-meta">
                        {item.subject || item.snippet || item.fileName}
                      </span>
                      {item.sourcePath ? (
                        <span className="desk-row-meta desk-row-source" title={item.sourcePath}>
                          {t('desk.fromSource', { name: sourceBaseName(item.sourcePath) })}
                        </span>
                      ) : null}
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
                )
              })}
            </ul>
            {outboxHasMore ? (
              <div className="desk-list-footer">
                <p className="desk-list-truncated">{t('desk.listTruncated', { limit: DESK_LIST_LIMIT })}</p>
                <button
                  type="button"
                  className="desk-link-btn"
                  onClick={() => void openDeskFolder('outbox')}
                >
                  {t('desk.openFolder')}
                </button>
              </div>
            ) : null}
          </>
        )}
      </section>

      {draftOpen && draftSourcePath ? (
        <div
          className="desk-modal"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeDraftModal()
          }}
        >
          <div
            ref={draftModalRef}
            className="desk-modal-body"
            role="dialog"
            aria-modal="true"
            aria-label={t('desk.draftTitle')}
            tabIndex={-1}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <h3>{t('desk.draftTitle')}</h3>
            <p className="desk-draft-source-line">
              {t('desk.fromSource', { name: getFileName(draftSourcePath) })}
            </p>

            <h4 className="desk-modal-subtitle">{t('desk.draftPreset')}</h4>
            <div className="desk-preset-list" role="radiogroup" aria-label={t('desk.draftPreset')}>
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
              <button type="button" className="desk-btn" onClick={closeDraftModal}>
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
        <div
          className="desk-modal"
          role="presentation"
          onMouseDown={(event) => {
            if (copyAnywayConfirmOpen) return
            if (event.target === event.currentTarget) closeShipModal()
          }}
        >
          <div
            ref={shipModalRef}
            className="desk-modal-body"
            role="dialog"
            aria-modal="true"
            aria-label={t('desk.shipTitle')}
            tabIndex={-1}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <h3>{t('desk.shipTitle')}</h3>
            {shipFindings.length === 0 ? (
              <p className="desk-empty">{t('desk.shipNoFindings')}</p>
            ) : (
              <ul className="desk-findings">
                {shipFindings.map((f, i) => (
                  <li key={`${f.id}-${i}`} className={`desk-finding is-${f.severity}`}>
                    <strong>{t(severityLabelKey(f.severity))}</strong>{' '}
                    {formatShipFindingMessage(f, t)}
                    {f.excerpt ? <span className="desk-finding-excerpt">{f.excerpt}</span> : null}
                  </li>
                ))}
              </ul>
            )}
            <div className="desk-modal-actions">
              <button type="button" className="desk-btn" onClick={closeShipModal}>
                {t('desk.ship.close')}
              </button>
              {shipNeedsConfirm ? (
                <button type="button" className="desk-btn" onClick={() => void copyShip(true)}>
                  {t('desk.shipCopyAnyway')}
                </button>
              ) : null}
              <button
                type="button"
                className="desk-btn primary"
                onClick={() => void copyShip(false)}
                disabled={shipNeedsConfirm}
              >
                {t('desk.shipCopy')}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <ConfirmDialog
        open={copyAnywayConfirmOpen}
        title={t('desk.shipCopyAnyway')}
        message={t('desk.shipCopyAnywayConfirm')}
        confirmLabel={t('desk.shipCopyAnyway')}
        cancelLabel={t('common.cancel')}
        danger
        onConfirm={() => void performCopyShip()}
        onCancel={() => setCopyAnywayConfirmOpen(false)}
      />
    </div>
  )
}
