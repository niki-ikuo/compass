import { describe, expect, it } from 'vitest'
import {
  formatContextMention,
  hasStructuredMention,
  isStructuredMention,
  detectMentionKind
} from '@/utils/chat-mentions'

describe('isStructuredMention', () => {
  it('accepts ASCII and Unicode root-level folders', () => {
    expect(isStructuredMention('docs/')).toBe(true)
    expect(isStructuredMention('資料フォルダ/')).toBe(true)
    expect(isStructuredMention('ドキュメント/')).toBe(true)
  })

  it('accepts ASCII and Unicode root-level files with extensions', () => {
    expect(isStructuredMention('readme.md')).toBe(true)
    expect(isStructuredMention('資料.md')).toBe(true)
    expect(isStructuredMention('ドキュメント.ts')).toBe(true)
  })

  it('accepts nested Unicode paths', () => {
    expect(isStructuredMention('src/資料.md')).toBe(true)
    expect(isStructuredMention('src/資料フォルダ/')).toBe(true)
  })

  it('accepts selection mentions with Unicode paths', () => {
    expect(isStructuredMention('資料.md:12')).toBe(true)
    expect(isStructuredMention('src/資料.ts:1-3')).toBe(true)
  })

  it('accepts selection mentions with spaces in the path', () => {
    expect(
      isStructuredMention('西日本放送給与大臣ERP/西日本放送給与大臣ERP Class Library/a.ts:10-20')
    ).toBe(true)
  })

  it('rejects prose-like tokens without path shape', () => {
    expect(isStructuredMention('todo')).toBe(false)
    expect(isStructuredMention('hello world')).toBe(false)
    expect(isStructuredMention('')).toBe(false)
  })

  it('accepts paths with spaces (Windows folder names)', () => {
    expect(isStructuredMention('西日本放送給与大臣ERP Class Library/')).toBe(true)
    expect(
      isStructuredMention('西日本放送給与大臣ERP/西日本放送給与大臣ERP Class Library')
    ).toBe(true)
    expect(
      isStructuredMention('西日本放送給与大臣ERP/西日本放送給与大臣ERP Class Library/')
    ).toBe(true)
    expect(isStructuredMention('My Documents/report.md')).toBe(true)
    expect(isStructuredMention('read me.md')).toBe(true)
  })
})

describe('hasStructuredMention', () => {
  it('detects path-like tokens embedded in prose', () => {
    expect(hasStructuredMention('see @[src/foo.ts] please')).toBe(true)
    expect(hasStructuredMention('folder @[docs/]')).toBe(true)
  })

  it('ignores non-path @[...] tokens', () => {
    expect(hasStructuredMention('note @[todo] and @[hello world]')).toBe(false)
    expect(hasStructuredMention('no mentions here')).toBe(false)
  })
})

describe('formatContextMention + isStructuredMention', () => {
  const root = 'C:/Users/niki/Desktop/compass'

  it('produces insertable capsules for root-level Unicode folders and files', () => {
    const folder = formatContextMention(`${root}/資料フォルダ`, true, root)
    const file = formatContextMention(`${root}/資料.md`, false, root)

    expect(folder).toBe('@[資料フォルダ/]')
    expect(file).toBe('@[資料.md]')
    expect(isStructuredMention(folder.slice(2, -1))).toBe(true)
    expect(isStructuredMention(file.slice(2, -1))).toBe(true)
    expect(detectMentionKind(folder.slice(2, -1))).toBe('folder')
    expect(detectMentionKind(file.slice(2, -1))).toBe('file')
  })

  it('produces insertable capsules for nested folders with spaces', () => {
    const folder = formatContextMention(
      `${root}/西日本放送給与大臣ERP/西日本放送給与大臣ERP Class Library`,
      true,
      root
    )
    expect(folder).toBe('@[西日本放送給与大臣ERP/西日本放送給与大臣ERP Class Library/]')
    expect(isStructuredMention(folder.slice(2, -1))).toBe(true)
    expect(detectMentionKind(folder.slice(2, -1))).toBe('folder')
  })

  it('mentions external files with absolute paths', () => {
    const external = formatContextMention('C:/Users/niki/Desktop/spec.md', false, root)
    expect(external).toBe('@[C:/Users/niki/Desktop/spec.md]')
    expect(isStructuredMention(external.slice(2, -1))).toBe(true)
    expect(detectMentionKind(external.slice(2, -1))).toBe('file')
  })

  it('handles Windows drive-letter case for Unicode workspace paths', () => {
    if (process.platform !== 'win32') return
    const jpRoot = 'C:/Users/niki/Desktop/研究'
    const mention = formatContextMention('c:/Users/niki/Desktop/研究/資料.md', false, jpRoot)
    expect(mention).toBe('@[資料.md]')
    expect(isStructuredMention(mention.slice(2, -1))).toBe(true)
  })
})