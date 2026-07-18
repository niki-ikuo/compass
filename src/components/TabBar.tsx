import { useAppStore } from '@/stores/app-store'
import { getFileName } from '@/utils/language'
import { isBrowserOpenFile } from '@/utils/browser-tab'
import { isSettingsOpenFile } from '@/utils/settings-tab'
import {
  CHAT_CONTEXT_DRAG_MIME,
  serializeChatContextRefs,
  toChatContextRef
} from '@/utils/chat-context-drag'
import { useI18n } from '@/i18n'
import { CloseIcon } from './icons/ToolbarIcons'
import type { OpenFile } from '@/types'

function canDragTabToChat(file: OpenFile): boolean {
  return !isBrowserOpenFile(file) && !isSettingsOpenFile(file)
}

function tabLabel(
  file: OpenFile,
  labels: { browser: string; settings: string }
): string {
  if (isSettingsOpenFile(file)) return labels.settings
  if (isBrowserOpenFile(file)) {
    const title = file.browserTitle?.trim()
    if (title) return title
    const url = file.browserUrl?.trim()
    if (url && url !== 'about:blank') {
      try {
        return new URL(url).hostname || url
      } catch {
        return url
      }
    }
    return labels.browser
  }
  return getFileName(file.path)
}

export function TabBar() {
  const { t } = useI18n()
  const openFiles = useAppStore((s) => s.openFiles)
  const activeFilePath = useAppStore((s) => s.activeFilePath)
  const setActiveFile = useAppStore((s) => s.setActiveFile)
  const closeFile = useAppStore((s) => s.closeFile)

  if (openFiles.length === 0) return null

  return (
    <div className="tab-bar">
      {openFiles.map((file) => {
        const draggable = canDragTabToChat(file)
        return (
          <div
            key={file.path}
            className={`tab ${file.path === activeFilePath ? 'active' : ''}${file.isPreview ? ' preview-tab' : ''}${isBrowserOpenFile(file) ? ' browser-tab' : ''}${isSettingsOpenFile(file) ? ' settings-tab-item' : ''}${draggable ? ' draggable' : ''}`}
            draggable={draggable}
            onClick={() => setActiveFile(file.path)}
            onDragStart={(e) => {
              if (!canDragTabToChat(file)) {
                e.preventDefault()
                return
              }
              const ref = toChatContextRef({
                path: file.path,
                name: getFileName(file.path),
                isDirectory: false
              })
              const payload = serializeChatContextRefs([ref])
              e.dataTransfer.setData(CHAT_CONTEXT_DRAG_MIME, payload)
              // Unicode パス向けフォールバック（カスタム MIME が空になる環境対策）
              e.dataTransfer.setData('text/plain', payload)
              e.dataTransfer.effectAllowed = 'copy'
            }}
          >
            <span
              className="tab-name"
              title={
                isBrowserOpenFile(file)
                  ? file.browserUrl
                  : isSettingsOpenFile(file)
                    ? t('settings.title')
                    : file.path
              }
            >
              {file.isPreview && <span className="tab-preview-badge">P</span>}
              {isBrowserOpenFile(file) && <span className="tab-browser-badge">B</span>}
              {file.isDirty && !file.isPreview && <span className="dirty-dot">●</span>}
              {tabLabel(file, {
                browser: t('browser.newTab'),
                settings: t('settings.title')
              })}
            </span>
            <button
              className="tab-close"
              onClick={(e) => {
                e.stopPropagation()
                closeFile(file.path)
              }}
            >
              <CloseIcon />
            </button>
          </div>
        )
      })}
    </div>
  )
}
