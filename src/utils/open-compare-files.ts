import { useAppStore } from '@/stores/app-store'
import { t } from '@/i18n'
import { isBinaryExtensionPath } from '@/utils/binary-file'
import { isExternalOpenPath } from '@/utils/external-open'
import { isMediaPath } from '@/utils/media-context'
import { pathsEqualIgnoreCase } from '@/utils/compare-tab'
import type { FileEncoding } from '@/types'

/** 比較可能なテキストファイルか（拡張子の事前判定） */
export function isComparablePath(path: string): boolean {
  const trimmed = path.trim()
  if (!trimmed) return false
  if (isMediaPath(trimmed) || isExternalOpenPath(trimmed) || isBinaryExtensionPath(trimmed)) {
    return false
  }
  return true
}

async function loadCompareSide(path: string): Promise<{
  path: string
  content: string
  encoding: FileEncoding
  isDirty: boolean
} | null> {
  const store = useAppStore.getState()
  const existing = store.openFiles.find(
    (f) =>
      !f.isPreview &&
      f.viewKind !== 'compare' &&
      f.viewKind !== 'image' &&
      f.viewKind !== 'pdf' &&
      f.viewKind !== 'binary' &&
      f.viewKind !== 'browser' &&
      f.viewKind !== 'settings' &&
      pathsEqualIgnoreCase(f.path, path)
  )
  if (existing) {
    return {
      path: existing.path,
      content: existing.content,
      encoding: existing.encoding,
      isDirty: existing.isDirty
    }
  }

  try {
    const opened = await window.compass.fs.openEditorFile(path)
    if (opened.kind === 'binary') return null
    return {
      path,
      content: opened.content,
      encoding: opened.encoding,
      isDirty: false
    }
  } catch {
    return null
  }
}

/** 2つのテキストファイルを左右とも編集可能な比較タブで開く */
export async function openCompareFiles(leftPath: string, rightPath: string): Promise<void> {
  if (pathsEqualIgnoreCase(leftPath, rightPath)) {
    window.alert(t('explorer.compareSameFile'))
    return
  }
  if (!isComparablePath(leftPath) || !isComparablePath(rightPath)) {
    window.alert(t('explorer.compareNotText'))
    return
  }

  const [left, right] = await Promise.all([
    loadCompareSide(leftPath),
    loadCompareSide(rightPath)
  ])
  if (!left || !right) {
    window.alert(t('explorer.compareNotText'))
    return
  }

  useAppStore.getState().openCompareTab({
    leftPath: left.path,
    rightPath: right.path,
    leftContent: left.content,
    rightContent: right.content,
    leftEncoding: left.encoding,
    rightEncoding: right.encoding,
    leftDirty: left.isDirty,
    rightDirty: right.isDirty
  })
}
