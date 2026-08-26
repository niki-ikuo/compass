import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { ChatAppliedChangeSet } from '@/types'
import { useAppStore } from '@/stores/app-store'
import { buildWorkspaceIndex } from '@/utils/project-index'
import { countCascadeApplies } from '@/utils/ai-apply-undo'
import { useI18n, t as tSync } from '@/i18n'
import { ConfirmDialog } from './ConfirmDialog'
import { useRunPeekAccordion } from '@/hooks/use-run-peek-accordion'

interface ChatAppliedChangeSetsProps {
  items: ChatAppliedChangeSet[]
  /** Show the accordion even when there are no applies yet (live run shell). */
  allowEmpty?: boolean
  runActive?: boolean
  /** Pending confirmation file count, included in the header while reviewing. */
  liveCount?: number
  children?: ReactNode
}

function AppliedChangeRow({
  item,
  busy,
  onAskUndo
}: {
  item: ChatAppliedChangeSet
  busy: boolean
  onAskUndo: (id: string) => void
}) {
  const { t } = useI18n()
  const aiApplyHistory = useAppStore((s) => s.aiApplyHistory)
  const refreshAiApplyHistory = useAppStore((s) => s.refreshAiApplyHistory)
  const canUndo = item.status === 'applied'
  const newerCount = Math.max(0, countCascadeApplies(aiApplyHistory, item.id) - 1)

  return (
    <div className={`chat-applied-change status-${item.status}`}>
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
          title={newerCount > 0 ? t('undo.cascadeHint', { count: newerCount }) : undefined}
          onClick={() => {
            void refreshAiApplyHistory()
            onAskUndo(item.id)
          }}
        >
          {t('undo.undoApply')}
        </button>
      ) : null}
    </div>
  )
}

export function ChatAppliedChangeSets({
  items,
  allowEmpty = false,
  runActive = false,
  liveCount = 0,
  children
}: ChatAppliedChangeSetsProps) {
  const { t } = useI18n()
  const workspaceRoot = useAppStore((s) => s.workspaceRoot)
  const aiApplyHistory = useAppStore((s) => s.aiApplyHistory)
  const undoAiApplyById = useAppStore((s) => s.undoAiApplyById)
  const refreshAiApplyHistory = useAppStore((s) => s.refreshAiApplyHistory)
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const hasLivePreview = Boolean(children)
  const { mode, toggle } = useRunPeekAccordion(runActive || hasLivePreview)

  useEffect(() => {
    void refreshAiApplyHistory()
  }, [refreshAiApplyHistory, items.length])

  const confirmItem = useMemo(
    () => (confirmId ? items.find((item) => item.id === confirmId) : null),
    [confirmId, items]
  )
  const cascadeCount = confirmId ? countCascadeApplies(aiApplyHistory, confirmId) : 0

  if (items.length === 0 && !allowEmpty && !hasLivePreview) return null

  const entryCount = items.reduce((sum, item) => sum + item.entryCount, 0)
  const appliedCount = items
    .filter((item) => item.status === 'applied')
    .reduce((sum, item) => sum + item.entryCount, 0)
  const undoneCount = items
    .filter((item) => item.status === 'undone')
    .reduce((sum, item) => sum + item.entryCount, 0)
  const allUndone = appliedCount === 0 && undoneCount > 0
  const headerCount = entryCount + (hasLivePreview ? liveCount : 0)
  const summaryLabel = t('chat.appliedChangesCollapsed', { count: headerCount })
  const meta =
    hasLivePreview && appliedCount === 0
      ? t('chat.agentWaitingApproval')
      : headerCount === 0
        ? ''
        : allUndone
          ? t('undo.messageUndone', { count: undoneCount })
          : undoneCount > 0
            ? `${t('undo.messageApplied', { count: appliedCount })} · ${t('undo.messageUndone', { count: undoneCount })}`
            : t('undo.statusApplied')
  const latestItem = items[items.length - 1]
  const chevron = mode === 'open' || mode === 'peek' ? '▼' : '▶'

  return (
    <div
      className={`chat-code-block agent-step-block agent-step-quiet-summary chat-applied-changes-summary${
        allUndone ? ' agent-step-cancelled' : ''
      }${mode === 'peek' ? ' is-peek' : ''}`}
    >
      <button
        type="button"
        className="chat-code-header"
        onClick={toggle}
        aria-expanded={mode !== 'closed'}
      >
        <span className="chat-code-chevron">{chevron}</span>
        <span className="chat-code-icon" aria-hidden="true">
          ✏️
        </span>
        <span className="chat-code-label">{summaryLabel}</span>
        {meta ? <span className="chat-code-meta">{meta}</span> : null}
      </button>
      {mode !== 'closed' ? (
        <div
          className={`agent-step-group-body chat-applied-changes${
            mode === 'peek' ? ' is-peek' : ''
          }`}
        >
          {mode === 'open' ? (
            <>
              {items.map((item) => (
                <AppliedChangeRow
                  key={item.id}
                  item={item}
                  busy={busy}
                  onAskUndo={setConfirmId}
                />
              ))}
              {children}
            </>
          ) : hasLivePreview ? (
            children
          ) : latestItem ? (
            <AppliedChangeRow
              item={latestItem}
              busy={busy}
              onAskUndo={setConfirmId}
            />
          ) : null}
        </div>
      ) : null}
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
