import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useAppStore } from '@/stores/app-store'
import { getFileName } from '@/utils/language'
import { isBrowserOpenFile } from '@/utils/browser-tab'
import { isSettingsOpenFile } from '@/utils/settings-tab'
import {
  CHAT_CONTEXT_DRAG_MIME,
  serializeChatContextRefs,
  toChatContextRef
} from '@/utils/chat-context-drag'
import {
  EDITOR_TAB_REORDER_MIME,
  hasTabReorderDrag,
  resolveTabDropIndex
} from '@/utils/tab-reorder'
import { prepareCloseFiles, saveDirtyFiles } from '@/utils/unsaved-files'
import { useI18n } from '@/i18n'
import { CloseIcon } from './icons/ToolbarIcons'
import type { OpenFile } from '@/types'

interface TabContextMenuState {
  x: number
  y: number
  path: string
}

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
  const closeFiles = useAppStore((s) => s.closeFiles)
  const reorderOpenFile = useAppStore((s) => s.reorderOpenFile)
  const tabBarRef = useRef<HTMLDivElement>(null)
  const contextMenuRef = useRef<HTMLDivElement>(null)
  const dragPathRef = useRef<string | null>(null)
  const closingRef = useRef(false)
  const [dragPath, setDragPath] = useState<string | null>(null)
  const [dropIndex, setDropIndex] = useState<number | null>(null)
  const [contextMenu, setContextMenu] = useState<TabContextMenuState | null>(null)
  const openTabsKey = openFiles.map((file) => file.path).join('|')

  const closeContextMenu = () => setContextMenu(null)

  const runClosePaths = async (paths: string[], activatePath?: string) => {
    if (closingRef.current || paths.length === 0) return
    closingRef.current = true
    closeContextMenu()
    try {
      const state = useAppStore.getState()
      const pathSet = new Set(paths)
      const filesToClose = state.openFiles.filter((f) => pathSet.has(f.path))
      if (filesToClose.length === 0) return

      const result = await prepareCloseFiles(filesToClose, {
        confirmUnsavedClose: (count, fileName) =>
          window.compass.app.confirmUnsavedClose(count, fileName),
        saveDirtyFiles: (files) =>
          saveDirtyFiles(files, (savedPath) => useAppStore.getState().markFileSaved(savedPath))
      })
      if (result === 'abort') return

      closeFiles(paths)
      if (
        activatePath &&
        useAppStore.getState().openFiles.some((f) => f.path === activatePath)
      ) {
        setActiveFile(activatePath)
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      window.alert(t('app.closeSaveFailed', { message }))
    } finally {
      closingRef.current = false
    }
  }

  useLayoutEffect(() => {
    const el = tabBarRef.current
    if (!el || !activeFilePath) return
    const activeTab = el.querySelector<HTMLElement>('.tab.active')
    activeTab?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' })
  }, [activeFilePath, openTabsKey])

  useEffect(() => {
    if (!contextMenu) return

    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null
      if (target && contextMenuRef.current?.contains(target)) return
      closeContextMenu()
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeContextMenu()
    }
    const onScroll = () => closeContextMenu()

    window.addEventListener('mousedown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('scroll', onScroll, true)
    return () => {
      window.removeEventListener('mousedown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('scroll', onScroll, true)
    }
  }, [contextMenu])

  const clearDragState = () => {
    dragPathRef.current = null
    setDragPath(null)
    setDropIndex(null)
  }

  if (openFiles.length === 0) return null

  const canCloseOthers = openFiles.length > 1

  return (
    <div
      className="tab-bar"
      ref={tabBarRef}
      onDragOver={(e) => {
        if (!hasTabReorderDrag(e.dataTransfer, EDITOR_TAB_REORDER_MIME)) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
        // バー末端へのドロップ（最後のタブより右）
        if (e.target === e.currentTarget) {
          setDropIndex(openFiles.length)
        }
      }}
      onDrop={(e) => {
        if (!hasTabReorderDrag(e.dataTransfer, EDITOR_TAB_REORDER_MIME)) return
        e.preventDefault()
        const fromPath =
          dragPathRef.current || e.dataTransfer.getData(EDITOR_TAB_REORDER_MIME)
        const toIndex = dropIndex
        clearDragState()
        if (!fromPath || toIndex === null) return
        reorderOpenFile(fromPath, toIndex)
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) {
          setDropIndex(null)
        }
      }}
    >
      {openFiles.map((file, index) => {
        const chatDraggable = canDragTabToChat(file)
        const showDropBefore = dropIndex === index
        return (
          <div
            key={file.path}
            className={`tab${file.path === activeFilePath ? ' active' : ''}${file.isPreview ? ' preview-tab' : ''}${isBrowserOpenFile(file) ? ' browser-tab' : ''}${isSettingsOpenFile(file) ? ' settings-tab-item' : ''} draggable${dragPath === file.path ? ' tab-dragging' : ''}${showDropBefore ? ' tab-drop-before' : ''}`}
            draggable
            onClick={() => setActiveFile(file.path)}
            onContextMenu={(e) => {
              e.preventDefault()
              e.stopPropagation()
              setActiveFile(file.path)
              setContextMenu({ x: e.clientX, y: e.clientY, path: file.path })
            }}
            onDragStart={(e) => {
              dragPathRef.current = file.path
              setDragPath(file.path)
              e.dataTransfer.setData(EDITOR_TAB_REORDER_MIME, file.path)
              e.dataTransfer.effectAllowed = chatDraggable ? 'copyMove' : 'move'
              if (chatDraggable) {
                const ref = toChatContextRef({
                  path: file.path,
                  name: getFileName(file.path),
                  isDirectory: false
                })
                const payload = serializeChatContextRefs([ref])
                e.dataTransfer.setData(CHAT_CONTEXT_DRAG_MIME, payload)
                // Unicode パス向けフォールバック（カスタム MIME が空になる環境対策）
                e.dataTransfer.setData('text/plain', payload)
              }
            }}
            onDragEnd={clearDragState}
            onDragOver={(e) => {
              if (!hasTabReorderDrag(e.dataTransfer, EDITOR_TAB_REORDER_MIME)) return
              e.preventDefault()
              e.stopPropagation()
              e.dataTransfer.dropEffect = 'move'
              const rect = e.currentTarget.getBoundingClientRect()
              setDropIndex(resolveTabDropIndex(e.clientX, rect.left, rect.width, index))
            }}
            onDrop={(e) => {
              if (!hasTabReorderDrag(e.dataTransfer, EDITOR_TAB_REORDER_MIME)) return
              e.preventDefault()
              e.stopPropagation()
              const rect = e.currentTarget.getBoundingClientRect()
              const toIndex = resolveTabDropIndex(e.clientX, rect.left, rect.width, index)
              const fromPath =
                dragPathRef.current || e.dataTransfer.getData(EDITOR_TAB_REORDER_MIME)
              clearDragState()
              if (!fromPath) return
              reorderOpenFile(fromPath, toIndex)
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
                void runClosePaths([file.path])
              }}
            >
              <CloseIcon />
            </button>
          </div>
        )
      })}
      {dropIndex === openFiles.length && <div className="tab-drop-end" aria-hidden />}

      {contextMenu && (
        <div
          ref={contextMenuRef}
          className="file-tree-context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            onClick={() => void runClosePaths([contextMenu.path])}
          >
            {t('editor.closeTab')}
          </button>
          <button
            type="button"
            disabled={!canCloseOthers}
            onClick={() => {
              if (!canCloseOthers) return
              const others = openFiles
                .filter((f) => f.path !== contextMenu.path)
                .map((f) => f.path)
              void runClosePaths(others, contextMenu.path)
            }}
          >
            {t('editor.closeOtherTabs')}
          </button>
          <button
            type="button"
            onClick={() => {
              void runClosePaths(openFiles.map((f) => f.path))
            }}
          >
            {t('editor.closeAllTabs')}
          </button>
        </div>
      )}
    </div>
  )
}
