import { useState } from 'react'
import type { ActionPreviewItem, WorkspaceAction } from '@/types'
import { computeLineDiff } from '@/utils/code-blocks'

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
  const [expanded, setExpanded] = useState(false)

  if (item.type === 'mkdir') {
    const meta = item.alreadyExists ? 'フォルダ（既存）' : '新規フォルダ'
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
        ? 'フォルダ削除（存在しません）'
        : 'ファイル削除（存在しません）'
      : item.type === 'deleteDir'
        ? 'フォルダ削除'
        : 'ファイル削除'

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

  const diff = computeLineDiff(item.oldContent, item.newContent)
  const meta = item.isNew ? '新規ファイル' : 'ファイル更新'

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
  if (fileCount > 0) parts.push(`ファイル ${fileCount}件`)
  if (dirCount > 0) parts.push(`フォルダ作成 ${dirCount}件`)
  if (deleteCount > 0) parts.push(`削除 ${deleteCount}件`)
  return parts.join(' · ')
}

export function WorkspaceActionPreview({
  items,
  onApply,
  onReject,
  onSelectItem
}: WorkspaceActionPreviewProps) {
  const summary = summarizePreviewItems(items)

  return (
    <div className="workspace-action-preview">
      <div className="diff-header">
        <span>AIの変更提案 ({summary})</span>
        <div className="diff-actions">
          <button className="btn-apply" onClick={onApply}>
            すべて適用
          </button>
          <button className="btn-reject" onClick={onReject}>
            拒否
          </button>
        </div>
      </div>
      <p className="action-preview-hint">クリックでエディタの差分表示を開きます</p>
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
