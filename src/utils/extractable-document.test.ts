import { describe, expect, it } from 'vitest'
import {
  getExtractableDocumentKind,
  isDocxPath,
  isExtractableDocumentPath,
  sidecarSummaryMarkdownPath
} from './extractable-document'

describe('extractable-document', () => {
  it('detects pdf and docx only', () => {
    expect(isExtractableDocumentPath('a/report.PDF')).toBe(true)
    expect(isDocxPath('notes.DOCX')).toBe(true)
    expect(isExtractableDocumentPath('notes.docx')).toBe(true)
    expect(isExtractableDocumentPath('legacy.doc')).toBe(false)
    expect(isExtractableDocumentPath('sheet.xlsx')).toBe(false)
    expect(isExtractableDocumentPath('photo.png')).toBe(false)
    expect(getExtractableDocumentKind('x.pdf')).toBe('pdf')
    expect(getExtractableDocumentKind('x.docx')).toBe('docx')
    expect(getExtractableDocumentKind('x.txt')).toBeNull()
  })

  it('builds sidecar summary paths', () => {
    expect(sidecarSummaryMarkdownPath('docs/report.pdf')).toBe('docs/report.summary.md')
    expect(sidecarSummaryMarkdownPath('notes.docx')).toBe('notes.summary.md')
    expect(sidecarSummaryMarkdownPath('a/b/c.final.PDF')).toBe('a/b/c.final.summary.md')
  })
})
