import { getImageMimeType, getMediaViewKind, isMediaPath } from '@/utils/media-context'
import { isExternalOpenPath } from '@/utils/external-open'
import { useAppStore } from '@/stores/app-store'
import { t } from '@/i18n'

/** パス種別に応じてテキスト／画像・PDF／OS 既定アプリで開く */
export async function openWorkspaceFile(path: string): Promise<void> {
  const store = useAppStore.getState()

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
      store.openMediaFile(path, viewKind, mimeType, base64)
    } catch (err) {
      window.alert(err instanceof Error ? err.message : t('editor.openMediaFailed'))
    }
    return
  }

  const decoded = await window.compass.fs.readFile(path)
  store.openFile(path, decoded.content, decoded.encoding)
}
