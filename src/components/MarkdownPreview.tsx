import { useMemo } from 'react'
import { marked } from 'marked'
import { useI18n } from '@/i18n'

marked.setOptions({
  gfm: true,
  breaks: true
})

interface MarkdownPreviewProps {
  content: string
}

export function MarkdownPreview({ content }: MarkdownPreviewProps) {
  const { t } = useI18n()
  const html = useMemo(() => {
    try {
      return marked.parse(content) as string
    } catch {
      return t('markdown.previewFailed')
    }
  }, [content, t])

  return (
    <div className="markdown-preview">
      <div className="markdown-body" dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  )
}
