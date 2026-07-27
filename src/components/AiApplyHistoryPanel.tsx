import { useCallback, useEffect, useMemo, useState } from 'react'
import { TEMPLATE_MANAGER_UNDO_CHAT_ID, type WorkspaceChangeSetSummary } from '@/types'
import { useAppStore } from '@/stores/app-store'
import { buildWorkspaceIndex } from '@/utils/project-index'
import { openWorkspaceFile } from '@/utils/open-workspace-file'
import {
  buildApplySummaryFileName,
  buildApplySummaryMarkdown,
  countCascadeApplies
} from '@/utils/ai-apply-undo'
import { formatUiPathList } from '@/utils/display-path'
import { useI18n, t as tSync } from '@/i18n'
import { ConfirmDialog } from './ConfirmDialog'
import { CloseIcon } from './icons/ToolbarIcons'

interface AiApplyHistoryPanelProps {
  open: boolean
  onClose: () => void
}

function messagePreviewFor(
  chatSessions: ReturnType<typeof useAppStore.getState>['chatSessions'],
  chatId: string,
  messageId?: string
): string {
  if (!messageId) return ''
  const session = chatSessions.find((item) => item.id === chatId)
  const message = session?.messages.find((item) => item.id === messageId)
  if (!message?.content?.trim()) return ''
  return message.content.trim().replace(/\s+/g, ' ').slice(0, 80)
}

export function AiApplyHistoryPanel({ open, onClose }: AiApplyHistoryPanelProps) {
  const { t } = useI18n()
  const workspaceRoot = useAppStore((s) => s.workspaceRoot)
  const history = useAppStore((s) => s.aiApplyHistory)
  const chatSessions = useAppStore((s) => s.chatSessions)
  const refreshAiApplyHistory = useAppStore((s) => s.refreshAiApplyHistory)
  const undoAiApplyById = useAppStore((s) => s.undoAiApplyById)
  const focusChatMessage = useAppStore((s) => s.focusChatMessage)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [savingId, setSavingId] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    void refreshAiApplyHistory()
  }, [open, refreshAiApplyHistory])

  const chatTitle = useCallback(
    (chatId: string, source?: WorkspaceChangeSetSummary['source']) => {
      if (source === 'template-manager' || chatId === TEMPLATE_MANAGER_UNDO_CHAT_ID) {
        return t('undo.sourceTemplateManager')
      }
      return chatSessions.find((session) => session.id === chatId)?.title ?? chatId
    },
    [chatSessions, t]
  )

  const confirmItem = useMemo(
    () => (confirmId ? history.find((item) => item.id === confirmId) : null),
    [confirmId, history]
  )
  const cascadeCount = confirmItem ? countCascadeApplies(history, confirmItem.id) : 0

  const refreshAfterDiskChange = useCallback(async () => {
    if (!workspaceRoot) return
    const tree = await window.compass.fs.readDir(workspaceRoot)
    useAppStore.getState().setFileTree(tree)
    void buildWorkspaceIndex(workspaceRoot)
    await refreshAiApplyHistory()
  }, [refreshAiApplyHistory, workspaceRoot])

  const runUndo = useCallback(async () => {
    if (!workspaceRoot || !confirmId) return
    const id = confirmId
    setConfirmId(null)
    setBusyId(id)
    try {
      await undoAiApplyById(id)
      await refreshAfterDiskChange()
    } catch (error) {
      const message = error instanceof Error ? error.message : tSync('chat.applyFailed')
      window.alert(tSync('undo.failed', { message }))
    } finally {
      setBusyId(null)
    }
  }, [confirmId, refreshAfterDiskChange, undoAiApplyById, workspaceRoot])

  const saveSummary = useCallback(
    async (item: WorkspaceChangeSetSummary) => {
      if (!workspaceRoot) return
      setSavingId(item.id)
      try {
        const markdown = buildApplySummaryMarkdown(item, {
          chatTitle: chatTitle(item.chatId, item.source),
          messagePreview: messagePreviewFor(chatSessions, item.chatId, item.messageId)
        })
        const relative = `.compass/apply-summaries/${buildApplySummaryFileName(item.id, item.createdAt)}`
        const filePath = `${workspaceRoot.replace(/\\/g, '/')}/${relative}`
        await window.compass.fs.writeFile(filePath, markdown)
        await refreshAfterDiskChange()
        await openWorkspaceFile(filePath)
      } catch (error) {
        const message = error instanceof Error ? error.message : tSync('chat.applyFailed')
        window.alert(tSync('undo.saveSummaryFailed', { message }))
      } finally {
        setSavingId(null)
      }
    },
    [chatSessions, chatTitle, refreshAfterDiskChange, workspaceRoot]
  )

  if (!open) return null

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
              <ol className="ai-apply-history-list ai-apply-timeline">
                {history.map((item) => {
                  const canUndo = item.status === 'applied'
                  const preview = messagePreviewFor(chatSessions, item.chatId, item.messageId)
                  const newerCount = Math.max(0, countCascadeApplies(history, item.id) - 1)
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
                          <span
                            className="ai-apply-history-chat"
                            title={chatTitle(item.chatId, item.source)}
                          >
                            {chatTitle(item.chatId, item.source)}
                          </span>
                          <span className="ai-apply-history-time">
                            {new Date(item.createdAt).toLocaleString()}
                          </span>
                        </div>
                        {preview ? (
                          <div className="ai-apply-history-message" title={preview}>
                            {preview}
                          </div>
                        ) : null}
                        <div
                          className="ai-apply-history-paths"
                          title={formatUiPathList(item.paths, { maxItems: 20, maxChars: 10_000 }).title}
                        >
                          {t('undo.historyEntry', {
                            count: item.entryCount,
                            paths:
                              formatUiPathList(item.paths, { maxItems: 4, maxChars: 32 }).label ||
                              '—'
                          })}
                        </div>
                      </div>
                      <div className="ai-apply-history-actions">
                        {item.messageId ? (
                          <button
                            type="button"
                            className="btn-secondary"
                            onClick={() => {
                              focusChatMessage(item.chatId, item.messageId!)
                              onClose()
                            }}
                          >
                            {t('undo.jumpToMessage')}
                          </button>
                        ) : null}
                        <button
                          type="button"
                          className="btn-secondary"
                          disabled={savingId === item.id}
                          onClick={() => void saveSummary(item)}
                        >
                          {t('undo.saveSummary')}
                        </button>
                        {item.status === 'applied' ? (
                          <button
                            type="button"
                            className="btn-reject"
                            disabled={!canUndo || busyId === item.id}
                            title={
                              newerCount > 0
                                ? t('undo.cascadeHint', { count: newerCount })
                                : undefined
                            }
                            onClick={() => setConfirmId(item.id)}
                          >
                            {t('undo.undoApply')}
                          </button>
                        ) : null}
                      </div>
                    </li>
                  )
                })}
              </ol>
            )}
          </div>
        </div>
      </div>
      <ConfirmDialog
        open={Boolean(confirmItem)}
        title={t('undo.confirmTitle')}
        message={
          cascadeCount > 1
            ? t('undo.confirmCascadeMessage', {
                count: confirmItem?.entryCount ?? 1,
                newer: cascadeCount - 1
              })
            : t('undo.confirmMessage', { count: confirmItem?.entryCount ?? 1 })
        }
        confirmLabel={t('undo.undoApply')}
        cancelLabel={t('common.cancel')}
        danger
        onConfirm={() => void runUndo()}
        onCancel={() => setConfirmId(null)}
      />
    </>
  )
}
