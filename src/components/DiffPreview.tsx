import { computeLineDiff } from '@/utils/code-blocks'

interface DiffPreviewProps {
  oldText: string
  newText: string
  title?: string
  onApply: () => void
  onReject: () => void
}

export function DiffPreview({ oldText, newText, title, onApply, onReject }: DiffPreviewProps) {
  const diff = computeLineDiff(oldText, newText)
  const isNew = oldText === ''

  return (
    <div className="diff-preview">
      <div className="diff-header">
        <span>{title ?? (isNew ? '新規ファイル' : '変更プレビュー')}</span>
        <div className="diff-actions">
          <button className="btn-apply" onClick={onApply}>
            適用
          </button>
          <button className="btn-reject" onClick={onReject}>
            拒否
          </button>
        </div>
      </div>
      <div className="diff-content">
        {diff.map((line, i) => (
          <div key={i} className={`diff-line diff-${line.type}`}>
            <span className="diff-prefix">
              {line.type === 'add' ? '+' : line.type === 'remove' ? '-' : ' '}
            </span>
            <span className="diff-text">{line.content}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
