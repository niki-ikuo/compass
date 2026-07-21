import type { OpenFile } from '@/types'
import { getFileName } from '@/utils/language'

export type UnsavedChoice = 'save' | 'discard' | 'cancel'

/** 終了時に保存対象になる dirty ファイル（プレビュー・非テキストタブは除外） */
export function listDirtySavableFiles(openFiles: OpenFile[]): OpenFile[] {
  return openFiles.filter((file) => {
    if (!file.isDirty || file.isPreview) return false
    if (
      file.viewKind === 'image' ||
      file.viewKind === 'pdf' ||
      file.viewKind === 'browser' ||
      file.viewKind === 'settings'
    ) {
      return false
    }
    return true
  })
}

export async function saveDirtyFiles(
  files: OpenFile[],
  markSaved: (path: string) => void
): Promise<void> {
  for (const file of files) {
    await window.compass.fs.writeFile(file.path, file.content, file.encoding)
    markSaved(file.path)
  }
}

/**
 * タブ閉じ前の未保存確認。
 * dirty が無ければ即 close。save 選択時は保存してから close。cancel なら abort。
 */
export async function prepareCloseFiles(
  filesToClose: OpenFile[],
  deps: {
    confirmUnsavedClose: (count: number, fileName?: string) => Promise<UnsavedChoice>
    saveDirtyFiles: (files: OpenFile[]) => Promise<void>
  }
): Promise<'close' | 'abort'> {
  const dirty = listDirtySavableFiles(filesToClose)
  if (dirty.length === 0) return 'close'

  const fileName = dirty.length === 1 ? getFileName(dirty[0].path) : undefined
  const choice = await deps.confirmUnsavedClose(dirty.length, fileName)
  if (choice === 'cancel') return 'abort'
  if (choice === 'save') {
    await deps.saveDirtyFiles(dirty)
  }
  return 'close'
}
