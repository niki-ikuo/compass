import { createElement, type ReactNode } from 'react'
import { Lexer, type Token, type Tokens } from 'marked'
import { isSafeChatHref, isSafeHelpDocHref } from '@/utils/chat-markdown'

const MARKDOWN_OPTIONS = { gfm: true, breaks: true } as const

type RenderOptions = {
  allowRelativeDocLinks: boolean
}

function renderInline(
  tokens: Token[] | undefined,
  keyPrefix: string,
  options: RenderOptions
): ReactNode[] {
  if (!tokens?.length) return []

  const nodes: ReactNode[] = []
  tokens.forEach((token, index) => {
    const key = `${keyPrefix}-${index}`
    switch (token.type) {
      case 'text': {
        const textToken = token as Tokens.Text
        if (textToken.tokens?.length) {
          nodes.push(...renderInline(textToken.tokens, key, options))
        } else {
          nodes.push(<span key={key}>{textToken.text}</span>)
        }
        break
      }
      case 'strong':
        nodes.push(
          <strong key={key}>
            {renderInline((token as Tokens.Strong).tokens, key, options)}
          </strong>
        )
        break
      case 'em':
        nodes.push(
          <em key={key}>{renderInline((token as Tokens.Em).tokens, key, options)}</em>
        )
        break
      case 'del':
        nodes.push(
          <del key={key}>{renderInline((token as Tokens.Del).tokens, key, options)}</del>
        )
        break
      case 'codespan':
        nodes.push(<code key={key}>{(token as Tokens.Codespan).text}</code>)
        break
      case 'link': {
        const link = token as Tokens.Link
        if (isSafeChatHref(link.href)) {
          nodes.push(
            <a key={key} href={link.href} target="_blank" rel="noreferrer noopener">
              {renderInline(link.tokens, key, options)}
            </a>
          )
        } else if (options.allowRelativeDocLinks && isSafeHelpDocHref(link.href)) {
          nodes.push(
            <a key={key} href={link.href}>
              {renderInline(link.tokens, key, options)}
            </a>
          )
        } else {
          nodes.push(...renderInline(link.tokens, key, options))
        }
        break
      }
      case 'checkbox': {
        const checked = Boolean((token as { checked?: boolean }).checked)
        nodes.push(
          <input key={key} type="checkbox" disabled checked={checked} readOnly />
        )
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
          nodes.push(...renderInline(token.tokens as Token[], key, options))
        } else if ('text' in token && typeof token.text === 'string') {
          nodes.push(<span key={key}>{token.text}</span>)
        }
        break
    }
  })
  return nodes
}

function renderBlocks(
  tokens: Token[] | undefined,
  keyPrefix: string,
  options: RenderOptions
): ReactNode[] {
  if (!tokens?.length) return []

  return tokens.map((token, index) => {
    const key = `${keyPrefix}-${index}`
    switch (token.type) {
      case 'heading': {
        const heading = token as Tokens.Heading
        const level = Math.min(Math.max(heading.depth, 1), 6)
        return createElement(
          `h${level}`,
          { key },
          renderInline(heading.tokens, key, options)
        )
      }
      case 'paragraph':
        return (
          <p key={key}>{renderInline((token as Tokens.Paragraph).tokens, key, options)}</p>
        )
      case 'blockquote':
        return (
          <blockquote key={key}>
            {renderBlocks((token as Tokens.Blockquote).tokens, key, options)}
          </blockquote>
        )
      case 'list': {
        const list = token as Tokens.List
        const ListTag = list.ordered ? 'ol' : 'ul'
        return (
          <ListTag key={key} start={list.ordered && list.start ? list.start : undefined}>
            {list.items.map((item, itemIndex) => (
              <li key={`${key}-i${itemIndex}`}>
                {renderBlocks(item.tokens, `${key}-i${itemIndex}`, options)}
              </li>
            ))}
          </ListTag>
        )
      }
      case 'code': {
        const code = token as Tokens.Code
        return (
          <pre key={key}>
            <code className={code.lang ? `language-${code.lang}` : undefined}>{code.text}</code>
          </pre>
        )
      }
      case 'table': {
        const table = token as Tokens.Table
        return (
          <table key={key}>
            <thead>
              <tr>
                {table.header.map((cell, cellIndex) => (
                  <th key={`${key}-h${cellIndex}`}>
                    {renderInline(cell.tokens, `${key}-h${cellIndex}`, options)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.rows.map((row, rowIndex) => (
                <tr key={`${key}-r${rowIndex}`}>
                  {row.map((cell, cellIndex) => (
                    <td key={`${key}-r${rowIndex}-c${cellIndex}`}>
                      {renderInline(cell.tokens, `${key}-r${rowIndex}-c${cellIndex}`, options)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )
      }
      case 'hr':
        return <hr key={key} />
      case 'text': {
        const textToken = token as Tokens.Text
        if (textToken.tokens?.length) {
          return <p key={key}>{renderInline(textToken.tokens, key, options)}</p>
        }
        return <p key={key}>{textToken.text}</p>
      }
      case 'html':
        return null
      default:
        if ('tokens' in token && Array.isArray(token.tokens)) {
          return <div key={key}>{renderBlocks(token.tokens as Token[], key, options)}</div>
        }
        return null
    }
  })
}

interface SafeMarkdownProps {
  content: string
  className?: string
  /** Allow relative `*.md` links (Help docs). Default false. */
  allowRelativeDocLinks?: boolean
}

/** Sanitized Markdown via React tokens — raw HTML tokens are dropped (H4). */
export function SafeMarkdown({
  content,
  className = 'markdown-body',
  allowRelativeDocLinks = false
}: SafeMarkdownProps) {
  const options: RenderOptions = { allowRelativeDocLinks }
  const tokens = Lexer.lex(content, MARKDOWN_OPTIONS)
  return <div className={className}>{renderBlocks(tokens, 'b', options)}</div>
}
