import { useCallback, useEffect, useState } from 'react'
import { useAppStore } from '@/stores/app-store'
import { buildWorkspaceIndex } from '@/utils/project-index'
import { useI18n, t as tSync } from '@/i18n'
import { ConfirmDialog } from './ConfirmDialog'

export function AiApplyUndoBar() {
  const { t } = useI18n()
  const lastAiApplyUndo = useAppStore((s) => s.lastAiApplyUndo)
  const lastAiUndoError = useAppStore((s) => s.lastAiUndoError)
  const workspaceRoot = useAppStore((s) => s.workspaceRoot)
  const pendingWorkspacePreview = useAppStore((s) => s.pendingWorkspacePreview)
  const setFileTree = useAppStore((s) => s.setFileTree)
  const undoLastAiApply = useAppStore((s) => s.undoLastAiApply)
  const dismissAiApplyUndoBanner = useAppStore((s) => s.dismissAiApplyUndoBanner)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [confirmCount, setConfirmCount] = useState(1)
  const [busy, setBusy] = useState(false)

  const runUndo = useCallback(async () => {
    if (!workspaceRoot || busy) return
    setBusy(true)
    setConfirmOpen(false)
    try {
      const changeSet = await undoLastAiApply()
      const tree = await window.compass.fs.readDir(workspaceRoot)
      setFileTree(tree)
      void buildWorkspaceIndex(workspaceRoot)

      const state = useAppStore.getState()
      const session = state.chatSessions.find((s) => s.id === changeSet.chatId)
      const note = tSync('chat.undidApply', { count: changeSet.entries.length })
      if (session) {
        const last = session.messages[session.messages.length - 1]
        if (last?.role === 'assistant') {
          state.updateLastAssistantMessage(changeSet.chatId, `${last.content}\n\n${note}`)
        } else {
          state.addChatMessage(changeSet.chatId, 'assistant', note)
        }
      }
    } catch {
      // lastAiUndoError is set in the store; keep banner visible when present
      if (!useAppStore.getState().lastAiApplyUndo) {
        // Still show error via alert when banner was already dismissed
        const message = useAppStore.getState().lastAiUndoError
        if (message) window.alert(tSync('undo.failed', { message }))
      }
    } finally {
      setBusy(false)
    }
  }, [busy, setFileTree, undoLastAiApply, workspaceRoot])

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

  // Hide while a preview is active so Apply / Reject stay primary.
  if (!lastAiApplyUndo || pendingWorkspacePreview) {
    return (
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
      <ConfirmDialog
        open={confirmOpen}
        title={t('undo.confirmTitle')}
        message={t('undo.confirmMessage', { count: lastAiApplyUndo.entryCount })}
        confirmLabel={t('undo.undoApply')}
        cancelLabel={t('common.cancel')}
        danger
        onConfirm={() => void runUndo()}
        onCancel={() => setConfirmOpen(false)}
      />
    </>
  )
}
