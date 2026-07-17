import { useState } from 'react'
import type { ActionPreviewItem, WorkspaceAction } from '@/types'
import { computeLineDiff } from '@/utils/code-blocks'
import { getApplyErrorTone } from '@/utils/apply-error'
import { isMarkdownFile } from '@/utils/language'
import {
  compactDiffLines,
  diffMarkdownHeadings,
  type CompactDiffEntry
} from '@/utils/markdown-outline'
import { useI18n, t } from '@/i18n'

interface WorkspaceActionPreviewProps {
  items: ActionPreviewItem[]
  onApply: () => void
  onReject: () => void
  onSelectItem?: (item: ActionPreviewItem) => void
  applyError?: string | null
  /** Agent approval pending + apply failed → send error back to the loop */
  onAskAgentFix?: () => void
}

function DocumentDiffContent({
  oldContent,
  newContent
}: {
  oldContent: string
  newContent: string
}) {
  const { t } = useI18n()
  const headingChanges = diffMarkdownHeadings(oldContent, newContent)
  const compact = compactDiffLines(computeLineDiff(oldContent, newContent), 1)

  return (
    <div className="diff-content nested document-diff">
      {headingChanges.length > 0 && (
        <div className="document-diff-headings">
          <div className="document-diff-headings-title">{t('diff.headingChanges')}</div>
          <ul className="document-diff-heading-list">
            {headingChanges.map((change, index) => (
              <li
                key={`${change.kind}-${change.level}-${change.text}-${index}`}
                className={`document-diff-heading document-diff-${change.kind}`}
              >
                <span className="document-diff-heading-mark">
                  {change.kind === 'added' ? '+' : '−'}
                </span>
                <span className="document-diff-heading-level">{'#'.repeat(change.level)}</span>
                <span className="document-diff-heading-text">{change.text}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {compact.map((entry, i) => (
        <CompactDiffLine key={i} entry={entry} />
      ))}
    </div>
  )
}

function CompactDiffLine({ entry }: { entry: CompactDiffEntry }) {
  const { t } = useI18n()
  if (entry.type === 'skip') {
    return (
      <div className="diff-line diff-skip">
        <span className="diff-prefix">…</span>
        <span className="diff-text">{t('diff.omittedLines', { count: entry.count })}</span>
      </div>
    )
  }
  return (
    <div className={`diff-line diff-${entry.type}`}>
      <span className="diff-prefix">
        {entry.type === 'add' ? '+' : entry.type === 'remove' ? '-' : ' '}
      </span>
      <span className="diff-text">{entry.content}</span>
    </div>
  )
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

  const isMarkdown = isMarkdownFile(item.relativePath)
  const diff = isMarkdown ? null : computeLineDiff(item.oldContent, item.newContent)
  const meta = item.isNew
    ? t('preview.fileNew')
    : isMarkdown
      ? t('preview.fileUpdateDocument')
      : t('preview.fileUpdate')

  return (
    <div className={`action-preview-item write${isMarkdown ? ' document' : ''}`}>
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
      {expanded &&
        (isMarkdown ? (
          <DocumentDiffContent oldContent={item.oldContent} newContent={item.newContent} />
        ) : (
          <div className="diff-content nested">
            {diff?.map((line, i) => (
              <div key={i} className={`diff-line diff-${line.type}`}>
                <span className="diff-prefix">
                  {line.type === 'add' ? '+' : line.type === 'remove' ? '-' : ' '}
                </span>
                <span className="diff-text">{line.content}</span>
              </div>
            ))}
          </div>
        ))}
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
  onSelectItem,
  applyError,
  onAskAgentFix
}: WorkspaceActionPreviewProps) {
  const { t } = useI18n()
  const summary = summarizePreviewItems(items)
  const showAskAgent = Boolean(applyError && onAskAgentFix)
  const applyErrorTone = getApplyErrorTone(applyError)
  const isWarning = applyErrorTone === 'warning'

  return (
    <div className="workspace-action-preview">
      <div className="diff-header">
        <span>{t('preview.proposalTitle', { summary })}</span>
        <div className="diff-actions">
          <button className="btn-apply" onClick={onApply}>
            {applyError ? t('chat.retryApply') : t('preview.applyAll')}
          </button>
          {showAskAgent ? (
            <button className="btn-secondary" type="button" onClick={onAskAgentFix}>
              {t('chat.askAgentToFix')}
            </button>
          ) : null}
          <button className="btn-reject" onClick={onReject}>
            {t('editor.reject')}
          </button>
        </div>
      </div>
      {applyError ? (
        <p className={`action-preview-error action-preview-${applyErrorTone}`}>
          {isWarning
            ? t('chat.patchMismatchError', { message: applyError })
            : t('chat.fileOpError', { message: applyError })}
          <span className="action-preview-retry-hint">
            {showAskAgent
              ? isWarning
                ? t('chat.patchMismatchAskAgentHint')
                : t('chat.applyFailedAskAgentHint')
              : isWarning
                ? t('chat.patchMismatchRetryHint')
                : t('chat.applyRetryHint')}
          </span>
        </p>
      ) : (
        <p className="action-preview-hint">{t('preview.openDiffHint')}</p>
      )}
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
