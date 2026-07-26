import { useEffect, useMemo, useState } from 'react'
import type { ChatAppliedChangeSet } from '@/types'
import { useAppStore } from '@/stores/app-store'
import { buildWorkspaceIndex } from '@/utils/project-index'
import { countCascadeApplies } from '@/utils/ai-apply-undo'
import { useI18n, t as tSync } from '@/i18n'
import { ConfirmDialog } from './ConfirmDialog'

interface ChatAppliedChangeSetsProps {
  items: ChatAppliedChangeSet[]
}

export function ChatAppliedChangeSets({ items }: ChatAppliedChangeSetsProps) {
  const { t } = useI18n()
  const workspaceRoot = useAppStore((s) => s.workspaceRoot)
  const aiApplyHistory = useAppStore((s) => s.aiApplyHistory)
  const undoAiApplyById = useAppStore((s) => s.undoAiApplyById)
  const refreshAiApplyHistory = useAppStore((s) => s.refreshAiApplyHistory)
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void refreshAiApplyHistory()
  }, [refreshAiApplyHistory, items.length])

  const confirmItem = useMemo(
    () => (confirmId ? items.find((item) => item.id === confirmId) : null),
    [confirmId, items]
  )
  const cascadeCount = confirmId ? countCascadeApplies(aiApplyHistory, confirmId) : 0

  if (items.length === 0) return null

  return (
    <div className="chat-applied-changes">
      {items.map((item) => {
        const canUndo = item.status === 'applied'
        const newerCount = Math.max(0, countCascadeApplies(aiApplyHistory, item.id) - 1)
        return (
          <div key={item.id} className={`chat-applied-change status-${item.status}`}>
            <div className="chat-applied-change-info">
              <span className="chat-applied-change-label">
                {item.status === 'undone'
                  ? t('undo.messageUndone', { count: item.entryCount })
                  : t('undo.messageApplied', { count: item.entryCount })}
              </span>
              <span className="chat-applied-change-summary" title={item.summary}>
                {item.summary}
              </span>
            </div>
            {item.status === 'applied' ? (
              <button
                type="button"
                className="btn-reject chat-applied-change-undo"
                disabled={!canUndo || busy}
                title={
                  newerCount > 0 ? t('undo.cascadeHint', { count: newerCount }) : undefined
                }
                onClick={() => {
                  void refreshAiApplyHistory()
                  setConfirmId(item.id)
                }}
              >
                {t('undo.undoApply')}
              </button>
            ) : null}
          </div>
        )
      })}
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
        onConfirm={() => {
          if (!workspaceRoot || !confirmId) return
          const id = confirmId
          setConfirmId(null)
          setBusy(true)
          void (async () => {
            try {
              await undoAiApplyById(id)
              const tree = await window.compass.fs.readDir(workspaceRoot)
              useAppStore.getState().setFileTree(tree)
              void buildWorkspaceIndex(workspaceRoot)
              await refreshAiApplyHistory()
            } catch (error) {
              const message =
                error instanceof Error ? error.message : tSync('chat.applyFailed')
              window.alert(tSync('undo.failed', { message }))
            } finally {
              setBusy(false)
            }
          })()
        }}
        onCancel={() => setConfirmId(null)}
      />
    </div>
  )
}
