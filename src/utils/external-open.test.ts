import { describe, expect, it } from 'vitest'
import { isExternalOpenPath } from './external-open'

describe('isExternalOpenPath', () => {
  it('detects Office and OpenDocument files', () => {
    expect(isExternalOpenPath('a/report.DOCX')).toBe(true)
    expect(isExternalOpenPath('sheet.xlsx')).toBe(true)
    expect(isExternalOpenPath('deck.PPTX')).toBe(true)
    expect(isExternalOpenPath('notes.odt')).toBe(true)
  })

  it('leaves text and in-app media to the editor', () => {
    expect(isExternalOpenPath('notes.md')).toBe(false)
    expect(isExternalOpenPath('data.csv')).toBe(false)
    expect(isExternalOpenPath('photo.png')).toBe(false)
    expect(isExternalOpenPath('spec.pdf')).toBe(false)
  })
})
