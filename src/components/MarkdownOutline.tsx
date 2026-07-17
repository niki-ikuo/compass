import { useMemo } from 'react'
import { useAppStore } from '@/stores/app-store'
import { parseMarkdownHeadings } from '@/utils/markdown-outline'
import { useI18n } from '@/i18n'

interface MarkdownOutlineProps {
  content: string
  filePath: string
}

export function MarkdownOutline({ content, filePath }: MarkdownOutlineProps) {
  const { t } = useI18n()
  const revealInEditor = useAppStore((s) => s.revealInEditor)
  const headings = useMemo(() => parseMarkdownHeadings(content), [content])

  return (
    <aside className="markdown-outline" aria-label={t('editor.outline')}>
      <div className="markdown-outline-header">{t('editor.outline')}</div>
      {headings.length === 0 ? (
        <div className="markdown-outline-empty">{t('editor.outlineEmpty')}</div>
      ) : (
        <ul className="markdown-outline-list">
          {headings.map((heading) => (
            <li key={`${heading.line}-${heading.level}-${heading.text}`}>
              <button
                type="button"
                className={`markdown-outline-item level-${heading.level}`}
                title={`${heading.text} (L${heading.line})`}
                onClick={() => revealInEditor(filePath, heading.line, 1, Math.max(2, heading.text.length + 1))}
              >
                {heading.text}
              </button>
            </li>
          ))}
        </ul>
      )}
    </aside>
  )
}
