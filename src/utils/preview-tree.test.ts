import { describe, expect, it } from 'vitest'
import type { ActionPreviewItem, FileTreeNode } from '@/types'
import { mergePreviewIntoTree } from '@/utils/preview-tree'

const ROOT = 'C:/workspace'

function cloneTree(tree: FileTreeNode[]): FileTreeNode[] {
  return structuredClone(tree)
}

describe('mergePreviewIntoTree', () => {
  it('does not mutate the original file tree when inserting a new preview file', () => {
    const original: FileTreeNode[] = [
      {
        name: 'src',
        path: `${ROOT}/src`,
        isDirectory: true,
        children: [
          {
            name: 'app.ts',
            path: `${ROOT}/src/app.ts`,
            isDirectory: false
          }
        ]
      }
    ]
    const before = cloneTree(original)
    const items: ActionPreviewItem[] = [
      {
        type: 'writeFile',
        path: `${ROOT}/src/new-file.ts`,
        relativePath: 'src/new-file.ts',
        oldContent: '',
        newContent: 'export {}',
        isNew: true
      }
    ]

    const merged = mergePreviewIntoTree(original, items, ROOT)

    expect(original).toEqual(before)
    expect(merged.find((n) => n.name === 'src')?.children?.map((c) => c.name)).toEqual([
      'app.ts',
      'new-file.ts'
    ])
    expect(original.find((n) => n.name === 'src')?.children?.map((c) => c.name)).toEqual([
      'app.ts'
    ])
  })

  it('marks existing files as modified without mutating the original tree', () => {
    const original: FileTreeNode[] = [
      {
        name: 'readme.md',
        path: `${ROOT}/readme.md`,
        isDirectory: false
      }
    ]
    const before = cloneTree(original)
    const items: ActionPreviewItem[] = [
      {
        type: 'writeFile',
        path: `${ROOT}/readme.md`,
        relativePath: 'readme.md',
        oldContent: 'a',
        newContent: 'b',
        isNew: false
      }
    ]

    const merged = mergePreviewIntoTree(original, items, ROOT)

    expect(original).toEqual(before)
    expect(merged[0]).toMatchObject({
      name: 'readme.md',
      isPreview: true,
      previewKind: 'modified'
    })
    expect(original[0].isPreview).toBeUndefined()
  })

  it('inserts nested new folders/files immutably', () => {
    const original: FileTreeNode[] = [
      {
        name: 'src',
        path: `${ROOT}/src`,
        isDirectory: true,
        children: []
      }
    ]
    const before = cloneTree(original)
    const items: ActionPreviewItem[] = [
      {
        type: 'mkdir',
        path: `${ROOT}/src/features`,
        relativePath: 'src/features',
        alreadyExists: false
      },
      {
        type: 'writeFile',
        path: `${ROOT}/src/features/index.ts`,
        relativePath: 'src/features/index.ts',
        oldContent: '',
        newContent: 'export {}',
        isNew: true
      }
    ]

    const merged = mergePreviewIntoTree(original, items, ROOT)

    expect(original).toEqual(before)
    const features = merged
      .find((n) => n.name === 'src')
      ?.children?.find((n) => n.name === 'features')
    expect(features?.isPreview).toBe(true)
    expect(features?.previewKind).toBe('new-folder')
    expect(features?.children?.[0]).toMatchObject({
      name: 'index.ts',
      isPreview: true,
      previewKind: 'new-file'
    })
  })
})
