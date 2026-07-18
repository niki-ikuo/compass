import { type ReactNode } from 'react'
import { Lexer, type Token, type Tokens } from 'marked'
import { detectMentionKind, isStructuredMention } from '@/utils/chat-mentions'
import { isPathMention } from '@/utils/chat-content'
import { isSafeChatHref, splitStructuredPathMentions } from '@/utils/chat-markdown'

const CHAT_MARKDOWN_OPTIONS = { gfm: true, breaks: true } as const

function pathMentionIcon(kind: 'file' | 'folder' | 'selection'): string {
  if (kind === 'folder') return '📁'
  if (kind === 'selection') return '≡'
  return '📄'
}

function PathCapsule({ content }: { content: string }) {
  const kind = detectMentionKind(content)
  return (
    <span className={`chat-path-capsule kind-${kind}`} title={content}>
      <span className="chat-path-capsule-icon" aria-hidden="true">
        {pathMentionIcon(kind)}
      </span>
      <span className="chat-path-capsule-label">{content}</span>
    </span>
  )
}

function renderTextWithMentions(text: string, keyPrefix: string): ReactNode[] {
  return splitStructuredPathMentions(text).map((piece, index) => {
    const key = `${keyPrefix}-t${index}`
    if (piece.type === 'path' && isStructuredMention(piece.content)) {
      return <PathCapsule key={key} content={piece.content} />
    }
    return <span key={key}>{piece.content}</span>
  })
}

function renderInline(tokens: Token[] | undefined, keyPrefix: string): ReactNode[] {
  if (!tokens?.length) return []

  const nodes: ReactNode[] = []
  tokens.forEach((token, index) => {
    const key = `${keyPrefix}-${index}`
    switch (token.type) {
      case 'text': {
        const textToken = token as Tokens.Text
        if (textToken.tokens?.length) {
          nodes.push(...renderInline(textToken.tokens, key))
        } else {
          nodes.push(...renderTextWithMentions(textToken.text, key))
        }
        break
      }
      case 'strong':
        nodes.push(
          <strong key={key}>{renderInline((token as Tokens.Strong).tokens, key)}</strong>
        )
        break
      case 'em':
        nodes.push(<em key={key}>{renderInline((token as Tokens.Em).tokens, key)}</em>)
        break
      case 'del':
        nodes.push(<del key={key}>{renderInline((token as Tokens.Del).tokens, key)}</del>)
        break
      case 'codespan': {
        const text = (token as Tokens.Codespan).text
        if (isPathMention(text)) {
          nodes.push(<PathCapsule key={key} content={text} />)
        } else {
          nodes.push(
            <code key={key} className="chat-inline-code">
              {text}
            </code>
          )
        }
        break
      }
      case 'link': {
        const link = token as Tokens.Link
        if (!isSafeChatHref(link.href)) {
          nodes.push(...renderInline(link.tokens, key))
        } else {
          nodes.push(
            <a key={key} href={link.href} target="_blank" rel="noreferrer noopener">
              {renderInline(link.tokens, key)}
            </a>
          )
        }
        break
      }
      case 'image': {
        const image = token as Tokens.Image
        nodes.push(<span key={key}>{image.text || image.href}</span>)
        break
      }
      case 'br':
        nodes.push(<br key={key} />)
        break
      case 'escape':
        nodes.push(<span key={key}>{(token as Tokens.Escape).text}</span>)
        break
      case 'html':
        break
      default:
        if ('tokens' in token && Array.isArray(token.tokens)) {
          nodes.push(...renderInline(token.tokens as Token[], key))
        } else if ('text' in token && typeof token.text === 'string') {
          nodes.push(...renderTextWithMentions(token.text, key))
        }
        break
    }
  })
  return nodes
}

function renderBlocks(tokens: Token[] | undefined, keyPrefix: string): ReactNode[] {
  if (!tokens?.length) return []

  return tokens.map((token, index) => {
    const key = `${keyPrefix}-${index}`
    switch (token.type) {
      case 'space':
        return null
      case 'paragraph': {
        const p = token as Tokens.Paragraph
        return (
          <p key={key} className="chat-md-p">
            {renderInline(p.tokens, key)}
          </p>
        )
      }
      case 'heading': {
        const h = token as Tokens.Heading
        const level = Math.min(Math.max(h.depth, 1), 4)
        const Tag = `h${level}` as 'h1' | 'h2' | 'h3' | 'h4'
        return (
          <Tag key={key} className={`chat-md-h chat-md-h${level}`}>
            {renderInline(h.tokens, key)}
          </Tag>
        )
      }
      case 'list': {
        const list = token as Tokens.List
        const ListTag = list.ordered ? 'ol' : 'ul'
        return (
          <ListTag
            key={key}
            className="chat-md-list"
            start={list.ordered && list.start ? list.start : undefined}
          >
            {list.items.map((item, itemIndex) => (
              <li key={`${key}-${itemIndex}`} className="chat-md-li">
                {renderBlocks(item.tokens, `${key}-${itemIndex}`)}
              </li>
            ))}
          </ListTag>
        )
      }
      case 'blockquote': {
        const q = token as Tokens.Blockquote
        return (
          <blockquote key={key} className="chat-md-quote">
            {renderBlocks(q.tokens, key)}
          </blockquote>
        )
      }
      case 'code': {
        const code = token as Tokens.Code
        return (
          <pre key={key} className="chat-md-pre">
            <code>{code.text}</code>
          </pre>
        )
      }
      case 'table': {
        const table = token as Tokens.Table
        return (
          <div key={key} className="chat-md-table-wrap">
            <table className="chat-md-table">
              <thead>
                <tr>
                  {table.header.map((cell, cellIndex) => (
                    <th key={`${key}-h${cellIndex}`}>{renderInline(cell.tokens, `${key}-h${cellIndex}`)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {table.rows.map((row, rowIndex) => (
                  <tr key={`${key}-r${rowIndex}`}>
                    {row.map((cell, cellIndex) => (
                      <td key={`${key}-r${rowIndex}-c${cellIndex}`}>
                        {renderInline(cell.tokens, `${key}-r${rowIndex}-c${cellIndex}`)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      }
      case 'hr':
        return <hr key={key} className="chat-md-hr" />
      case 'text': {
        const textToken = token as Tokens.Text
        if (textToken.tokens?.length) {
          return (
            <p key={key} className="chat-md-p">
              {renderInline(textToken.tokens, key)}
            </p>
          )
        }
        return (
          <p key={key} className="chat-md-p">
            {renderTextWithMentions(textToken.text, key)}
          </p>
        )
      }
      case 'html':
        return null
      default:
        if ('tokens' in token && Array.isArray(token.tokens)) {
          return (
            <div key={key}>{renderBlocks(token.tokens as Token[], key)}</div>
          )
        }
        return null
    }
  })
}

interface ChatMarkdownProps {
  content: string
  showCursor?: boolean
}

export function ChatMarkdown({ content, showCursor }: ChatMarkdownProps) {
  const tokens = Lexer.lex(content, CHAT_MARKDOWN_OPTIONS)
  return (
    <div className="chat-markdown">
      {renderBlocks(tokens, 'b')}
      {showCursor ? <span className="chat-streaming-cursor" aria-hidden="true" /> : null}
    </div>
  )
}
