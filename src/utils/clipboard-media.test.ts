import { describe, expect, it } from 'vitest'
import {
  buildPastedMediaFileName,
  classifyMediaFile
} from '@/utils/clipboard-media'

describe('classifyMediaFile', () => {
  it('classifies images by mime and extension', () => {
    expect(classifyMediaFile({ name: '', type: 'image/png' })).toEqual({
      kind: 'image',
      mimeType: 'image/png',
      extension: 'png'
    })
    expect(classifyMediaFile({ name: 'shot.WEBP', type: '' })?.kind).toBe('image')
    expect(classifyMediaFile({ name: 'notes.md', type: 'text/plain' })).toBeNull()
  })

  it('classifies pdf by mime or extension', () => {
    expect(classifyMediaFile({ name: 'a.pdf', type: '' })).toEqual({
      kind: 'pdf',
      mimeType: 'application/pdf',
      extension: 'pdf'
    })
    expect(classifyMediaFile({ name: 'doc', type: 'application/pdf' })?.kind).toBe('pdf')
  })
})

describe('buildPastedMediaFileName', () => {
  it('uses screenshot- timestamp for anonymous clipboard images', () => {
    const name = buildPastedMediaFileName(
      { kind: 'image', extension: 'png' },
      'image.png',
      new Date(2026, 6, 17, 14, 0, 12)
    )
    expect(name).toBe('screenshot-20260717-140012000.png')
  })

  it('keeps a real OS file name', () => {
    expect(
      buildPastedMediaFileName({ kind: 'pdf', extension: 'pdf' }, '仕様書.pdf')
    ).toBe('仕様書.pdf')
  })
})
