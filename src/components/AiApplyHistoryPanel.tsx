import { useCallback, useEffect, useState } from 'react'
import { useAppStore } from '@/stores/app-store'
import { buildWorkspaceIndex } from '@/utils/project-index'
import { useI18n, t as tSync } from '@/i18n'
import { ConfirmDialog } from './ConfirmDialog'
import { CloseIcon } from './icons/ToolbarIcons'

interface AiApplyHistoryPanelProps {
  open: boolean
  onClose: () => void
}

export function AiApplyHistoryPanel({ open, onClose }: AiApplyHistoryPanelProps) {
  const { t } = useI18n()
  const workspaceRoot = useAppStore((s) => s.workspaceRoot)
  const history = useAppStore((s) => s.aiApplyHistory)
  const chatSessions = useAppStore((s) => s.chatSessions)
  const refreshAiApplyHistory = useAppStore((s) => s.refreshAiApplyHistory)
  const undoAiApplyById = useAppStore((s) => s.undoAiApplyById)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [confirmId, setConfirmId] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    void refreshAiApplyHistory()
  }, [open, refreshAiApplyHistory])

  const chatTitle = useCallback(
    (chatId: string) => chatSessions.find((session) => session.id === chatId)?.title ?? chatId,
    [chatSessions]
  )

  const runUndo = useCallback(async () => {
    if (!workspaceRoot || !confirmId) return
    const id = confirmId
    setConfirmId(null)
    setBusyId(id)
    try {
      await undoAiApplyById(id)
      const tree = await window.compass.fs.readDir(workspaceRoot)
      useAppStore.getState().setFileTree(tree)
      void buildWorkspaceIndex(workspaceRoot)
      await refreshAiApplyHistory()
    } catch (error) {
      const message = error instanceof Error ? error.message : tSync('chat.applyFailed')
      window.alert(tSync('undo.failed', { message }))
    } finally {
      setBusyId(null)
    }
  }, [confirmId, refreshAiApplyHistory, undoAiApplyById, workspaceRoot])

  if (!open) return null

  const tipApplied = history.find((item) => item.status === 'applied')
  const confirmItem = confirmId ? history.find((item) => item.id === confirmId) : null

  return (
    <>
      <div className="modal-overlay" onMouseDown={onClose}>
        <div
          className="modal ai-apply-history-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="ai-apply-history-title"
          onMouseDown={(event) => event.stopPropagation()}
        >
          <div className="modal-header">
            <h2 id="ai-apply-history-title">{t('undo.historyTitle')}</h2>
            <button
              className="btn-icon"
              onClick={onClose}
              title={t('common.close')}
              aria-label={t('common.close')}
            >
              <CloseIcon />
            </button>
          </div>
          <div className="modal-body">
            {history.length === 0 ? (
              <p className="ai-apply-history-empty">{t('undo.historyEmpty')}</p>
            ) : (
              <ul className="ai-apply-history-list">
                {history.map((item) => {
                  const isTip = tipApplied?.id === item.id
                  const canUndo = item.status === 'applied' && isTip
                  return (
                    <li key={item.id} className={`ai-apply-history-item status-${item.status}`}>
                      <div className="ai-apply-history-main">
                        <div className="ai-apply-history-meta">
                          <span className="ai-apply-history-status">
                            {item.status === 'applied'
                              ? t('undo.statusApplied')
                              : item.status === 'undone'
                                ? t('undo.statusUndone')
                                : t('undo.statusStale')}
                          </span>
                          <span className="ai-apply-history-chat" title={chatTitle(item.chatId)}>
                            {chatTitle(item.chatId)}
                          </span>
                          <span className="ai-apply-history-time">
                            {new Date(item.createdAt).toLocaleString()}
                          </span>
                        </div>
                        <div className="ai-apply-history-paths">
                          {t('undo.historyEntry', {
                            count: item.entryCount,
                            paths: item.paths.join(', ') || '—'
                          })}
                        </div>
                      </div>
                      {item.status === 'applied' ? (
                        <button
                          type="button"
                          className="btn-reject"
                          disabled={!canUndo || busyId === item.id}
                          title={canUndo ? undefined : t('undo.notLatestHint')}
                          onClick={() => setConfirmId(item.id)}
                        >
                          {t('undo.undoApply')}
                        </button>
                      ) : null}
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </div>
      </div>
      <ConfirmDialog
        open={Boolean(confirmItem)}
        title={t('undo.confirmTitle')}
        message={t('undo.confirmMessage', { count: confirmItem?.entryCount ?? 1 })}
        confirmLabel={t('undo.undoApply')}
        cancelLabel={t('common.cancel')}
        danger
        onConfirm={() => void runUndo()}
        onCancel={() => setConfirmId(null)}
      />
    </>
  )
}
