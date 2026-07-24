import { getImageMimeType, getMediaViewKind, isMediaPath } from '@/utils/media-context'
import { isExternalOpenPath } from '@/utils/external-open'
import { useAppStore } from '@/stores/app-store'
import { t } from '@/i18n'

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/')
}

export type OpenWorkspaceFileOptions = {
  /** true: 一時プレビュータブ（斜体）。false/省略: 通常タブ */
  preview?: boolean
}

/** パス種別に応じてテキスト／画像・PDF／OS 既定アプリで開く */
export async function openWorkspaceFile(
  path: string,
  options?: OpenWorkspaceFileOptions
): Promise<void> {
  const store = useAppStore.getState()
  const asPreview = options?.preview === true

  // 既に開いているタブはディスク再読込せずフォーカスのみ（未保存編集を消さない）
  const existing = store.openFiles.find(
    (f) => normalizePath(f.path) === normalizePath(path)
  )
  if (existing) {
    if (!asPreview && existing.isTransient) {
      store.pinTransientFile(existing.path)
    }
    store.setActiveFile(existing.path)
    return
  }

  if (isExternalOpenPath(path)) {
    try {
      await window.compass.shell.openPath(path)
    } catch (err) {
      window.alert(err instanceof Error ? err.message : t('explorer.openWithDefaultAppFailed'))
    }
    return
  }

  if (isMediaPath(path)) {
    const viewKind = getMediaViewKind(path)
    if (!viewKind) return
    try {
      const { base64 } = await window.compass.fs.readBinaryFile(path)
      const mimeType =
        viewKind === 'pdf' ? 'application/pdf' : (getImageMimeType(path) ?? 'image/png')
      store.openMediaFile(path, viewKind, mimeType, base64, { transient: asPreview })
    } catch (err) {
      window.alert(err instanceof Error ? err.message : t('editor.openMediaFailed'))
    }
    return
  }

  const decoded = await window.compass.fs.readFile(path)
  store.openFile(path, decoded.content, decoded.encoding, { transient: asPreview })
}
