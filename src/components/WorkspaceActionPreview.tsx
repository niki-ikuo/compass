import { useState } from 'react'
import type { ActionPreviewItem, WorkspaceAction } from '@/types'
import { computeLineDiff } from '@/utils/code-blocks'
import { useI18n, t } from '@/i18n'

interface WorkspaceActionPreviewProps {
  items: ActionPreviewItem[]
  onApply: () => void
  onReject: () => void
  onSelectItem?: (item: ActionPreviewItem) => void
}

function ActionItemPreview({
  item,
  onSelect
}: {
  item: ActionPreviewItem
  onSelect?: (item: ActionPreviewItem) => void
}) {
  const { t } = useI18n()
  const [expanded, setExpanded] = useState(false)

  if (item.type === 'mkdir') {
    const meta = item.alreadyExists ? t('preview.folderExisting') : t('preview.folderNew')
    return (
      <div className="action-preview-item mkdir">
        <div className="action-preview-header">
          <span className="action-preview-icon">📁</span>
          <div className="action-preview-info">
            <span className="action-preview-path" title={item.relativePath}>
              {item.relativePath}
            </span>
            <span className="action-preview-meta">{meta}</span>
          </div>
        </div>
      </div>
    )
  }

  if (item.type === 'deleteFile' || item.type === 'deleteDir') {
    const meta = !item.exists
      ? item.type === 'deleteDir'
        ? t('preview.deleteDirMissing')
        : t('preview.deleteFileMissing')
      : item.type === 'deleteDir'
        ? t('preview.deleteDir')
        : t('preview.deleteFile')

    return (
      <div className="action-preview-item delete">
        <div className="action-preview-header">
          <span className="action-preview-icon">{item.type === 'deleteDir' ? '📁' : '📄'}</span>
          <div className="action-preview-info">
            <span className="action-preview-path" title={item.relativePath}>
              {item.relativePath}
            </span>
            <span className="action-preview-meta">{meta}</span>
          </div>
        </div>
      </div>
    )
  }

  if (item.type !== 'writeFile') return null

  const diff = computeLineDiff(item.oldContent, item.newContent)
  const meta = item.isNew ? t('preview.fileNew') : t('preview.fileUpdate')

  return (
    <div className="action-preview-item write">
      <button
        type="button"
        className="action-preview-header clickable"
        onClick={() => {
          setExpanded(!expanded)
          onSelect?.(item)
        }}
      >
        <span className="action-preview-chevron">{expanded ? '▼' : '▶'}</span>
        <span className="action-preview-icon">📄</span>
        <div className="action-preview-info">
          <span className="action-preview-path" title={item.relativePath}>
            {item.relativePath}
          </span>
          <span className="action-preview-meta">{meta}</span>
        </div>
      </button>
      {expanded && (
        <div className="diff-content nested">
          {diff.map((line, i) => (
            <div key={i} className={`diff-line diff-${line.type}`}>
              <span className="diff-prefix">
                {line.type === 'add' ? '+' : line.type === 'remove' ? '-' : ' '}
              </span>
              <span className="diff-text">{line.content}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function summarizePreviewItems(items: ActionPreviewItem[]): string {
  const fileCount = items.filter((i) => i.type === 'writeFile').length
  const dirCount = items.filter((i) => i.type === 'mkdir').length
  const deleteCount = items.filter(
    (i) => i.type === 'deleteFile' || i.type === 'deleteDir'
  ).length
  const parts: string[] = []
  if (fileCount > 0) parts.push(t('preview.files', { count: fileCount }))
  if (dirCount > 0) parts.push(t('preview.mkdir', { count: dirCount }))
  if (deleteCount > 0) parts.push(t('preview.delete', { count: deleteCount }))
  return parts.join(' · ')
}

export function WorkspaceActionPreview({
  items,
  onApply,
  onReject,
  onSelectItem
}: WorkspaceActionPreviewProps) {
  const { t } = useI18n()
  const summary = summarizePreviewItems(items)

  return (
    <div className="workspace-action-preview">
      <div className="diff-header">
        <span>{t('preview.proposalTitle', { summary })}</span>
        <div className="diff-actions">
          <button className="btn-apply" onClick={onApply}>
            {t('preview.applyAll')}
          </button>
          <button className="btn-reject" onClick={onReject}>
            {t('editor.reject')}
          </button>
        </div>
      </div>
      <p className="action-preview-hint">{t('preview.openDiffHint')}</p>
      <div className="action-preview-list">
        {items.map((item, index) => (
          <ActionItemPreview
            key={`${item.type}-${item.relativePath}-${index}`}
            item={item}
            onSelect={onSelectItem}
          />
        ))}
      </div>
    </div>
  )
}

export type PendingWorkspaceActions = {
  actions: WorkspaceAction[]
  items: ActionPreviewItem[]
}
