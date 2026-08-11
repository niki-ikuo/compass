import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ChatMode, PinnedAction } from '@/types'
import { useI18n } from '@/i18n'
import { useAppStore } from '@/stores/app-store'
import { getErrorMessage } from '@/utils/error-message'
import { getFileName } from '@/utils/language'
import { isAgentModeAvailable } from '@/utils/llm-providers'
import { pickBarPinnedActions } from '@/utils/pinned-actions'
import { ConfirmDialog } from './ConfirmDialog'
import { PinnedActionsManagerDialog } from './PinnedActionsManagerDialog'

export function PinnedActionsBar() {
  const { t } = useI18n()
  const workspaceRoot = useAppStore((s) => s.workspaceRoot)
  const providerId = useAppStore((s) => s.settings.providerId)
  const activeChatId = useAppStore((s) => s.activeChatId)
  const isChatLoading = useAppStore((s) =>
    activeChatId ? s.loadingChatIds.includes(activeChatId) : false
  )
  const requestChatComposerSend = useAppStore((s) => s.requestChatComposerSend)
  const agentAvailable = isAgentModeAvailable(providerId)

  const [actions, setActions] = useState<PinnedAction[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [managerOpen, setManagerOpen] = useState(false)
  const [pendingAction, setPendingAction] = useState<PinnedAction | null>(null)
  const barRef = useRef<HTMLDivElement>(null)
  const moreBtnRef = useRef<HTMLButtonElement>(null)

  const reload = useCallback(async (root: string): Promise<void> => {
    try {
      const data = await window.compass.pinnedActions.load(root)
      setActions(data.actions)
      setLoadError(null)
    } catch (err) {
      setActions([])
      setLoadError(getErrorMessage(err, t('pinnedActions.loadFailed')))
    }
  }, [t])

  useEffect(() => {
    if (!workspaceRoot) {
      setActions([])
      setLoadError(null)
      return
    }
    void reload(workspaceRoot)
  }, [workspaceRoot, reload])

  useEffect(() => {
    if (!menuOpen) return
    const handlePointer = (event: MouseEvent): void => {
      if (!barRef.current?.contains(event.target as Node)) {
        setMenuOpen(false)
      }
    }
    const handleKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setMenuOpen(false)
    }
    window.addEventListener('mousedown', handlePointer)
    window.addEventListener('keydown', handleKey, true)
    return () => {
      window.removeEventListener('mousedown', handlePointer)
      window.removeEventListener('keydown', handleKey, true)
    }
  }, [menuOpen])

  const barActions = useMemo(() => pickBarPinnedActions(actions), [actions])
  const menuActions = useMemo(() => {
    const barIds = new Set(barActions.map((a) => a.id))
    return actions.filter((a) => !barIds.has(a.id))
  }, [actions, barActions])

  const resolveMode = useCallback(
    (mode: ChatMode): ChatMode => {
      if (mode === 'agent' && !agentAvailable) return 'edit'
      return mode
    },
    [agentAvailable]
  )

  const sendAction = useCallback(
    (action: PinnedAction) => {
      const store = useAppStore.getState()
      const activeFile = store.getActiveFile()
      const mode = resolveMode(action.mode)
      const contextRefs =
        activeFile &&
        !activeFile.isPreview &&
        activeFile.viewKind !== 'settings' &&
        activeFile.viewKind !== 'compare' &&
        activeFile.viewKind !== 'browser'
          ? [
              {
                path: activeFile.path,
                name: getFileName(activeFile.path),
                isDirectory: false
              }
            ]
          : undefined

      requestChatComposerSend({
        text: action.prompt,
        mode,
        preset: action.preset,
        contextRefs
      })
      setMenuOpen(false)
      setPendingAction(null)
    },
    [requestChatComposerSend, resolveMode]
  )

  const runAction = useCallback(
    (action: PinnedAction) => {
      if (isChatLoading) return
      const mode = resolveMode(action.mode)
      if (mode === 'ask') {
        sendAction(action)
        return
      }
      setPendingAction({ ...action, mode })
      setMenuOpen(false)
    },
    [isChatLoading, resolveMode, sendAction]
  )

  if (!workspaceRoot) return null

  return (
    <>
      <div className="pinned-actions-bar" ref={barRef}>
        {barActions.length === 0 ? (
          <button
            type="button"
            className="pinned-actions-bar-empty"
            onClick={() => setManagerOpen(true)}
            title={t('pinnedActions.addHint')}
          >
            {t('pinnedActions.addEmpty')}
          </button>
        ) : (
          barActions.map((action) => (
            <button
              key={action.id}
              type="button"
              className="pinned-actions-bar-btn"
              disabled={isChatLoading}
              title={`${action.label} (${resolveMode(action.mode)})`}
              onClick={() => runAction(action)}
            >
              {action.label}
            </button>
          ))
        )}

        <div className="pinned-actions-bar-spacer" />

        {loadError ? (
          <span className="pinned-actions-bar-error" title={loadError}>
            !
          </span>
        ) : null}

        <div className="pinned-actions-more-wrap">
          <button
            ref={moreBtnRef}
            type="button"
            className={`pinned-actions-bar-btn pinned-actions-more-btn${menuOpen ? ' active' : ''}`}
            onClick={() => setMenuOpen((open) => !open)}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            title={t('pinnedActions.more')}
          >
            {t('pinnedActions.more')}
          </button>
          {menuOpen ? (
            <div className="pinned-actions-menu" role="menu">
              {menuActions.length > 0 ? (
                <>
                  <div className="pinned-actions-menu-header">{t('pinnedActions.otherActions')}</div>
                  {menuActions.map((action) => (
                    <button
                      key={action.id}
                      type="button"
                      role="menuitem"
                      className="pinned-actions-menu-item"
                      disabled={isChatLoading}
                      onClick={() => runAction(action)}
                    >
                      <span className="pinned-actions-menu-label">{action.label}</span>
                      <span className="pinned-actions-menu-mode">{resolveMode(action.mode)}</span>
                    </button>
                  ))}
                  <div className="pinned-actions-menu-separator" />
                </>
              ) : null}
              <button
                type="button"
                role="menuitem"
                className="pinned-actions-menu-item"
                onClick={() => {
                  setMenuOpen(false)
                  setManagerOpen(true)
                }}
              >
                {t('pinnedActions.manage')}
              </button>
            </div>
          ) : null}
        </div>
      </div>

      <PinnedActionsManagerDialog
        open={managerOpen}
        workspaceRoot={workspaceRoot}
        actions={actions}
        onClose={() => setManagerOpen(false)}
        onSaved={(next) => setActions(next)}
      />

      <ConfirmDialog
        open={pendingAction !== null}
        title={t('pinnedActions.confirmTitle')}
        message={
          pendingAction
            ? t('pinnedActions.confirmMessage', {
                label: pendingAction.label,
                mode: pendingAction.mode
              })
            : ''
        }
        confirmLabel={t('pinnedActions.run')}
        cancelLabel={t('common.cancel')}
        onConfirm={() => {
          if (pendingAction) sendAction(pendingAction)
        }}
        onCancel={() => setPendingAction(null)}
      />
    </>
  )
}
