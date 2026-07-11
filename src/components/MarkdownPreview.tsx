import { useMemo } from 'react'
import { marked } from 'marked'

marked.setOptions({
  gfm: true,
  breaks: true
})

interface MarkdownPreviewProps {
  content: string
}

export function MarkdownPreview({ content }: MarkdownPreviewProps) {
  const html = useMemo(() => {
    try {
      return marked.parse(content) as string
    } catch {
      return '<p>プレビューの生成に失敗しました</p>'
    }
  }, [content])

  return (
    <div className="markdown-preview">
      <div className="markdown-body" dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  )
}
