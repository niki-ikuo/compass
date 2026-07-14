import { useState, type ReactNode } from 'react'
import { AnimatedEllipsis, AnimatedStatus } from '@/components/AnimatedEllipsis'
import {
  getCodeLabel,
  parseChatSegments,
  parseInlineChatParts,
  splitStreamingContent,
  type InlineChatPart
} from '@/utils/chat-content'
import { stripAllCompassActionsContent } from '@/utils/workspace-actions'
import { useI18n } from '@/i18n'

interface ChatMessageContentProps {
  content: string
  isStreaming?: boolean
  /** When true, skip the bare "…" placeholder (e.g. Agent already shows a status line). */
  hideStreamingPlaceholder?: boolean
}

function pathMentionIcon(kind: 'file' | 'folder' | 'selection'): string {
  if (kind === 'folder') return '📁'
  if (kind === 'selection') return '≡'
  return '📄'
}

function renderInlineParts(parts: InlineChatPart[], keyPrefix: string): ReactNode[] {
  return parts.map((part, index) => {
    const key = `${keyPrefix}-${index}`
    if (part.type === 'text') {
      return <span key={key}>{part.content}</span>
    }
    if (part.type === 'path') {
      return (
        <span key={key} className={`chat-path-capsule kind-${part.kind}`} title={part.content}>
          <span className="chat-path-capsule-icon" aria-hidden="true">
            {pathMentionIcon(part.kind)}
          </span>
          <span className="chat-path-capsule-label">{part.content}</span>
        </span>
      )
    }
    return (
      <code key={key} className="chat-inline-code">
        {part.content}
      </code>
    )
  })
}

function ChatText({
  content,
  showCursor
}: {
  content: string
  showCursor?: boolean
}) {
  const parts = parseInlineChatParts(content)
  return (
    <p className="chat-text">
      {renderInlineParts(parts, 't')}
      {showCursor ? <span className="chat-streaming-cursor" aria-hidden="true" /> : null}
    </p>
  )
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
    return <ChatText content={sanitized} showCursor={isStreaming} />
  }

  return (
    <div className="chat-message-body">
      {segments.map((segment, index) => {
        if (segment.type === 'text') {
          const isLast = index === segments.length - 1 && !streamingCode
          return (
            <ChatText
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
