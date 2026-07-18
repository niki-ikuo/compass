import { useState, type ReactNode } from 'react'
import { AnimatedEllipsis, AnimatedStatus } from '@/components/AnimatedEllipsis'
import { ChatMarkdown } from '@/components/ChatMarkdown'
import {
  getCodeLabel,
  parseChatSegments,
  splitStreamingContent
} from '@/utils/chat-content'
import { stripAllCompassActionsContent } from '@/utils/workspace-actions'
import { useI18n } from '@/i18n'

interface ChatMessageContentProps {
  content: string
  isStreaming?: boolean
  /** When true, skip the bare "…" placeholder (e.g. Agent already shows a status line). */
  hideStreamingPlaceholder?: boolean
}

function CodeAccordion({
  label,
  meta,
  code,
  isActions,
  streaming = false
}: {
  label: string
  meta: ReactNode
  code: string
  isActions?: boolean
  streaming?: boolean
}) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)

  if (isActions) {
    return (
      <div className="chat-code-block actions static">
        <div className="chat-code-header static">
          <span className="chat-code-icon">📁</span>
          <span className="chat-code-label">{label}</span>
          <span className="chat-code-meta">{meta}</span>
        </div>
        <p className="chat-actions-hint">{t('chat.actionsHint')}</p>
      </div>
    )
  }

  if (streaming) {
    return (
      <div className="chat-code-block streaming">
        <div className="chat-code-header static">
          <span className="chat-code-chevron">▶</span>
          <span className="chat-code-icon">📄</span>
          <span className="chat-code-label">{label}</span>
          <span className="chat-code-meta">{meta}</span>
        </div>
      </div>
    )
  }

  return (
    <div className="chat-code-block">
      <button
        type="button"
        className="chat-code-header"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
      >
        <span className="chat-code-chevron">{open ? '▼' : '▶'}</span>
        <span className="chat-code-icon">📄</span>
        <span className="chat-code-label">{label}</span>
        <span className="chat-code-meta">{meta}</span>
      </button>
      {open && <pre className="chat-code-body">{code}</pre>}
    </div>
  )
}

export function ChatMessageContent({
  content,
  isStreaming,
  hideStreamingPlaceholder
}: ChatMessageContentProps) {
  const { t } = useI18n()

  if (!content) {
    if (!isStreaming || hideStreamingPlaceholder) return null
    return (
      <span className="chat-streaming">
        <AnimatedEllipsis />
      </span>
    )
  }

  const sanitized = stripAllCompassActionsContent(content)

  const { complete, streamingCode } = isStreaming
    ? splitStreamingContent(sanitized)
    : { complete: sanitized, streamingCode: null }

  const segments = parseChatSegments(complete).filter(
    (segment) => !(segment.type === 'code' && segment.isActions)
  )

  if (segments.length === 0 && !streamingCode) {
    if (!sanitized.trim()) {
      if (!isStreaming || hideStreamingPlaceholder) return null
      return (
        <span className="chat-streaming">
          <AnimatedStatus label={t('chat.preparingChangesShort')} />
        </span>
      )
    }
    return <ChatMarkdown content={sanitized} showCursor={isStreaming} />
  }

  return (
    <div className="chat-message-body">
      {segments.map((segment, index) => {
        if (segment.type === 'text') {
          const isLast = index === segments.length - 1 && !streamingCode
          return (
            <ChatMarkdown
              key={index}
              content={segment.content}
              showCursor={Boolean(isStreaming && isLast)}
            />
          )
        }

        return (
          <CodeAccordion
            key={index}
            label={segment.label}
            meta={segment.meta}
            code={segment.code}
            isActions={segment.isActions}
          />
        )
      })}
      {streamingCode && streamingCode.language.toLowerCase() !== 'compass-actions' && (
        <CodeAccordion
          label={getCodeLabel(streamingCode.language, streamingCode.code).label}
          meta={<AnimatedStatus label={t('chat.generating')} />}
          code={streamingCode.code}
          streaming
        />
      )}
    </div>
  )
}
