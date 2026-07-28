import type { OpenFile } from '@/types'
import { getFileName } from '@/utils/language'
import { isCompareOpenFile } from '@/utils/compare-tab'

export type UnsavedChoice = 'save' | 'discard' | 'cancel'

/** 比較タブの dirty な左右を、実ファイル相当の OpenFile に展開する */
export function expandDirtySavableSides(file: OpenFile): OpenFile[] {
  if (!isCompareOpenFile(file)) {
    return [file]
  }

  const sides: OpenFile[] = []
  if (file.compareLeftDirty && file.compareLeftPath) {
    sides.push({
      path: file.compareLeftPath,
      content: file.compareLeftContent ?? '',
      language: 'plaintext',
      encoding: file.compareLeftEncoding ?? 'utf8',
      isDirty: true,
      viewKind: 'text'
    })
  }
  if (file.compareRightDirty && file.compareRightPath) {
    sides.push({
      path: file.compareRightPath,
      content: file.compareRightContent ?? file.content,
      language: 'plaintext',
      encoding: file.compareRightEncoding ?? file.encoding,
      isDirty: true,
      viewKind: 'text'
    })
  }
  return sides
}

/** 終了時に保存対象になる dirty ファイル（プレビュー・非テキストタブは除外） */
export function listDirtySavableFiles(openFiles: OpenFile[]): OpenFile[] {
  const result: OpenFile[] = []
  const seen = new Set<string>()

  for (const file of openFiles) {
    if (file.isPreview) continue

    if (isCompareOpenFile(file)) {
      for (const side of expandDirtySavableSides(file)) {
        const key = side.path.replace(/\\/g, '/').toLowerCase()
        if (seen.has(key)) continue
        seen.add(key)
        result.push(side)
      }
      continue
    }

    if (!file.isDirty) continue
    if (
      file.viewKind === 'image' ||
      file.viewKind === 'pdf' ||
      file.viewKind === 'binary' ||
      file.viewKind === 'browser' ||
      file.viewKind === 'settings'
    ) {
      continue
    }

    const key = file.path.replace(/\\/g, '/').toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    result.push(file)
  }

  return result
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
