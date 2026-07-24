import { describe, expect, it } from 'vitest'
import {
  createBrowserTabPath,
  isBrowserTabPath,
  isHtmlFilePath,
  normalizeBrowserUrl,
  pathToFileUrl
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
    expect(normalizeBrowserUrl('file:///C:/report.html')).toBe('file:///C:/report.html')
  })

  it('detects html paths', () => {
    expect(isHtmlFilePath('C:/ws/chart.html')).toBe(true)
    expect(isHtmlFilePath('report.HTM')).toBe(true)
    expect(isHtmlFilePath('notes.md')).toBe(false)
    expect(isHtmlFilePath('chart.html.bak')).toBe(false)
  })

  it('converts local paths to file URLs', () => {
    expect(pathToFileUrl('C:\\Users\\niki\\report.html')).toBe(
      'file:///C:/Users/niki/report.html'
    )
    expect(pathToFileUrl('C:/data/my chart.html')).toBe(
      'file:///C:/data/my%20chart.html'
    )
    expect(pathToFileUrl('/tmp/report.html')).toBe('file:///tmp/report.html')
    expect(pathToFileUrl('\\\\server\\share\\a.html')).toBe('file://server/share/a.html')
    expect(pathToFileUrl('file:///C:/already.html')).toBe('file:///C:/already.html')
    expect(pathToFileUrl('')).toBe('about:blank')
  })
})
