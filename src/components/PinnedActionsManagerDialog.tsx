import { useEffect, useMemo, useRef, useState } from 'react'
import type { ChatMode, PinnedAction, UseCasePreset, WorkspacePinnedActions } from '@/types'
import { PINNED_ACTIONS_BAR_MAX } from '@/types'
import { useI18n } from '@/i18n'
import {
  canPinMore,
  createBlankPinnedAction,
  PINNED_ACTION_MODE_OPTIONS
} from '@/utils/pinned-actions'
import { getErrorMessage } from '@/utils/error-message'
import { isAgentModeAvailable } from '@/utils/llm-providers'
import { useAppStore } from '@/stores/app-store'
import { CloseIcon } from './icons/ToolbarIcons'

interface PinnedActionsManagerDialogProps {
  open: boolean
  workspaceRoot: string
  actions: PinnedAction[]
  onClose: () => void
  onSaved: (actions: PinnedAction[]) => void
}

function draftKey(action: PinnedAction, index: number): string {
  return `${action.id}::${index}`
}

export function PinnedActionsManagerDialog({
  open,
  workspaceRoot,
  actions,
  onClose,
  onSaved
}: PinnedActionsManagerDialogProps) {
  const { t } = useI18n()
  const providerId = useAppStore((s) => s.settings.providerId)
  const agentAvailable = isAgentModeAvailable(providerId)
  const [drafts, setDrafts] = useState<PinnedAction[]>([])
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)
  const labelRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    setDrafts(actions.map((action) => ({ ...action })))
    setSelectedIndex(0)
    setError(null)
    setDirty(false)
  }, [open, actions])

  useEffect(() => {
    if (!open) return
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [open, onClose])

  useEffect(() => {
    if (open) {
      labelRef.current?.focus()
    }
  }, [open, selectedIndex])

  const selected = drafts[selectedIndex] ?? null
  const canMoveUp = selectedIndex > 0
  const canMoveDown = selectedIndex >= 0 && selectedIndex < drafts.length - 1

  const updateSelected = (patch: Partial<PinnedAction>): void => {
    if (!selected) return
    setDrafts((prev) =>
      prev.map((draft, index) => (index === selectedIndex ? { ...draft, ...patch } : draft))
    )
    setDirty(true)
  }

  const moveSelected = (direction: -1 | 1): void => {
    const target = selectedIndex + direction
    if (target < 0 || target >= drafts.length) return
    setDrafts((prev) => {
      const next = [...prev]
      const [item] = next.splice(selectedIndex, 1)
      next.splice(target, 0, item)
      return next
    })
    setSelectedIndex(target)
    setDirty(true)
  }

  const addAction = (): void => {
    const draft = createBlankPinnedAction(t('pinnedActions.newLabel'))
    if (!canPinMore(drafts)) {
      draft.pinned = false
    }
    setDrafts((prev) => [...prev, draft])
    setSelectedIndex(drafts.length)
    setDirty(true)
  }

  const removeSelected = (): void => {
    if (!selected) return
    setDrafts((prev) => prev.filter((_, index) => index !== selectedIndex))
    setSelectedIndex((prev) => Math.max(0, Math.min(prev, drafts.length - 2)))
    setDirty(true)
  }

  const validationError = useMemo(() => {
    if (!selected) return null
    if (!selected.label.trim()) return t('pinnedActions.labelRequired')
    if (!selected.prompt.trim()) return t('pinnedActions.promptRequired')
    return null
  }, [selected, t])

  const handleSave = async (): Promise<void> => {
    if (validationError) {
      setError(validationError)
      return
    }
    for (const draft of drafts) {
      if (!draft.label.trim() || !draft.prompt.trim()) {
        setError(t('pinnedActions.incomplete'))
        return
      }
    }

    setSaving(true)
    setError(null)
    try {
      const payload: WorkspacePinnedActions = {
        version: 1,
        actions: drafts.map((draft) => {
          const mode: ChatMode =
            draft.mode === 'agent' && !agentAvailable ? 'edit' : draft.mode
          const preset = draft.preset
          const next: PinnedAction = {
            id: draft.id,
            label: draft.label.trim(),
            prompt: draft.prompt.trim(),
            mode,
            pinned: draft.pinned === true
          }
          if (preset) next.preset = preset
          return next
        })
      }
      const saved = await window.compass.pinnedActions.save(workspaceRoot, payload)
      setDrafts(saved.actions)
      setDirty(false)
      onSaved(saved.actions)
      onClose()
    } catch (err) {
      setError(getErrorMessage(err, t('pinnedActions.saveFailed')))
    } finally {
      setSaving(false)
    }
  }

  if (!open) return null

  return (
    <div className="modal-overlay" onMouseDown={onClose}>
      <div
        className="modal modal-wide pinned-actions-manager-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="pinned-actions-manager-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="modal-header">
          <h2 id="pinned-actions-manager-title">{t('pinnedActions.manageTitle')}</h2>
          <button
            className="btn-icon"
            onClick={onClose}
            title={t('common.close')}
            aria-label={t('common.close')}
          >
            <CloseIcon />
          </button>
        </div>

        <div className="modal-body pinned-actions-manager-body">
          <div className="pinned-actions-manager-layout">
            <div className="pinned-actions-manager-sidebar">
              <div className="pinned-actions-manager-sidebar-actions">
                <button type="button" className="btn-secondary" onClick={addAction}>
                  {t('pinnedActions.add')}
                </button>
                <button
                  type="button"
                  className="btn-icon"
                  disabled={!canMoveUp}
                  onClick={() => moveSelected(-1)}
                  title={t('pinnedActions.moveUp')}
                  aria-label={t('pinnedActions.moveUp')}
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="btn-icon"
                  disabled={!canMoveDown}
                  onClick={() => moveSelected(1)}
                  title={t('pinnedActions.moveDown')}
                  aria-label={t('pinnedActions.moveDown')}
                >
                  ↓
                </button>
              </div>
              <ul className="pinned-actions-manager-list">
                {drafts.map((draft, index) => (
                  <li key={draftKey(draft, index)}>
                    <button
                      type="button"
                      className={
                        index === selectedIndex
                          ? 'pinned-actions-manager-list-item active'
                          : 'pinned-actions-manager-list-item'
                      }
                      onClick={() => setSelectedIndex(index)}
                    >
                      <span className="pinned-actions-manager-list-label">
                        {draft.pinned ? (
                          <span className="pinned-actions-manager-pin-mark" aria-hidden="true" />
                        ) : null}
                        {draft.label || draft.id}
                      </span>
                      <span className="pinned-actions-manager-list-meta">{draft.mode}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>

            <div className="pinned-actions-manager-editor">
              {selected ? (
                <>
                  <label>
                    {t('pinnedActions.label')}
                    <input
                      ref={labelRef}
                      value={selected.label}
                      onChange={(event) => updateSelected({ label: event.target.value })}
                    />
                  </label>
                  <label className="pinned-actions-manager-body-label">
                    {t('pinnedActions.prompt')}
                    <textarea
                      value={selected.prompt}
                      onChange={(event) => updateSelected({ prompt: event.target.value })}
                      spellCheck={false}
                      rows={8}
                    />
                  </label>
                  <label>
                    {t('pinnedActions.mode')}
                    <select
                      value={selected.mode}
                      onChange={(event) =>
                        updateSelected({ mode: event.target.value as ChatMode })
                      }
                    >
                      {PINNED_ACTION_MODE_OPTIONS.map((mode) => (
                        <option
                          key={mode}
                          value={mode}
                          disabled={mode === 'agent' && !agentAvailable}
                        >
                          {mode === 'ask'
                            ? t('pinnedActions.modeAsk')
                            : mode === 'edit'
                              ? t('pinnedActions.modeEdit')
                              : t('pinnedActions.modeAgent')}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    {t('chat.useCasePreset')}
                    <select
                      value={selected.preset ?? ''}
                      onChange={(event) => {
                        const value = event.target.value as UseCasePreset | ''
                        updateSelected({
                          preset: value === '' ? undefined : value
                        })
                      }}
                    >
                      <option value="">{t('pinnedActions.presetDefault')}</option>
                      <option value="general">{t('chat.preset.general')}</option>
                      <option value="document">{t('chat.preset.document')}</option>
                      <option value="data">{t('chat.preset.data')}</option>
                      <option value="code">{t('chat.preset.code')}</option>
                    </select>
                  </label>
                  <label className="pinned-actions-manager-checkbox">
                    <input
                      type="checkbox"
                      checked={selected.pinned}
                      disabled={!selected.pinned && !canPinMore(drafts, selected.id)}
                      onChange={(event) => updateSelected({ pinned: event.target.checked })}
                    />
                    <span>
                      {t('pinnedActions.showOnBar', { max: String(PINNED_ACTIONS_BAR_MAX) })}
                    </span>
                  </label>
                  <div className="pinned-actions-manager-editor-actions">
                    <button type="button" className="btn-danger" onClick={removeSelected}>
                      {t('pinnedActions.remove')}
                    </button>
                  </div>
                </>
              ) : (
                <p className="pinned-actions-manager-status">{t('pinnedActions.empty')}</p>
              )}
            </div>
          </div>
          {(error || validationError) && (
            <p className="pinned-actions-manager-error">{error ?? validationError}</p>
          )}
        </div>

        <div className="modal-footer">
          <button className="btn-secondary" onClick={onClose} disabled={saving}>
            {t('common.cancel')}
          </button>
          <button
            className="btn-primary"
            onClick={() => void handleSave()}
            disabled={saving || !dirty || Boolean(validationError)}
          >
            {saving ? t('pinnedActions.saving') : t('pinnedActions.save')}
          </button>
        </div>
      </div>
    </div>
  )
}
