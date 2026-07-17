import { describe, expect, it } from 'vitest'
import { buildUniqueFileName } from '@/utils/unique-file-name'

describe('buildUniqueFileName', () => {
  it('returns preferred name when unused', () => {
    expect(buildUniqueFileName('report.txt', [])).toBe('report.txt')
    expect(buildUniqueFileName('meeting-notes.md', [])).toBe('meeting-notes.md')
  })

  it('appends numeric suffix on collision', () => {
    expect(buildUniqueFileName('report.txt', ['report.txt'])).toBe('report-2.txt')
    expect(
      buildUniqueFileName('meeting-notes.md', ['meeting-notes.md', 'Meeting-Notes-2.md'])
    ).toBe('meeting-notes-3.md')
  })

  it('handles names without extension', () => {
    expect(buildUniqueFileName('README', ['README'])).toBe('README-2')
  })
})
