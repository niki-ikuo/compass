import { describe, expect, it } from 'vitest'
import {
  createBrowserTabPath,
  isBrowserTabPath,
  normalizeBrowserUrl
} from '@/utils/browser-tab'

describe('browser-tab', () => {
  it('creates and detects browser tab paths', () => {
    const path = createBrowserTabPath('abc')
    expect(path).toBe('compass-browser://abc')
    expect(isBrowserTabPath(path)).toBe(true)
    expect(isBrowserTabPath('notes.md')).toBe(false)
  })

  it('normalizes address bar input', () => {
    expect(normalizeBrowserUrl('https://example.com')).toBe('https://example.com')
    expect(normalizeBrowserUrl('example.com/docs')).toBe('https://example.com/docs')
    expect(normalizeBrowserUrl('localhost:3000')).toBe('https://localhost:3000')
    expect(normalizeBrowserUrl('hello world')).toBe(
      'https://www.google.com/search?q=hello%20world'
    )
    expect(normalizeBrowserUrl('')).toBe('about:blank')
  })
})
