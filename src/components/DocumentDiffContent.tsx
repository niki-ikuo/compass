import { computeLineDiff } from '@/utils/code-blocks'
import {
  compactProseDiffLines,
  diffMarkdownHeadings,
  type CompactDiffEntry
} from '@/utils/markdown-outline'
import { useI18n } from '@/i18n'

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
  if (entry.type === 'heading') {
    return (
      <div className="diff-line diff-heading-context" title={entry.text}>
        <span className="diff-prefix">§</span>
        <span className="diff-text">
          <span className="document-diff-heading-level">{'#'.repeat(entry.level)}</span>{' '}
          {entry.text}
        </span>
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

/** Markdown 向け: 見出し集合の差分 + 変更塊の見出し文脈付きコンパクト Diff */
export function DocumentDiffContent({
  oldContent,
  newContent,
  className = 'diff-content nested document-diff'
}: {
  oldContent: string
  newContent: string
  className?: string
}) {
  const { t } = useI18n()
  const headingChanges = diffMarkdownHeadings(oldContent, newContent)
  const compact = compactProseDiffLines(computeLineDiff(oldContent, newContent), oldContent, 2)

  return (
    <div className={className}>
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
