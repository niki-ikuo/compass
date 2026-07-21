import { describe, expect, it } from 'vitest'
import {
  hasOsFileDrag,
  parseOsDroppedFileRefs,
  serializeChatContextRefs,
  parseChatContextRefs
} from '@/utils/chat-context-drag'

function mockDataTransfer(options: {
  types?: string[]
  mimeData?: Record<string, string>
  items?: Array<{
    kind: string
    isDirectory?: boolean
    entryName?: string
    file?: File & { path?: string }
  }>
  files?: Array<File & { path?: string }>
}): DataTransfer {
  const types = options.types ?? []
  const mimeData = options.mimeData ?? {}
  const items = options.items ?? []
  const files = options.files ?? []

  return {
    types,
    getData: (type: string) => mimeData[type] ?? '',
    items: {
      length: items.length,
      [Symbol.iterator]: function* () {
        for (let i = 0; i < items.length; i++) yield (this as DataTransferItemList)[i]
      },
      ...Object.fromEntries(
        items.map((item, index) => [
          index,
          {
            kind: item.kind,
            webkitGetAsEntry: () =>
              item.isDirectory === undefined && !item.entryName
                ? null
                : {
                    isDirectory: Boolean(item.isDirectory),
                    isFile: !item.isDirectory,
                    name: item.entryName ?? item.file?.name ?? 'entry'
                  },
            getAsFile: () => item.file ?? null
          }
        ])
      )
    } as unknown as DataTransferItemList,
    files: {
      length: files.length,
      ...Object.fromEntries(files.map((file, index) => [index, file])),
      item: (index: number) => files[index] ?? null,
      [Symbol.iterator]: function* () {
        for (const file of files) yield file
      }
    } as unknown as FileList
  } as unknown as DataTransfer
}

describe('hasOsFileDrag', () => {
  it('detects Files type', () => {
    expect(hasOsFileDrag(mockDataTransfer({ types: ['Files'] }))).toBe(true)
    expect(hasOsFileDrag(mockDataTransfer({ types: ['text/plain'] }))).toBe(false)
  })
})

describe('parseOsDroppedFileRefs', () => {
  it('accepts files via resolvePath (Electron 32+ webUtils) and rejects folders', () => {
    const file = { name: 'spec.md' } as File
    const result = parseOsDroppedFileRefs(
      mockDataTransfer({
        types: ['Files'],
        items: [
          { kind: 'file', file, isDirectory: false, entryName: 'spec.md' },
          { kind: 'file', isDirectory: true, entryName: 'docs' }
        ]
      }),
      () => 'C:/Users/me/Desktop/spec.md'
    )

    expect(result.files).toEqual([
      { path: 'C:/Users/me/Desktop/spec.md', name: 'spec.md', isDirectory: false }
    ])
    expect(result.rejectedFolderNames).toEqual(['docs'])
  })

  it('falls back to legacy File.path when resolvePath is omitted', () => {
    const file = { name: 'notes.txt', path: 'D:/tmp/notes.txt' } as File & { path?: string }
    const result = parseOsDroppedFileRefs(
      mockDataTransfer({
        types: ['Files'],
        files: [file]
      })
    )
    expect(result.files).toHaveLength(1)
    expect(result.files[0].path).toBe('D:/tmp/notes.txt')
    expect(result.rejectedFolderNames).toEqual([])
  })

  it('skips files without an absolute path', () => {
    const file = { name: 'blob.bin' } as File
    const result = parseOsDroppedFileRefs(
      mockDataTransfer({
        types: ['Files'],
        items: [{ kind: 'file', file, isDirectory: false, entryName: 'blob.bin' }]
      }),
      () => null
    )
    expect(result.files).toEqual([])
  })
})

describe('parseChatContextRefs still preferred for in-app drags', () => {
  it('parses custom mime payload', () => {
    const refs = [
      { path: 'C:/ws/a.md', name: 'a.md', isDirectory: false as const }
    ]
    const dt = mockDataTransfer({
      types: ['application/x-compass-context-ref', 'Files'],
      mimeData: {
        'application/x-compass-context-ref': serializeChatContextRefs(refs)
      }
    })
    expect(parseChatContextRefs(dt)).toEqual(refs)
  })
})
