import { useCallback, useEffect, useState } from 'react'
import { useAppStore } from '@/stores/app-store'
import { buildWorkspaceIndex } from '@/utils/project-index'
import { useI18n, t as tSync } from '@/i18n'
import { ConfirmDialog } from './ConfirmDialog'
import { AiApplyHistoryPanel } from './AiApplyHistoryPanel'

async function refreshTree(workspaceRoot: string): Promise<void> {
  const tree = await window.compass.fs.readDir(workspaceRoot)
  useAppStore.getState().setFileTree(tree)
  void buildWorkspaceIndex(workspaceRoot)
}

export function AiApplyUndoBar() {
  const { t } = useI18n()
  const lastAiApplyUndo = useAppStore((s) => s.lastAiApplyUndo)
  const lastAiUndoError = useAppStore((s) => s.lastAiUndoError)
  const workspaceRoot = useAppStore((s) => s.workspaceRoot)
  const pendingWorkspacePreview = useAppStore((s) => s.pendingWorkspacePreview)
  const undoLastAiApply = useAppStore((s) => s.undoLastAiApply)
  const dismissAiApplyUndoBanner = useAppStore((s) => s.dismissAiApplyUndoBanner)
  const refreshAiApplyHistory = useAppStore((s) => s.refreshAiApplyHistory)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [confirmCount, setConfirmCount] = useState(1)
  const [busy, setBusy] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)

  const runUndo = useCallback(async () => {
    if (!workspaceRoot || busy) return
    setBusy(true)
    setConfirmOpen(false)
    try {
      await undoLastAiApply()
      await refreshTree(workspaceRoot)
    } catch {
      if (!useAppStore.getState().lastAiApplyUndo) {
        const message = useAppStore.getState().lastAiUndoError
        if (message) window.alert(tSync('undo.failed', { message }))
      }
    } finally {
      setBusy(false)
    }
  }, [busy, undoLastAiApply, workspaceRoot])

  const requestUndo = useCallback(() => {
    if (!workspaceRoot || busy || pendingWorkspacePreview) return
    const banner = useAppStore.getState().lastAiApplyUndo
    setConfirmCount(banner?.entryCount ?? 1)
    setConfirmOpen(true)
  }, [busy, pendingWorkspacePreview, workspaceRoot])

  useEffect(() => {
    const onRequest = () => requestUndo()
    window.addEventListener('compass:undo-ai-apply', onRequest)
    return () => window.removeEventListener('compass:undo-ai-apply', onRequest)
  }, [requestUndo])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || !event.shiftKey) return
      if (event.key.toLowerCase() !== 'z') return
      const target = event.target as HTMLElement | null
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)
      ) {
        return
      }
      event.preventDefault()
      requestUndo()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [requestUndo])

  useEffect(() => {
    const onHistory = () => {
      setHistoryOpen(true)
      void refreshAiApplyHistory()
    }
    window.addEventListener('compass:ai-apply-history', onHistory)
    return () => window.removeEventListener('compass:ai-apply-history', onHistory)
  }, [refreshAiApplyHistory])

  useEffect(() => {
    const onUndoChat = () => {
      const state = useAppStore.getState()
      const chatId = state.activeChatId
      const root = state.workspaceRoot
      if (!chatId || !root) return
      const confirmed = window.confirm(tSync('undo.confirmChatMessage'))
      if (!confirmed) return
      void (async () => {
        try {
          await state.undoAiAppliesForChat(chatId)
          await refreshTree(root)
        } catch (error) {
          const message = error instanceof Error ? error.message : tSync('chat.applyFailed')
          window.alert(tSync('undo.failed', { message }))
        }
      })()
    }
    window.addEventListener('compass:undo-ai-apply-chat', onUndoChat)
    return () => window.removeEventListener('compass:undo-ai-apply-chat', onUndoChat)
  }, [])

  useEffect(() => {
    if (!workspaceRoot) return
    void refreshAiApplyHistory()
  }, [workspaceRoot, refreshAiApplyHistory])

  const confirmDialog = (
    <ConfirmDialog
      open={confirmOpen}
      title={t('undo.confirmTitle')}
      message={t('undo.confirmMessage', { count: confirmCount })}
      confirmLabel={t('undo.undoApply')}
      cancelLabel={t('common.cancel')}
      danger
      onConfirm={() => void runUndo()}
      onCancel={() => setConfirmOpen(false)}
    />
  )

  // Hide while a preview is active so Apply / Reject stay primary.
  if (!lastAiApplyUndo || pendingWorkspacePreview) {
    return (
      <>
        {confirmDialog}
        {historyOpen ? (
          <AiApplyHistoryPanel open={historyOpen} onClose={() => setHistoryOpen(false)} />
        ) : null}
      </>
    )
  }

  return (
    <>
      <div className={`preview-bar ai-undo-bar${lastAiUndoError ? ' preview-bar-error' : ''}`}>
        <div className="preview-bar-info">
          <span className="preview-bar-badge">{t('undo.badge')}</span>
          {lastAiUndoError ? (
            <span>{t('undo.failed', { message: lastAiUndoError })}</span>
          ) : (
            <span>{t('undo.barHint', { count: lastAiApplyUndo.entryCount })}</span>
          )}
        </div>
        <div className="preview-bar-actions">
          <button
            type="button"
            className="btn-secondary"
            disabled={busy}
            onClick={() => {
              setHistoryOpen(true)
              void refreshAiApplyHistory()
            }}
          >
            {t('undo.history')}
          </button>
          <button
            type="button"
            className="btn-reject"
            disabled={busy}
            onClick={() => requestUndo()}
          >
            {t('undo.undoApply')}
          </button>
          <button
            type="button"
            className="btn-secondary"
            disabled={busy}
            onClick={() => dismissAiApplyUndoBanner()}
          >
            {t('common.close')}
          </button>
        </div>
      </div>
      {confirmDialog}
      {historyOpen ? (
        <AiApplyHistoryPanel open={historyOpen} onClose={() => setHistoryOpen(false)} />
      ) : null}
    </>
  )
}
