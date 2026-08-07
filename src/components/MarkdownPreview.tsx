import { SafeMarkdown } from '@/components/SafeMarkdown'

interface MarkdownPreviewProps {
  content: string
}

export function MarkdownPreview({ content }: MarkdownPreviewProps) {
  return (
    <div className="markdown-preview">
      <SafeMarkdown content={content} />
    </div>
  )
}
