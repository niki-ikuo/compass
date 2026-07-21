import type { OpenFile } from '@/types'

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
