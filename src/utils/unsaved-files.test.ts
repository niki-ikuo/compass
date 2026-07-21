import { describe, expect, it } from 'vitest'
import { listDirtySavableFiles } from './unsaved-files'
import type { OpenFile } from '@/types'

function file(partial: Partial<OpenFile> & Pick<OpenFile, 'path'>): OpenFile {
  return {
    content: '',
    language: 'plaintext',
    encoding: 'utf8',
    isDirty: false,
    ...partial
  }
}

describe('listDirtySavableFiles', () => {
  it('includes dirty text files and skips preview / non-text tabs', () => {
    const files = [
      file({ path: 'a.txt', isDirty: true }),
      file({ path: 'b.txt', isDirty: false }),
      file({ path: 'c.txt', isDirty: true, isPreview: true }),
      file({ path: 'd.png', isDirty: true, viewKind: 'image' }),
      file({ path: 'settings', isDirty: true, viewKind: 'settings' })
    ]
    expect(listDirtySavableFiles(files).map((f) => f.path)).toEqual(['a.txt'])
  })
})
