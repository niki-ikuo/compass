import { useEffect, useMemo, useRef, useState } from 'react'
import { useI18n } from '@/i18n'
import {
  buildSaveTemplateActions,
  draftsFromEffectiveTemplates,
  ensureUniqueTemplateId,
  isBuiltinDocTemplateId,
  listEffectiveDocTemplates,
  loadWorkspaceDocTemplates,
  normalizeTemplateFileName,
  reindexDraftOrders,
  slugifyTemplateId,
  type WorkspaceTemplateDraft
} from '@/utils/doc-templates'
import { CloseIcon } from './icons/ToolbarIcons'

interface TemplateManagerDialogProps {
  open: boolean
  workspaceRoot: string
  onClose: () => void
  onSaved: () => void
}

function draftKey(draft: WorkspaceTemplateDraft, index: number): string {
  return `${draft.id}::${index}`
}

export function TemplateManagerDialog({
  open,
  workspaceRoot,
  onClose,
  onSaved
}: TemplateManagerDialogProps) {
  const { t, locale } = useI18n()
  const [drafts, setDrafts] = useState<WorkspaceTemplateDraft[]>([])
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [previousWorkspaceIds, setPreviousWorkspaceIds] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)
  const labelRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    let cancelled = false

    const load = async (): Promise<void> => {
      setLoading(true)
      setError(null)
      try {
        const [effective, workspace] = await Promise.all([
          listEffectiveDocTemplates(workspaceRoot, locale),
          loadWorkspaceDocTemplates(workspaceRoot, {
            readDir: (dirPath, options) => window.compass.fs.readDir(dirPath, options),
            readFile: (filePath) => window.compass.fs.readFile(filePath)
          })
        ])
        if (cancelled) return
        const nextDrafts = draftsFromEffectiveTemplates(effective, (template) =>
          template.labelKey ? t(template.labelKey) : (template.label ?? template.id)
        )
        setDrafts(nextDrafts)
        setPreviousWorkspaceIds(workspace.map((item) => item.id))
        setSelectedIndex(0)
        setDirty(false)
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : t('templateManager.loadFailed'))
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [open, workspaceRoot, locale, t])

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
    if (open && !loading) {
      labelRef.current?.focus()
    }
  }, [open, loading, selectedIndex])

  const selected = drafts[selectedIndex] ?? null

  const canMoveUp = selectedIndex > 0
  const canMoveDown = selectedIndex >= 0 && selectedIndex < drafts.length - 1

  const updateSelected = (patch: Partial<WorkspaceTemplateDraft>): void => {
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
      return reindexDraftOrders(next)
    })
    setSelectedIndex(target)
    setDirty(true)
  }

  const addTemplate = (): void => {
    const id = ensureUniqueTemplateId(
      'new-template',
      drafts.map((draft) => draft.id)
    )
    const draft: WorkspaceTemplateDraft = {
      id,
      label: t('templateManager.newLabel'),
      defaultFileName: `${id}.md`,
      body: `# ${t('templateManager.newLabel')}\n\n`,
      order: drafts.length * 100
    }
    setDrafts((prev) => reindexDraftOrders([...prev, draft]))
    setSelectedIndex(drafts.length)
    setDirty(true)
  }

  const removeSelected = (): void => {
    if (!selected || isBuiltinDocTemplateId(selected.id)) return
    setDrafts((prev) => reindexDraftOrders(prev.filter((_, index) => index !== selectedIndex)))
    setSelectedIndex((prev) => Math.max(0, Math.min(prev, drafts.length - 2)))
    setDirty(true)
  }

  const validationError = useMemo(() => {
    if (!selected) return null
    if (!selected.label.trim()) return t('templateManager.labelRequired')
    if (!selected.defaultFileName.trim()) return t('templateManager.fileNameRequired')
    const normalized = normalizeTemplateFileName(selected.defaultFileName)
    if (/[<>:"/\\|?*]/.test(normalized)) return t('templateManager.fileNameInvalid')
    return null
  }, [selected, t])

  const handleSave = async (): Promise<void> => {
    if (validationError) {
      setError(validationError)
      return
    }
    for (const draft of drafts) {
      if (!draft.label.trim() || !draft.defaultFileName.trim()) {
        setError(t('templateManager.incomplete'))
        return
      }
    }

    setSaving(true)
    setError(null)
    try {
      const normalized = reindexDraftOrders(
        drafts.map((draft) => ({
          ...draft,
          label: draft.label.trim(),
          defaultFileName: normalizeTemplateFileName(draft.defaultFileName),
          id: draft.id || ensureUniqueTemplateId(slugifyTemplateId(draft.defaultFileName), [])
        }))
      )
      const actions = buildSaveTemplateActions(normalized, previousWorkspaceIds)
      await window.compass.fs.applyActions(workspaceRoot, actions)
      setDrafts(normalized)
      setPreviousWorkspaceIds(normalized.map((draft) => draft.id))
      setDirty(false)
      onSaved()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('templateManager.saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  if (!open) return null

  return (
    <div className="modal-overlay" onMouseDown={onClose}>
      <div
        className="modal modal-wide template-manager-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="template-manager-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="modal-header">
          <h2 id="template-manager-title">{t('templateManager.title')}</h2>
          <button
            className="btn-icon"
            onClick={onClose}
            title={t('common.close')}
            aria-label={t('common.close')}
          >
            <CloseIcon />
          </button>
        </div>

        <div className="modal-body template-manager-body">
          {loading ? (
            <p className="template-manager-status">{t('templateManager.loading')}</p>
          ) : (
            <div className="template-manager-layout">
              <div className="template-manager-sidebar">
                <div className="template-manager-sidebar-actions">
                  <button type="button" className="btn-secondary" onClick={addTemplate}>
                    {t('templateManager.add')}
                  </button>
                  <button
                    type="button"
                    className="btn-icon"
                    disabled={!canMoveUp}
                    onClick={() => moveSelected(-1)}
                    title={t('templateManager.moveUp')}
                    aria-label={t('templateManager.moveUp')}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className="btn-icon"
                    disabled={!canMoveDown}
                    onClick={() => moveSelected(1)}
                    title={t('templateManager.moveDown')}
                    aria-label={t('templateManager.moveDown')}
                  >
                    ↓
                  </button>
                </div>
                <ul className="template-manager-list">
                  {drafts.map((draft, index) => (
                    <li key={draftKey(draft, index)}>
                      <button
                        type="button"
                        className={
                          index === selectedIndex
                            ? 'template-manager-list-item active'
                            : 'template-manager-list-item'
                        }
                        onClick={() => setSelectedIndex(index)}
                      >
                        <span className="template-manager-list-label">{draft.label || draft.id}</span>
                        <span className="template-manager-list-meta">{draft.defaultFileName}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="template-manager-editor">
                {selected ? (
                  <>
                    <label>
                      {t('templateManager.label')}
                      <input
                        ref={labelRef}
                        value={selected.label}
                        onChange={(event) => updateSelected({ label: event.target.value })}
                      />
                    </label>
                    <label>
                      {t('templateManager.fileName')}
                      <input
                        value={selected.defaultFileName}
                        onChange={(event) => updateSelected({ defaultFileName: event.target.value })}
                      />
                    </label>
                    <label className="template-manager-body-label">
                      {t('templateManager.body')}
                      <textarea
                        value={selected.body}
                        onChange={(event) => updateSelected({ body: event.target.value })}
                        spellCheck={false}
                      />
                    </label>
                    <div className="template-manager-editor-actions">
                      <button
                        type="button"
                        className="btn-danger"
                        onClick={removeSelected}
                        disabled={!selected || isBuiltinDocTemplateId(selected.id)}
                        title={
                          selected && isBuiltinDocTemplateId(selected.id)
                            ? t('templateManager.cannotRemoveBuiltin')
                            : undefined
                        }
                      >
                        {t('templateManager.remove')}
                      </button>
                    </div>
                  </>
                ) : (
                  <p className="template-manager-status">{t('templateManager.empty')}</p>
                )}
              </div>
            </div>
          )}
          {(error || validationError) && (
            <p className="template-manager-error">{error ?? validationError}</p>
          )}
        </div>

        <div className="modal-footer">
          <button className="btn-secondary" onClick={onClose} disabled={saving}>
            {t('common.cancel')}
          </button>
          <button
            className="btn-primary"
            onClick={() => void handleSave()}
            disabled={saving || loading || !dirty || Boolean(validationError)}
          >
            {saving ? t('templateManager.saving') : t('templateManager.save')}
          </button>
        </div>
      </div>
    </div>
  )
}
