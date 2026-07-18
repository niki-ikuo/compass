import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ChatMarkdown } from '@/components/ChatMarkdown'
import { isSafeChatHref, splitStructuredPathMentions } from '@/utils/chat-markdown'

describe('isSafeChatHref', () => {
  it('allows http(s) and mailto', () => {
    expect(isSafeChatHref('https://example.com/a')).toBe(true)
    expect(isSafeChatHref('http://example.com')).toBe(true)
    expect(isSafeChatHref('mailto:a@b.com')).toBe(true)
  })

  it('rejects unsafe or relative hrefs', () => {
    expect(isSafeChatHref('javascript:alert(1)')).toBe(false)
    expect(isSafeChatHref('//evil.test')).toBe(false)
    expect(isSafeChatHref('/local/path')).toBe(false)
    expect(isSafeChatHref('readme.md')).toBe(false)
    expect(isSafeChatHref('')).toBe(false)
  })
})

describe('splitStructuredPathMentions', () => {
  it('keeps plain text', () => {
    expect(splitStructuredPathMentions('hello')).toEqual([{ type: 'text', content: 'hello' }])
  })

  it('splits @[path] mentions', () => {
    expect(splitStructuredPathMentions('see @[src/a.ts] please')).toEqual([
      { type: 'text', content: 'see ' },
      { type: 'path', content: 'src/a.ts' },
      { type: 'text', content: ' please' }
    ])
  })
})

describe('ChatMarkdown', () => {
  it('renders bold, lists, and links', () => {
    const html = renderToStaticMarkup(
      ChatMarkdown({
        content: '**Bold**\n\n- one\n- two\n\n[Docs](https://example.com)'
      })
    )
    expect(html).toContain('<strong>')
    expect(html).toContain('Bold')
    expect(html).toContain('<ul')
    expect(html).toContain('<li')
    expect(html).toContain('href="https://example.com"')
    expect(html).toContain('target="_blank"')
  })

  it('renders path capsules for mentions and path codespans', () => {
    const html = renderToStaticMarkup(
      ChatMarkdown({
        content: 'Open @[docs/SPEC.md] and `src/app.ts`'
      })
    )
    expect(html).toContain('chat-path-capsule')
    expect(html).toContain('docs/SPEC.md')
    expect(html).toContain('src/app.ts')
  })

  it('does not render raw html tokens', () => {
    const html = renderToStaticMarkup(
      ChatMarkdown({
        content: 'Hello <script>alert(1)</script> world'
      })
    )
    expect(html).not.toContain('<script>')
  })
})
