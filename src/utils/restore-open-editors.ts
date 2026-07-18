import { getImageMimeType, getMediaViewKind, isMediaPath } from '@/utils/media-context'
import {
  flushOpenEditorsSave,
  useAppStore,
  withOpenEditorsSaveSuspended
} from '@/stores/app-store'
import type { PersistedOpenTab, WorkspaceOpenEditors } from '@/types'

async function openPersistedTab(tab: PersistedOpenTab): Promise<string | null> {
  const store = useAppStore.getState()

  if (tab.viewKind === 'browser') {
    store.openBrowserTab(tab.browserUrl ?? 'about:blank')
    return useAppStore.getState().activeFilePath
  }

  if (isMediaPath(tab.path) || tab.viewKind === 'image' || tab.viewKind === 'pdf') {
    const viewKind = getMediaViewKind(tab.path) ?? (tab.viewKind === 'pdf' ? 'pdf' : 'image')
    try {
      const { base64 } = await window.compass.fs.readBinaryFile(tab.path)
      const mimeType =
        viewKind === 'pdf' ? 'application/pdf' : (getImageMimeType(tab.path) ?? 'image/png')
      store.openMediaFile(tab.path, viewKind, mimeType, base64)
      return tab.path
    } catch {
      return null
    }
  }

  try {
    const decoded = await window.compass.fs.readFile(tab.path)
    store.openFile(tab.path, decoded.content, decoded.encoding)
    return tab.path
  } catch {
    return null
  }
}

/** ワークスペースに保存された開いていたタブを再オープンする */
export async function restoreOpenEditors(session: WorkspaceOpenEditors): Promise<void> {
  if (!session.openTabs.length) return

  await withOpenEditorsSaveSuspended(async () => {
    let resolvedActive: string | null = null
    let lastOpened: string | null = null

    for (const tab of session.openTabs) {
      const openedPath = await openPersistedTab(tab)
      if (!openedPath) continue
      lastOpened = openedPath
      if (session.activeFilePath && tab.path === session.activeFilePath) {
        resolvedActive = openedPath
      }
    }

    const activePath = resolvedActive ?? lastOpened
    if (activePath) {
      useAppStore.getState().setActiveFile(activePath)
    }
  })

  await flushOpenEditorsSave()
}
