import { describe, expect, it } from 'vitest'
import { buildUniqueFileName, getNameStemSelectionEnd } from '@/utils/unique-file-name'

describe('buildUniqueFileName', () => {
  it('returns preferred name when unused', () => {
    expect(buildUniqueFileName('report.txt', [])).toBe('report.txt')
    expect(buildUniqueFileName('meeting-notes.md', [])).toBe('meeting-notes.md')
  })

  it('appends Windows-style numeric suffix on collision', () => {
    expect(buildUniqueFileName('report.txt', ['report.txt'])).toBe('report (2).txt')
    expect(
      buildUniqueFileName('meeting-notes.md', ['meeting-notes.md', 'Meeting-Notes (2).md'])
    ).toBe('meeting-notes (3).md')
    expect(buildUniqueFileName('新しいフォルダー', ['新しいフォルダー'])).toBe(
      '新しいフォルダー (2)'
    )
    expect(
      buildUniqueFileName('新規 テキスト ドキュメント.txt', [
        '新規 テキスト ドキュメント.txt'
      ])
    ).toBe('新規 テキスト ドキュメント (2).txt')
  })

  it('handles names without extension', () => {
    expect(buildUniqueFileName('README', ['README'])).toBe('README (2)')
  })
})

describe('getNameStemSelectionEnd', () => {
  it('selects stem before the last extension dot for files', () => {
    expect(getNameStemSelectionEnd('report.txt')).toBe(6)
    expect(getNameStemSelectionEnd('archive.tar.gz')).toBe(11)
    expect(getNameStemSelectionEnd('新規 テキスト ドキュメント.txt')).toBe(
      '新規 テキスト ドキュメント'.length
    )
  })

  it('selects the full name for folders, dotfiles, and names without a stem', () => {
    expect(getNameStemSelectionEnd('docs', true)).toBe(4)
    expect(getNameStemSelectionEnd('my.folder', true)).toBe(9)
    expect(getNameStemSelectionEnd('README')).toBe(6)
    expect(getNameStemSelectionEnd('.gitignore')).toBe(10)
    expect(getNameStemSelectionEnd('')).toBe(0)
  })
})
