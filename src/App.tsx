import { useEffect, useCallback } from 'react'
import { useAppStore } from '@/stores/app-store'
import { LeftSidebar } from './components/LeftSidebar'
import { ChatPanel } from './components/ChatPanel'
import { SettingsDialog } from './components/SettingsDialog'
import { StatusBar } from './components/StatusBar'
import { ResizableLayout } from './components/ResizableLayout'
import { WorkspaceWelcome } from './components/WorkspaceWelcome'
import { MenuBar } from './components/MenuBar'
import { EditorCenter } from './components/EditorCenter'
import { buildWorkspaceIndex } from '@/utils/project-index'
import { applyColorTheme } from '@/utils/color-theme'
import { getLlmProvider } from '@/utils/llm-providers'
import { setLocale } from '@/i18n'

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
  const setSettingsOpen = useAppStore((s) => s.setSettingsOpen)
  const openSearchPanel = useAppStore((s) => s.openSearchPanel)
  const setLeftSidebarView = useAppStore((s) => s.setLeftSidebarView)
  const leftSidebarView = useAppStore((s) => s.leftSidebarView)
  const workspaceRoot = useAppStore((s) => s.workspaceRoot)
  const setWorkspaceRoot = useAppStore((s) => s.setWorkspaceRoot)
  const restoreChatSessions = useAppStore((s) => s.restoreChatSessions)
  const closeWorkspace = useAppStore((s) => s.closeWorkspace)
  const setFileTree = useAppStore((s) => s.setFileTree)
  const setSettings = useAppStore((s) => s.setSettings)
  const setApiConnected = useAppStore((s) => s.setApiConnected)
  const colorTheme = useAppStore((s) => s.settings.colorTheme)
  const locale = useAppStore((s) => s.settings.locale)
  const getActiveFile = useAppStore((s) => s.getActiveFile)
  const markFileSaved = useAppStore((s) => s.markFileSaved)

  const openWorkspace = useCallback(
    async (folder: string) => {
      const currentRoot = useAppStore.getState().workspaceRoot
      if (currentRoot && currentRoot !== folder) {
        if (!closeWorkspace()) return
        await window.compass.index.unwatch()
      }

      setWorkspaceRoot(folder)
      try {
        const [tree, chatHistory] = await Promise.all([
          window.compass.fs.readDir(folder),
          window.compass.chat.loadHistory(folder)
        ])
        setFileTree(tree)
        restoreChatSessions(chatHistory.sessions, chatHistory.activeChatId)
        await window.compass.index.watch(folder)
        void buildWorkspaceIndex(folder)
        await window.compass.workspace.addRecent(folder)
      } catch (error) {
        await window.compass.index.unwatch()
        setWorkspaceRoot(null)
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

  const handleCloseFolder = useCallback(async () => {
    if (!closeWorkspace()) return
    await window.compass.index.unwatch()
    await window.compass.workspace.setLast(null)
  }, [closeWorkspace])

  const handleSave = useCallback(async () => {
    const activeFile = getActiveFile()
    if (!activeFile || activeFile.isPreview) return

    await window.compass.fs.writeFile(activeFile.path, activeFile.content, activeFile.encoding)
    markFileSaved(activeFile.path)
  }, [getActiveFile, markFileSaved])

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
      const provider = getLlmProvider(settings.providerId)
      setApiConnected(
        provider.requiresApiKey ? (settings.apiKey ? true : null) : true
      )

      const lastWorkspace = await window.compass.workspace.getLast()
      if (!lastWorkspace) return

      try {
        await openWorkspace(lastWorkspace)
      } catch {
        await window.compass.workspace.removeRecent(lastWorkspace)
      }
    }
    loadSettings()
  }, [setSettings, setApiConnected, openWorkspace])

  useEffect(() => {
    const unsubs = [
      window.compass.menu.onOpenFolder(handleOpenFolder),
      window.compass.menu.onCloseFolder(handleCloseFolder),
      window.compass.menu.onSave(handleSave),
      window.compass.menu.onSettings(() => setSettingsOpen(true)),
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
      })
    ]
    return () => unsubs.forEach((fn) => fn())
  }, [
    handleOpenFolder,
    handleCloseFolder,
    handleSave,
    setSettingsOpen,
    setShowTerminal,
    openSearchPanel
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
    if (showFileTree && leftSidebarView === 'explorer') {
      setShowFileTree(false)
      return
    }
    setLeftSidebarView('explorer')
    setShowFileTree(true)
  }, [showFileTree, leftSidebarView, setShowFileTree, setLeftSidebarView])

  const handleOpenSearch = useCallback(() => {
    if (!workspaceRoot) return
    openSearchPanel()
  }, [workspaceRoot, openSearchPanel])

  return (
    <div className="app">
      <MenuBar
        showFileTree={showFileTree}
        showChat={showChat}
        showTerminal={showTerminal}
        leftSidebarView={leftSidebarView}
        onToggleFileTree={handleToggleExplorer}
        onOpenSearch={handleOpenSearch}
        onToggleChat={() => setShowChat(!showChat)}
        onToggleTerminal={() => setShowTerminal(!showTerminal)}
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenFolder={() => void handleOpenFolder()}
        onCloseFolder={() => void handleCloseFolder()}
        onSave={() => void handleSave()}
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
          workspaceRoot ? (
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
      <SettingsDialog />
    </div>
  )
}
