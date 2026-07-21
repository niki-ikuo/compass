import { useEffect, useCallback, useState } from 'react'
import { useAppStore, flushChatHistorySave, flushOpenEditorsSave } from '@/stores/app-store'
import { LeftSidebar } from './components/LeftSidebar'
import { ChatPanel } from './components/ChatPanel'
import { StatusBar } from './components/StatusBar'
import { ResizableLayout } from './components/ResizableLayout'
import { WorkspaceWelcome } from './components/WorkspaceWelcome'
import { MenuBar } from './components/MenuBar'
import { EditorCenter } from './components/EditorCenter'
import { HelpDialog, type HelpCommandId } from './components/HelpDialog'
import { HelpAskDialog } from './components/HelpAskDialog'
import { buildWorkspaceIndex } from '@/utils/project-index'
import { applyColorTheme } from '@/utils/color-theme'
import { setLocale, t } from '@/i18n'
import { registerWheelZoomListener } from '@/utils/wheel-zoom'
import { restoreOpenEditors } from '@/utils/restore-open-editors'
import { refreshLlmConnection } from '@/utils/llm-connection'
import { listDirtySavableFiles, saveDirtyFiles } from '@/utils/unsaved-files'

export function App() {
  const showFileTree = useAppStore((s) => s.showFileTree)
  const showChat = useAppStore((s) => s.showChat)
  const showTerminal = useAppStore((s) => s.showTerminal)
  const panelLayout = useAppStore((s) => s.panelLayout)
  const setShowFileTree = useAppStore((s) => s.setShowFileTree)
  const setShowChat = useAppStore((s) => s.setShowChat)
  const setShowTerminal = useAppStore((s) => s.setShowTerminal)
  const setFileTreeWidthRatio = useAppStore((s) => s.setFileTreeWidthRatio)
  const setChatPanelWidthRatio = useAppStore((s) => s.setChatPanelWidthRatio)
  const openSettingsTab = useAppStore((s) => s.openSettingsTab)
  const openSearchPanel = useAppStore((s) => s.openSearchPanel)
  const workspaceRoot = useAppStore((s) => s.workspaceRoot)
  const setWorkspaceRoot = useAppStore((s) => s.setWorkspaceRoot)
  const restoreChatSessions = useAppStore((s) => s.restoreChatSessions)
  const closeWorkspace = useAppStore((s) => s.closeWorkspace)
  const setFileTree = useAppStore((s) => s.setFileTree)
  const setSettings = useAppStore((s) => s.setSettings)
  const colorTheme = useAppStore((s) => s.settings.colorTheme)
  const locale = useAppStore((s) => s.settings.locale)
  const getActiveFile = useAppStore((s) => s.getActiveFile)
  const markFileSaved = useAppStore((s) => s.markFileSaved)
  const openFiles = useAppStore((s) => s.openFiles)
  const openBrowserTab = useAppStore((s) => s.openBrowserTab)
  const llmConnected = useAppStore((s) => s.llmConnection.status === 'connected')
  const [helpOpen, setHelpOpen] = useState(false)
  const [helpAskOpen, setHelpAskOpen] = useState(false)
  const [helpDocId, setHelpDocId] = useState('index.md')

  const openHelp = useCallback((docId = 'index.md') => {
    setHelpDocId(docId)
    setHelpOpen(true)
  }, [])

  const openHelpAsk = useCallback(() => {
    if (useAppStore.getState().llmConnection.status !== 'connected') return
    setHelpAskOpen(true)
  }, [])

  useEffect(() => {
    if (!llmConnected && helpAskOpen) {
      setHelpAskOpen(false)
    }
  }, [llmConnected, helpAskOpen])

  const openWorkspace = useCallback(
    async (folder: string) => {
      const currentRoot = useAppStore.getState().workspaceRoot
      if (currentRoot && currentRoot !== folder) {
        if (!closeWorkspace()) return
        await window.compass.index.unwatch()
      }

      setWorkspaceRoot(folder)
      try {
        const [tree, chatHistory, workspaceSettings, openEditors] = await Promise.all([
          window.compass.fs.readDir(folder),
          window.compass.chat.loadHistory(folder),
          window.compass.workspace.getSettings(folder),
          window.compass.openEditors.load(folder)
        ])
        setFileTree(tree)
        useAppStore
          .getState()
          .setWorkspaceDefaultUseCasePreset(workspaceSettings.defaultUseCasePreset ?? null)
        restoreChatSessions(chatHistory.sessions, chatHistory.activeChatId)
        // 起動・フォルダ切替後のみ復元（同一 WS の再読み込みでタブを二重化しない）
        if (useAppStore.getState().openFiles.length === 0) {
          await restoreOpenEditors(openEditors)
        }
        await window.compass.index.watch(folder)
        void buildWorkspaceIndex(folder)
        await window.compass.workspace.addRecent(folder)
      } catch (error) {
        await window.compass.index.unwatch()
        setWorkspaceRoot(null)
        useAppStore.getState().setWorkspaceDefaultUseCasePreset(null)
        setFileTree([])
        throw error
      }
    },
    [closeWorkspace, setWorkspaceRoot, setFileTree, restoreChatSessions]
  )

  const handleOpenFolder = useCallback(async () => {
    const folder = await window.compass.fs.openFolder()
    if (!folder) return
    await openWorkspace(folder)
  }, [openWorkspace])

  const handleHelpCommand = useCallback(
    (command: HelpCommandId) => {
      switch (command) {
        case 'Open Settings':
        case 'Open Provider':
          openSettingsTab()
          break
        case 'Open Folder':
          void handleOpenFolder()
          break
        case 'Focus Chat':
          setShowChat(true)
          break
      }
    },
    [openSettingsTab, handleOpenFolder, setShowChat]
  )

  const handleCloseFolder = useCallback(async () => {
    if (!closeWorkspace()) return
    await window.compass.index.unwatch()
    await window.compass.workspace.setLast(null)
  }, [closeWorkspace])

  const handleSave = useCallback(async () => {
    const activeFile = getActiveFile()
    if (!activeFile || activeFile.isPreview) return
    if (
      activeFile.viewKind === 'image' ||
      activeFile.viewKind === 'pdf' ||
      activeFile.viewKind === 'browser' ||
      activeFile.viewKind === 'settings'
    ) {
      return
    }

    await window.compass.fs.writeFile(activeFile.path, activeFile.content, activeFile.encoding)
    markFileSaved(activeFile.path)
  }, [getActiveFile, markFileSaved])

  const handleAppCloseRequested = useCallback(async () => {
    const dirtyFiles = listDirtySavableFiles(useAppStore.getState().openFiles)

    const finishClose = async (): Promise<void> => {
      try {
        await Promise.all([flushChatHistorySave(), flushOpenEditorsSave()])
      } catch {
        // 終了自体は続行（セッション復元の失敗でブロックしない）
      }
      await window.compass.app.allowClose()
    }

    if (dirtyFiles.length === 0) {
      await finishClose()
      return
    }

    const choice = await window.compass.app.confirmUnsavedQuit(dirtyFiles.length)
    if (choice === 'cancel') {
      await window.compass.app.cancelClose()
      return
    }

    if (choice === 'save') {
      try {
        await saveDirtyFiles(dirtyFiles, (path) => useAppStore.getState().markFileSaved(path))
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        window.alert(t('app.quitSaveFailed', { message }))
        await window.compass.app.cancelClose()
        return
      }
    }

    await finishClose()
  }, [])

  useEffect(() => {
    return window.compass.app.onCloseRequested(() => {
      void handleAppCloseRequested()
    })
  }, [handleAppCloseRequested])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || !event.shiftKey) return
      if (event.key.toLowerCase() !== 'b') return
      const target = event.target as HTMLElement | null
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)
      ) {
        return
      }
      event.preventDefault()
      openBrowserTab()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [openBrowserTab])

  // Monaco / xterm が wheel を preventDefault しても Ctrl+wheel ズームが効くようにする
  useEffect(() => registerWheelZoomListener(), [])

  useEffect(() => {
    document.title = workspaceRoot ? `Compass - ${workspaceRoot}` : 'Compass'
  }, [workspaceRoot])

  useEffect(() => {
    applyColorTheme(colorTheme)
  }, [colorTheme])

  useEffect(() => {
    setLocale(locale)
  }, [locale])

  useEffect(() => {
    const loadSettings = async () => {
      const settings = await window.compass.settings.get()
      setSettings(settings)
      applyColorTheme(settings.colorTheme)
      setLocale(settings.locale)
      void refreshLlmConnection()

      const lastWorkspace = await window.compass.workspace.getLast()
      if (!lastWorkspace) return

      try {
        await openWorkspace(lastWorkspace)
      } catch {
        await window.compass.workspace.removeRecent(lastWorkspace)
      }
    }
    loadSettings()
  }, [setSettings, openWorkspace])

  useEffect(() => {
    const unsubs = [
      window.compass.menu.onOpenFolder(handleOpenFolder),
      window.compass.menu.onCloseFolder(handleCloseFolder),
      window.compass.menu.onSave(handleSave),
      window.compass.menu.onSettings(() => openSettingsTab()),
      window.compass.menu.onToggleTerminal(() => {
        if (!useAppStore.getState().workspaceRoot) return
        setShowTerminal(!useAppStore.getState().showTerminal)
      }),
      window.compass.menu.onFindInFile(() => {
        window.dispatchEvent(new CustomEvent('compass:find-in-file'))
      }),
      window.compass.menu.onReplaceInFile(() => {
        window.dispatchEvent(new CustomEvent('compass:replace-in-file'))
      }),
      window.compass.menu.onFindInFiles(() => {
        if (!useAppStore.getState().workspaceRoot) return
        openSearchPanel({ replace: false })
      }),
      window.compass.menu.onReplaceInFiles(() => {
        if (!useAppStore.getState().workspaceRoot) return
        openSearchPanel({ replace: true })
      }),
      window.compass.menu.onOpenHelp(() => openHelp()),
      window.compass.menu.onOpenAiHelp(() => openHelpAsk())
    ]
    return () => unsubs.forEach((fn) => fn())
  }, [
    handleOpenFolder,
    handleCloseFolder,
    handleSave,
    openSettingsTab,
    setShowTerminal,
    openSearchPanel,
    openHelp,
    openHelpAsk
  ])

  useEffect(() => {
    const setIndexStatus = useAppStore.getState().setIndexStatus
    const setIndexMeta = useAppStore.getState().setIndexMeta

    const unsubUpdated = window.compass.index.onUpdated((result) => {
      const current = useAppStore.getState().workspaceRoot
      if (
        !current ||
        current.replace(/[/\\]+$/, '').replace(/\\/g, '/').toLowerCase() !==
          result.workspaceRoot.replace(/[/\\]+$/, '').replace(/\\/g, '/').toLowerCase()
      ) {
        return
      }
      setIndexMeta(result)
      setIndexStatus('ready')
    })
    const unsubStatus = window.compass.index.onStatus((status, root) => {
      const current = useAppStore.getState().workspaceRoot
      if (
        !current ||
        current.replace(/[/\\]+$/, '').replace(/\\/g, '/').toLowerCase() !==
          root.replace(/[/\\]+$/, '').replace(/\\/g, '/').toLowerCase()
      ) {
        return
      }
      setIndexStatus(status)
    })

    return () => {
      unsubUpdated()
      unsubStatus()
    }
  }, [])

  const handleToggleExplorer = useCallback(() => {
    setShowFileTree(!showFileTree)
  }, [showFileTree, setShowFileTree])

  return (
    <div className="app">
      <MenuBar
        showFileTree={showFileTree}
        showChat={showChat}
        showTerminal={showTerminal}
        onToggleFileTree={handleToggleExplorer}
        onToggleChat={() => setShowChat(!showChat)}
        onToggleTerminal={() => setShowTerminal(!showTerminal)}
        onOpenSettings={() => openSettingsTab()}
        onOpenFolder={() => void handleOpenFolder()}
        onCloseFolder={() => void handleCloseFolder()}
        onSave={() => void handleSave()}
        onOpenHelp={() => openHelp()}
        onOpenAiHelp={() => openHelpAsk()}
      />

      <ResizableLayout
        showLeft={showFileTree}
        showRight={showChat}
        leftRatio={panelLayout.fileTreeWidthRatio}
        rightRatio={panelLayout.chatWidthRatio}
        onLeftRatioChange={setFileTreeWidthRatio}
        onRightRatioChange={setChatPanelWidthRatio}
        left={<LeftSidebar />}
        center={
          workspaceRoot || openFiles.length > 0 ? (
            <EditorCenter />
          ) : (
            <WorkspaceWelcome
              onOpenFolder={() => void handleOpenFolder()}
              onOpenRecent={openWorkspace}
            />
          )
        }
        right={<ChatPanel />}
      />

      <StatusBar />

      <HelpDialog
        open={helpOpen}
        initialDocId={helpDocId}
        showAiHelp={llmConnected}
        onClose={() => setHelpOpen(false)}
        onCommand={handleHelpCommand}
        onOpenAsk={() => {
          setHelpOpen(false)
          openHelpAsk()
        }}
      />
      <HelpAskDialog
        open={helpAskOpen}
        onClose={() => setHelpAskOpen(false)}
        onCommand={handleHelpCommand}
        onOpenHelp={() => {
          setHelpAskOpen(false)
          openHelp()
        }}
        onOpenArticle={(docId) => {
          setHelpAskOpen(false)
          openHelp(docId)
        }}
      />
    </div>
  )
}
