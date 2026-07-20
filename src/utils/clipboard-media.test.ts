import { describe, expect, it } from 'vitest'
import {
  buildPastedMediaFileName,
  classifyMediaFile,
  collectClipboardMedia
} from '@/utils/clipboard-media'

function mockDataTransfer(opts: {
  itemFiles?: File[]
  files?: File[]
}): DataTransfer {
  const itemFiles = opts.itemFiles ?? []
  const files = opts.files ?? []
  const items = itemFiles.map((file) => ({
    kind: 'file' as const,
    type: file.type,
    getAsFile: () => file
  }))
  return {
    items: {
      length: items.length,
      [Symbol.iterator]: function* (): Generator<(typeof items)[number]> {
        for (const item of items) yield item
      },
      ...Object.fromEntries(items.map((item, i) => [i, item]))
    },
    files: {
      ...Object.fromEntries(files.map((file, i) => [i, file])),
      length: files.length,
      item: (i: number) => files[i] ?? null
    }
  } as unknown as DataTransfer
}

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

describe('collectClipboardMedia', () => {
  it('dedupes Win+Shift+S style items+files mirrors with different lastModified', () => {
    const a = new File([new Uint8Array([1, 2, 3, 4])], 'image.png', {
      type: 'image/png',
      lastModified: 1000
    })
    const b = new File([new Uint8Array([1, 2, 3, 4])], 'image.png', {
      type: 'image/png',
      lastModified: 1008
    })
    const result = collectClipboardMedia(mockDataTransfer({ itemFiles: [a], files: [b] }))
    expect(result).toHaveLength(1)
  })

  it('still collects distinct OS files with different names', () => {
    const a = new File([new Uint8Array([1])], 'a.png', { type: 'image/png' })
    const b = new File([new Uint8Array([1, 2])], 'b.png', { type: 'image/png' })
    const result = collectClipboardMedia(mockDataTransfer({ itemFiles: [a, b] }))
    expect(result).toHaveLength(2)
  })
})
