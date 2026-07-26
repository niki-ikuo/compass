import { describe, expect, it } from 'vitest'
import { isExcludedFromTextIndex, isTextIndexCandidatePath } from '@/utils/indexable-text'

describe('isExcludedFromTextIndex / isTextIndexCandidatePath', () => {
  it('keeps common text sources including previously allowlisted gaps', () => {
    for (const path of [
      'notes.md',
      'readme.MD',
      'docs/guide.mdx',
      'memo.txt',
      'Form1.vb',
      'Module1.bas',
      'script.vbs',
      'main.ts',
      'app.py',
      'data.csv',
      'vector.svg',
      'Makefile',
      'LICENSE',
      'Dockerfile'
    ]) {
      expect(isExcludedFromTextIndex(path)).toBe(false)
      expect(isTextIndexCandidatePath(path)).toBe(true)
    }
  })

  it('includes extractable PDF / docx for the text index', () => {
    expect(isExcludedFromTextIndex('scan.pdf')).toBe(false)
    expect(isTextIndexCandidatePath('docs/spec.PDF')).toBe(true)
    expect(isExcludedFromTextIndex('doc.docx')).toBe(false)
    expect(isTextIndexCandidatePath('notes.DOCX')).toBe(true)
  })

  it('excludes binary, images, and non-extractable Office paths', () => {
    for (const path of [
      'app.exe',
      'lib.dll',
      'archive.zip',
      'font.woff2',
      'photo.png',
      'sheet.xlsx',
      'legacy.doc',
      'deck.pptx'
    ]) {
      expect(isExcludedFromTextIndex(path)).toBe(true)
      expect(isTextIndexCandidatePath(path)).toBe(false)
    }
  })
})
