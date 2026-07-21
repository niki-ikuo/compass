import { describe, expect, it, vi } from 'vitest'
import { listDirtySavableFiles, prepareCloseFiles } from './unsaved-files'
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

describe('prepareCloseFiles', () => {
  it('closes immediately when nothing is dirty-savable', async () => {
    const confirmUnsavedClose = vi.fn()
    const save = vi.fn()
    const result = await prepareCloseFiles(
      [file({ path: 'clean.txt' }), file({ path: 'preview.txt', isDirty: true, isPreview: true })],
      { confirmUnsavedClose, saveDirtyFiles: save }
    )
    expect(result).toBe('close')
    expect(confirmUnsavedClose).not.toHaveBeenCalled()
    expect(save).not.toHaveBeenCalled()
  })

  it('aborts when user cancels', async () => {
    const save = vi.fn()
    const result = await prepareCloseFiles([file({ path: 'a.txt', isDirty: true, content: 'x' })], {
      confirmUnsavedClose: async () => 'cancel',
      saveDirtyFiles: save
    })
    expect(result).toBe('abort')
    expect(save).not.toHaveBeenCalled()
  })

  it('saves then closes when user chooses save', async () => {
    const dirty = file({ path: 'dir/a.txt', isDirty: true, content: 'x' })
    const save = vi.fn(async () => undefined)
    const confirmUnsavedClose = vi.fn(async () => 'save' as const)
    const result = await prepareCloseFiles([dirty], {
      confirmUnsavedClose,
      saveDirtyFiles: save
    })
    expect(result).toBe('close')
    expect(confirmUnsavedClose).toHaveBeenCalledWith(1, 'a.txt')
    expect(save).toHaveBeenCalledWith([dirty])
  })

  it('closes without saving when user discards', async () => {
    const save = vi.fn()
    const result = await prepareCloseFiles([file({ path: 'a.txt', isDirty: true })], {
      confirmUnsavedClose: async () => 'discard',
      saveDirtyFiles: save
    })
    expect(result).toBe('close')
    expect(save).not.toHaveBeenCalled()
  })

  it('asks with count only when multiple dirty files', async () => {
    const confirmUnsavedClose = vi.fn(async () => 'discard' as const)
    await prepareCloseFiles(
      [file({ path: 'a.txt', isDirty: true }), file({ path: 'b.txt', isDirty: true })],
      { confirmUnsavedClose, saveDirtyFiles: async () => undefined }
    )
    expect(confirmUnsavedClose).toHaveBeenCalledWith(2, undefined)
  })
})
