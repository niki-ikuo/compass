import { app, BrowserWindow, ipcMain, dialog, Menu, shell, session } from 'electron'
import { join } from 'path'
import appIcon from '../resources/icon.ico?asset'
import packageJson from '../package.json'
import { t } from '../src/i18n/runtime'
import type { FileEncoding, GitDiffSide, UseCasePreset } from '../src/types'
import {
  COLOR_THEME_ARG_PREFIX,
  getThemeBackgroundColor
} from '../src/utils/color-theme'
import { nextZoomLevel } from './view-zoom'
import {
  createDirectory,
  createFile,
  deletePath,
  movePath,
  readDirectory,
  readFileContent,
  renamePath,
  resolveChatContext,
  previewWorkspaceActions,
  importFilesToWorkspace,
  copyPathsInto,
  writeBinaryFile,
  writeFileContent,
  readBinaryFile,
  openEditorFile
} from './services/filesystem'
import {
  applyWorkspaceActionsRecordingUndo,
  listChangeSets,
  undoChangeSet,
  undoChatApplies,
  undoLastChangeSet
} from './services/ai-undo'
import {
  checkoutGitBranch,
  commitGit,
  discardGitPaths,
  getGitDiff,
  getGitStatus,
  listGitBranches,
  pullGit,
  pushGit,
  stageGitPaths,
  unstageGitPaths
} from './services/git'
import {
  captureClipboardToInbox,
  markInboxDone,
  markAllInboxDone,
  deleteInboxItem
} from './services/desk-capture'
import { ensureDeskDirs } from './services/desk-dirs'
import {
  getDeskCaptureHotkeyStatus,
  getDeskShowHotkeyStatus,
  refreshDeskHotkeys,
  unregisterDeskHotkeys
} from './services/desk-hotkey'
import {
  destroyDeskTray,
  refreshDeskTray,
  shouldHideToTray,
  showMainWindowFromTray
} from './services/desk-tray'
import { listDeskInbox, listDeskOutbox } from './services/desk-list'
import { archiveOutboxItem, archiveAllOutboxItems, deleteOutboxItem } from './services/desk-outbox'
import { copyOutboxPayload, runDeskShipCheck } from './services/desk-ship-check'
import { cancelChat, cancelInlineCompletion, completeInline, streamChat } from './services/ai-client'
import { runAgent } from './services/agent-runner'
import {
  getSettings,
  getPublicSettings,
  setSettings,
  getLastWorkspaceRoot,
  setLastWorkspaceRoot,
  getRecentWorkspaceRoots,
  addRecentWorkspaceRoot,
  removeRecentWorkspaceRoot
} from './services/settings'
import {
  assertActiveWorkspacePath,
  assertActiveWorkspacePaths,
  bindActiveWorkspaceRoot,
  registerExternalContextPaths,
  setActiveWorkspaceRoot
} from './services/path-guard'
import {
  resolveAgentApprovalForSender,
  resolveAgentContinueForSender
} from './services/agent-approval'
import { getUsage, resetUsage } from './services/usage'
import {
  getWorkspaceSettings,
  setWorkspaceSettings
} from './services/workspace-settings'
import {
  buildProjectIndex,
  ensureProjectIndex,
  getProjectIndexContext,
  getWorkspaceOutline,
  isProjectIndexStale,
  setIndexProgressEmitter
} from './services/project-indexer'
import { startIndexWatcher, stopIndexWatcher } from './services/index-watcher'
import { loadChatHistory, saveChatHistory } from './services/chat-history'
import { loadOpenEditors, saveOpenEditors } from './services/open-editors'
import { loadExplorerState, saveExplorerState } from './services/explorer-state'
import {
  createTerminal,
  killAllTerminals,
  killTerminal,
  listAvailableShells,
  resizeTerminal,
  setAllTerminalsCwd,
  writeTerminal
} from './services/terminal'
import { replaceInWorkspace, searchWorkspace } from './services/workspace-search'
import { getHelpDoc, listHelpDocs, searchHelpDocs } from './services/help'
import { askHelp, cancelHelpAsk } from './services/help-ask'
import type {
  AppSettings,
  ApplyWorkspaceOptions,
  ChatContextRef,
  ChatRequest,
  ChatSession,
  HelpAskRequest,
  InlineCompletionRequest,
  WorkspaceAction,
  WorkspaceOpenEditors,
  WorkspaceExplorerState,
  WorkspaceReplaceOptions,
  WorkspaceSearchOptions
} from '../src/types'
import { testLlmConnection } from './services/ai-connection'

let mainWindow: BrowserWindow | null = null
let aiHelpMenuVisible = false
/** 未保存確認を経たうえでウィンドウを閉じる許可 */
let allowWindowClose = false
/** File → Quit / tray Quit / before-quit — hide-to-tray を抑止 */
let isAppQuitting = false
/** 最新のトレイ設定（close ハンドラで同期 getSettings を避ける） */
let deskTrayEnabled = false
/** クローズ確認ダイアログ／レンダラ応答の処理中（二重ダイアログ防止） */
let closeRequestInFlight = false
let closeRequestResetTimer: ReturnType<typeof setTimeout> | null = null

// Windows トーストの送信元を electron.app.Electron ではなく Compass にする
if (process.platform === 'win32') {
  app.setAppUserModelId('com.compass.editor')
}

// 設定・.compass・ホットキー・トレイはプロセス共有前提。複数起動は許可しない。
const gotSingleInstanceLock = app.requestSingleInstanceLock()
if (!gotSingleInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      if (app.isReady()) {
        void createWindow()
      }
      return
    }
    showMainWindowFromTray(() => mainWindow)
  })
}

function resetCloseRequestState(): void {
  closeRequestInFlight = false
  if (closeRequestResetTimer) {
    clearTimeout(closeRequestResetTimer)
    closeRequestResetTimer = null
  }
}

async function syncDeskTrayEnabledFromSettings(): Promise<void> {
  const settings = await getSettings()
  deskTrayEnabled = settings.deskTrayEnabled === true
}

function beginQuitFlow(): void {
  isAppQuitting = true
  if (!mainWindow || mainWindow.isDestroyed()) {
    app.quit()
    return
  }
  // Do not show a tray-hidden window here — that flashes the UI before quit.
  // IPC / dialogs still work while hidden; unsaved dialogs use no parent when hidden.
  if (allowWindowClose) {
    closeMainWindowForQuit()
    return
  }
  if (!mainWindow.webContents || mainWindow.webContents.isLoadingMainFrame()) {
    allowWindowClose = true
    closeMainWindowForQuit()
    return
  }
  requestRendererCloseConfirm()
}

/** Close without briefly flashing a window that was hidden to the tray. */
function closeMainWindowForQuit(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    app.quit()
    return
  }
  if (!mainWindow.isVisible()) {
    mainWindow.destroy()
    return
  }
  mainWindow.close()
}

async function refreshTrayAndHotkey(): Promise<void> {
  await syncDeskTrayEnabledFromSettings()
  await refreshDeskHotkeys(() => mainWindow)
  await refreshDeskTray(appIcon, {
    getMainWindow: () => mainWindow,
    requestQuit: () => beginQuitFlow()
  })
  // Turning tray off while hidden: bring the window back so the next close can quit.
  if (!deskTrayEnabled && mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) {
    showMainWindowFromTray(() => mainWindow)
  }
}

function requestRendererCloseConfirm(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return
  if (closeRequestInFlight) return
  closeRequestInFlight = true
  if (closeRequestResetTimer) clearTimeout(closeRequestResetTimer)
  // レンダラ無応答時に再度閉じられるようにする
  closeRequestResetTimer = setTimeout(() => {
    closeRequestInFlight = false
    closeRequestResetTimer = null
  }, 60_000)
  mainWindow.webContents.send('app:close-requested')
}

function applyViewZoom(
  webContents: Electron.WebContents,
  action: 'resetZoom' | 'zoomIn' | 'zoomOut'
): void {
  // Always read the live level so menu shortcuts cannot desync us.
  const nextLevel = nextZoomLevel(webContents.getZoomLevel(), action)
  webContents.setZoomLevel(nextLevel)
}

function zoomMenuClick(action: 'resetZoom' | 'zoomIn' | 'zoomOut'): void {
  const webContents = mainWindow?.webContents
  if (!webContents) return
  applyViewZoom(webContents, action)
}

/** App-shell CSP. Dev allows Vite HMR (unsafe-eval + localhost ws/http). */
function applyContentSecurityPolicy(): void {
  const csp = app.isPackaged
    ? [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob:",
        "font-src 'self' data:",
        // LLM traffic stays in main; renderer should not need broad connect-src
        "connect-src 'self'",
        "media-src 'self' blob:",
        "worker-src 'self' blob:",
        "frame-src 'self'",
        "object-src 'none'",
        "base-uri 'self'"
      ].join('; ')
    : [
        "default-src 'self'",
        "script-src 'self' 'unsafe-eval' 'unsafe-inline'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob:",
        "font-src 'self' data:",
        "connect-src 'self' http://localhost:* http://127.0.0.1:* ws://localhost:* ws://127.0.0.1:*",
        "media-src 'self' blob:",
        "worker-src 'self' blob:",
        "frame-src 'self'",
        "object-src 'none'",
        "base-uri 'self'"
      ].join('; ')

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const url = details.url
    // App shell only (file: packaged, or Vite http: in dev). Skip webview guest pages.
    const isAppShell =
      url.startsWith('file:') ||
      (!app.isPackaged &&
        (url.startsWith('http://localhost:') || url.startsWith('http://127.0.0.1:')))
    if (!isAppShell) {
      callback({ responseHeaders: details.responseHeaders })
      return
    }

    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [csp]
      }
    })
  })
}

async function createWindow(): Promise<void> {
  const settings = await getSettings()
  const backgroundColor = getThemeBackgroundColor(settings.colorTheme)

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: 'Compass',
    icon: appIcon,
    backgroundColor,
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: true,
      additionalArguments: [`${COLOR_THEME_ARG_PREFIX}${settings.colorTheme}`]
    }
  })

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show()
  })

  // JIS: @ / ` share BracketLeft; Electron menu accelerators often miss them.
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (isNewTerminalShortcut(input)) {
      event.preventDefault()
      emitNewTerminalMenu()
      return
    }
    if (isToggleTerminalShortcut(input)) {
      event.preventDefault()
      emitToggleTerminal()
    }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  if (process.platform !== 'darwin') {
    mainWindow.setMenuBarVisibility(false)
  }

  mainWindow.on('close', (event) => {
    if (
      shouldHideToTray({
        deskTrayEnabled,
        isAppQuitting,
        allowWindowClose
      })
    ) {
      event.preventDefault()
      mainWindow?.hide()
      return
    }
    if (allowWindowClose) return
    event.preventDefault()
    if (!mainWindow?.webContents || mainWindow.webContents.isLoadingMainFrame()) {
      allowWindowClose = true
      mainWindow?.close()
      return
    }
    requestRendererCloseConfirm()
  })

  mainWindow.on('closed', () => {
    mainWindow = null
    allowWindowClose = false
    resetCloseRequestState()
  })
}

function createMenu(): void {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: t('menu.file'),
      submenu: [
        {
          label: t('menu.openFolder'),
          accelerator: 'CmdOrCtrl+O',
          click: () => mainWindow?.webContents.send('menu:open-folder')
        },
        {
          label: t('menu.closeFolder'),
          accelerator: 'CmdOrCtrl+Shift+W',
          click: () => mainWindow?.webContents.send('menu:close-folder')
        },
        {
          label: t('menu.save'),
          accelerator: 'CmdOrCtrl+S',
          click: () => mainWindow?.webContents.send('menu:save')
        },
        { type: 'separator' },
        {
          label: t('menu.settings'),
          accelerator: 'CmdOrCtrl+,',
          click: () => mainWindow?.webContents.send('menu:settings')
        },
        { type: 'separator' },
        {
          label: t('menu.quit'),
          accelerator: 'CmdOrCtrl+Q',
          click: () => beginQuitFlow()
        }
      ]
    },
    {
      label: t('menu.edit'),
      submenu: [
        { role: 'undo', label: t('menu.undo') },
        { role: 'redo', label: t('menu.redo') },
        { type: 'separator' },
        { role: 'cut', label: t('menu.cut') },
        { role: 'copy', label: t('menu.copy') },
        { role: 'paste', label: t('menu.paste') },
        { type: 'separator' },
        { role: 'selectAll', label: t('menu.selectAll') },
        { type: 'separator' },
        {
          label: t('menu.findInFile'),
          accelerator: 'CmdOrCtrl+F',
          click: () => mainWindow?.webContents.send('menu:find-in-file')
        },
        {
          label: t('menu.replaceInFile'),
          accelerator: 'CmdOrCtrl+H',
          click: () => mainWindow?.webContents.send('menu:replace-in-file')
        },
        {
          label: t('menu.findInFiles'),
          accelerator: 'CmdOrCtrl+Shift+F',
          click: () => mainWindow?.webContents.send('menu:find-in-files')
        },
        {
          label: t('menu.replaceInFiles'),
          accelerator: 'CmdOrCtrl+Shift+H',
          click: () => mainWindow?.webContents.send('menu:replace-in-files')
        }
      ]
    },
    {
      label: t('menu.view'),
      submenu: [
        { role: 'reload', label: t('menu.reload') },
        { role: 'toggleDevTools', label: t('menu.toggleDevTools') },
        { type: 'separator' },
        // Use click handlers (not role) so zoom always goes through applyViewZoom / getZoomLevel.
        // Hidden accelerator aliases still need a label (Electron rejects items without label/role/type).
        { label: t('menu.resetZoom'), accelerator: 'CmdOrCtrl+0', click: () => zoomMenuClick('resetZoom') },
        {
          label: t('menu.resetZoom'),
          accelerator: 'CmdOrCtrl+num0',
          visible: false,
          click: () => zoomMenuClick('resetZoom')
        },
        // Show Ctrl++; also bind Ctrl+= and numpad (default Plus alone often needs Shift on Win/Linux).
        { label: t('menu.zoomIn'), accelerator: 'CmdOrCtrl+Plus', click: () => zoomMenuClick('zoomIn') },
        {
          label: t('menu.zoomIn'),
          accelerator: 'CmdOrCtrl+=',
          visible: false,
          click: () => zoomMenuClick('zoomIn')
        },
        {
          label: t('menu.zoomIn'),
          accelerator: 'CmdOrCtrl+numadd',
          visible: false,
          click: () => zoomMenuClick('zoomIn')
        },
        { label: t('menu.zoomOut'), accelerator: 'CmdOrCtrl+-', click: () => zoomMenuClick('zoomOut') },
        {
          label: t('menu.zoomOut'),
          accelerator: 'CmdOrCtrl+numsub',
          visible: false,
          click: () => zoomMenuClick('zoomOut')
        },
        { type: 'separator' },
        {
          label: t('menu.showWorkspaceOutline'),
          accelerator: 'CmdOrCtrl+Shift+O',
          click: () => mainWindow?.webContents.send('menu:show-outline')
        },
        {
          // Accelerator lives on Edit → Find in Files; View entry is for discoverability.
          label: t('menu.showWorkspaceSearch'),
          click: () => mainWindow?.webContents.send('menu:find-in-files')
        },
        {
          label: t('menu.showGit'),
          accelerator: 'CmdOrCtrl+Shift+G',
          click: () => mainWindow?.webContents.send('menu:show-git')
        },
        {
          label: t('menu.showDesk'),
          accelerator: 'CmdOrCtrl+Shift+D',
          click: () => mainWindow?.webContents.send('menu:show-desk')
        },
        { type: 'separator' },
        {
          label: t('menu.terminal'),
          // JA menu shows Ctrl+@; JIS Ctrl+@ is also handled via before-input-event.
          accelerator: 'CmdOrCtrl+`',
          click: () => emitToggleTerminal()
        },
        {
          label: t('menu.terminal'),
          accelerator: 'CmdOrCtrl+@',
          visible: false,
          click: () => emitToggleTerminal()
        },
        {
          label: t('menu.newTerminal'),
          // JA menu shows Ctrl+Shift+@; JIS Shift+@ via before-input-event.
          accelerator: 'CmdOrCtrl+Shift+`',
          click: () => emitNewTerminalMenu()
        },
        {
          label: t('menu.newTerminal'),
          accelerator: 'CmdOrCtrl+Shift+@',
          visible: false,
          click: () => emitNewTerminalMenu()
        }
      ]
    },
    {
      label: t('menu.help'),
      submenu: [
        {
          label: t('menu.openHelp'),
          accelerator: 'F1',
          click: () => mainWindow?.webContents.send('menu:open-help')
        },
        ...(aiHelpMenuVisible
          ? [
              {
                label: t('menu.openAiHelp'),
                click: () => mainWindow?.webContents.send('menu:open-ai-help')
              } satisfies Electron.MenuItemConstructorOptions
            ]
          : []),
        { type: 'separator' },
        {
          label: t('menu.about'),
          click: () => {
            void dialog.showMessageBox(mainWindow!, {
              type: 'info',
              title: t('menu.about'),
              message: 'Compass',
              detail: t('menu.aboutDetail', { version: packageJson.version }),
              buttons: ['OK']
            })
          }
        }
      ]
    }
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

function setAiHelpMenuVisible(visible: boolean): void {
  if (aiHelpMenuVisible === visible) return
  aiHelpMenuVisible = visible
  createMenu()
}

let lastNewTerminalMenuAt = 0
let lastToggleTerminalAt = 0

/** Ctrl+@ — JIS (@ key) / Ctrl+` — US (Backquote), without Shift */
function isToggleTerminalShortcut(input: Electron.Input): boolean {
  if (input.type !== 'keyDown') return false
  if (!(input.control || input.meta) || input.shift || input.alt) return false
  if (input.isAutoRepeat) return false

  const key = input.key
  const code = input.code
  if (key === '@') return true
  if (code === 'BracketLeft' && key === '@') return true
  if (key === '`' || code === 'Backquote') return true
  return false
}

/** Ctrl+Shift+@ (JIS) / Ctrl+Shift+` (US Backquote) */
function isNewTerminalShortcut(input: Electron.Input): boolean {
  if (input.type !== 'keyDown') return false
  if (!(input.control || input.meta) || !input.shift || input.alt) return false
  if (input.isAutoRepeat) return false

  const key = input.key
  const code = input.code

  // JIS: Shift+@ on BracketLeft produces "`" (shown as Ctrl+Shift+@ in the JA menu)
  if (code === 'BracketLeft' && (key === '`' || key === '@')) return true
  // US: Ctrl+Shift+2 → "@", or Ctrl+Shift+` on Backquote (may report "~")
  if (key === '@') return true
  if (code === 'Backquote') return true
  return false
}

function emitNewTerminalMenu(): void {
  const now = Date.now()
  if (now - lastNewTerminalMenuAt < 200) return
  lastNewTerminalMenuAt = now
  mainWindow?.webContents.send('menu:new-terminal')
}

function emitToggleTerminal(): void {
  const now = Date.now()
  if (now - lastToggleTerminalAt < 200) return
  lastToggleTerminalAt = now
  mainWindow?.webContents.send('menu:toggle-terminal')
}

type EditAction = 'undo' | 'redo' | 'cut' | 'copy' | 'paste' | 'selectAll'
type ViewAction = 'reload' | 'toggleDevTools' | 'resetZoom' | 'zoomIn' | 'zoomOut'

function registerIpcHandlers(): void {
  ipcMain.handle('shell:quit', () => {
    beginQuitFlow()
  })

  ipcMain.handle('app:allow-close', () => {
    resetCloseRequestState()
    isAppQuitting = true
    allowWindowClose = true
    closeMainWindowForQuit()
  })

  ipcMain.handle('app:cancel-close', () => {
    resetCloseRequestState()
    isAppQuitting = false
  })

  ipcMain.handle('dialog:unsavedQuit', async (_event, count: number) => {
    const dirtyCount = typeof count === 'number' && count > 0 ? count : 1
    const options: Electron.MessageBoxOptions = {
      type: 'warning',
      buttons: [t('app.quitSave'), t('app.quitDiscard'), t('app.quitCancel')],
      defaultId: 0,
      cancelId: 2,
      noLink: true,
      title: t('app.quitUnsavedTitle'),
      message: t('app.quitUnsavedMessage', { count: dirtyCount })
    }
    // Parenting to a hidden window can force it on-screen (flash). Use a free-floating dialog.
    const parent =
      mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible() ? mainWindow : undefined
    const { response } = parent
      ? await dialog.showMessageBox(parent, options)
      : await dialog.showMessageBox(options)
    if (response === 0) return 'save' as const
    if (response === 1) return 'discard' as const
    return 'cancel' as const
  })

  ipcMain.handle(
    'dialog:unsavedClose',
    async (_event, count: number, fileName?: string) => {
      if (!mainWindow || mainWindow.isDestroyed()) return 'cancel' as const
      const dirtyCount = typeof count === 'number' && count > 0 ? count : 1
      const named =
        dirtyCount === 1 && typeof fileName === 'string' && fileName.trim().length > 0
      const { response } = await dialog.showMessageBox(mainWindow, {
        type: 'warning',
        buttons: [t('app.closeSave'), t('app.quitDiscard'), t('app.quitCancel')],
        defaultId: 0,
        cancelId: 2,
        noLink: true,
        title: t('app.quitUnsavedTitle'),
        message: named
          ? t('app.closeUnsavedMessageNamed', { name: fileName.trim() })
          : t('app.closeUnsavedMessage', { count: dirtyCount })
      })
      if (response === 0) return 'save' as const
      if (response === 1) return 'discard' as const
      return 'cancel' as const
    }
  )

  ipcMain.handle('shell:edit', (_event, action: EditAction) => {
    const webContents = mainWindow?.webContents
    if (!webContents) return

    switch (action) {
      case 'undo':
        webContents.undo()
        break
      case 'redo':
        webContents.redo()
        break
      case 'cut':
        webContents.cut()
        break
      case 'copy':
        webContents.copy()
        break
      case 'paste':
        webContents.paste()
        break
      case 'selectAll':
        webContents.selectAll()
        break
    }
  })

  ipcMain.handle('shell:view', (_event, action: ViewAction) => {
    const webContents = mainWindow?.webContents
    if (!webContents) return

    switch (action) {
      case 'reload':
        webContents.reload()
        break
      case 'toggleDevTools':
        webContents.toggleDevTools()
        break
      case 'resetZoom':
      case 'zoomIn':
      case 'zoomOut':
        applyViewZoom(webContents, action)
        break
    }
  })

  ipcMain.handle('shell:showAbout', async () => {
    if (!mainWindow) return
    await dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: t('menu.about'),
      message: 'Compass',
      detail: t('menu.aboutDetail', { version: packageJson.version }),
      buttons: ['OK']
    })
  })

  ipcMain.handle('shell:showItemInFolder', (_event, targetPath: string) => {
    if (typeof targetPath !== 'string' || targetPath.trim() === '') {
      throw new Error('Invalid path')
    }
    const safePath = assertActiveWorkspacePath(targetPath.trim())
    shell.showItemInFolder(safePath)
  })

  ipcMain.handle('shell:openPath', async (_event, targetPath: string) => {
    if (typeof targetPath !== 'string' || targetPath.trim() === '') {
      throw new Error('Invalid path')
    }
    const safePath = assertActiveWorkspacePath(targetPath.trim())
    const errorMessage = await shell.openPath(safePath)
    if (errorMessage) {
      throw new Error(errorMessage)
    }
  })

  ipcMain.handle('shell:openExternal', async (_event, url: string) => {
    if (typeof url !== 'string' || !/^https?:\/\//i.test(url.trim())) {
      throw new Error('Invalid URL')
    }
    await shell.openExternal(url.trim())
  })

  ipcMain.handle('help:list', async (_event, locale?: string) => listHelpDocs(locale))

  ipcMain.handle('help:get', async (_event, id: string, locale?: string) => {
    if (typeof id !== 'string' || id.trim() === '') {
      throw new Error('Invalid help path')
    }
    return getHelpDoc(id, locale)
  })

  ipcMain.handle('help:search', async (_event, query: string, locale?: string) => {
    if (typeof query !== 'string') return []
    return searchHelpDocs(query, locale)
  })

  ipcMain.handle('help:ask', async (_event, request: HelpAskRequest) => {
    return askHelp(request)
  })

  ipcMain.handle('help:cancelAsk', () => cancelHelpAsk())

  ipcMain.handle('fs:openFolder', async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      properties: ['openDirectory']
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  ipcMain.handle(
    'fs:readDir',
    async (_event, dirPath: string, options?: { missingOk?: boolean }) => {
      const safePath = assertActiveWorkspacePath(dirPath, { allowRoot: true })
      return readDirectory(safePath, options)
    }
  )

  ipcMain.handle('fs:readFile', async (_event, filePath: string, encoding?: FileEncoding) => {
    const safePath = assertActiveWorkspacePath(filePath)
    return readFileContent(safePath, encoding)
  })

  ipcMain.handle('fs:openEditorFile', async (_event, filePath: string) => {
    const safePath = assertActiveWorkspacePath(filePath)
    return openEditorFile(safePath)
  })

  ipcMain.handle(
    'fs:writeFile',
    async (_event, filePath: string, content: string, encoding?: FileEncoding) => {
      const safePath = assertActiveWorkspacePath(filePath)
      await writeFileContent(safePath, content, encoding ?? 'utf8')
    }
  )

  ipcMain.handle(
    'fs:writeBinaryFile',
    async (_event, filePath: string, base64: string) => {
      const safePath = assertActiveWorkspacePath(filePath)
      await writeBinaryFile(safePath, base64)
    }
  )

  ipcMain.handle('fs:readBinaryFile', async (_event, filePath: string) => {
    const safePath = assertActiveWorkspacePath(filePath)
    return readBinaryFile(safePath)
  })

  ipcMain.handle('fs:createFile', async (_event, parentDir: string, name: string) => {
    const safeParent = assertActiveWorkspacePath(parentDir, { allowRoot: true })
    return createFile(safeParent, name)
  })

  ipcMain.handle('fs:createDirectory', async (_event, parentDir: string, name: string) => {
    const safeParent = assertActiveWorkspacePath(parentDir, { allowRoot: true })
    return createDirectory(safeParent, name)
  })

  ipcMain.handle('fs:rename', async (_event, targetPath: string, newName: string) => {
    const safePath = assertActiveWorkspacePath(targetPath)
    return renamePath(safePath, newName)
  })

  ipcMain.handle('fs:move', async (_event, sourcePath: string, destDir: string) => {
    const safeSource = assertActiveWorkspacePath(sourcePath)
    const safeDest = assertActiveWorkspacePath(destDir, { allowRoot: true })
    return movePath(safeSource, safeDest)
  })

  ipcMain.handle(
    'fs:copy',
    async (_event, sourcePaths: string[], destDir: string) => {
      const safeSources = assertActiveWorkspacePaths(sourcePaths)
      const safeDest = assertActiveWorkspacePath(destDir, { allowRoot: true })
      return copyPathsInto(safeSources, safeDest)
    }
  )

  ipcMain.handle('fs:delete', async (_event, targetPath: string) => {
    const safePath = assertActiveWorkspacePath(targetPath)
    await deletePath(safePath)
  })

  ipcMain.handle('fs:pickFiles', async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      properties: ['openFile', 'multiSelections']
    })
    if (result.canceled || result.filePaths.length === 0) return null
    registerExternalContextPaths(result.filePaths)
    return result.filePaths
  })

  ipcMain.handle(
    'fs:registerExternalContextPaths',
    async (_event, paths: string[]) => {
      if (!Array.isArray(paths)) return
      registerExternalContextPaths(paths.filter((p) => typeof p === 'string'))
    }
  )

  ipcMain.handle(
    'fs:importFiles',
    async (_event, parentDir: string, sourcePaths: string[]) => {
      const safeParent = assertActiveWorkspacePath(parentDir, { allowRoot: true })
      // Sources may be outside the workspace (user-picked import)
      if (Array.isArray(sourcePaths)) {
        registerExternalContextPaths(sourcePaths)
      }
      return importFilesToWorkspace(safeParent, sourcePaths)
    }
  )

  ipcMain.handle(
    'fs:resolveChatContext',
    async (_event, workspaceRoot: string, references: ChatContextRef[]) => {
      const root = bindActiveWorkspaceRoot(workspaceRoot)
      return resolveChatContext(root, references)
    }
  )

  ipcMain.handle(
    'fs:previewActions',
    async (_event, workspaceRoot: string, actions: WorkspaceAction[]) => {
      const root = bindActiveWorkspaceRoot(workspaceRoot)
      return previewWorkspaceActions(root, actions)
    }
  )

  ipcMain.handle(
    'fs:applyActions',
    async (
      _event,
      workspaceRoot: string,
      actions: WorkspaceAction[],
      options?: ApplyWorkspaceOptions
    ) => {
      const root = bindActiveWorkspaceRoot(workspaceRoot)
      return applyWorkspaceActionsRecordingUndo(root, actions, options)
    }
  )

  ipcMain.handle('fs:undoLastAiApply', async (_event, workspaceRoot: string) => {
    const root = bindActiveWorkspaceRoot(workspaceRoot)
    return undoLastChangeSet(root)
  })

  ipcMain.handle(
    'fs:undoAiApply',
    async (_event, workspaceRoot: string, changeSetId: string) => {
      const root = bindActiveWorkspaceRoot(workspaceRoot)
      return undoChangeSet(root, changeSetId)
    }
  )

  ipcMain.handle(
    'fs:undoChatAiApplies',
    async (_event, workspaceRoot: string, chatId: string) => {
      const root = bindActiveWorkspaceRoot(workspaceRoot)
      return undoChatApplies(root, chatId)
    }
  )

  ipcMain.handle('fs:listAiApplies', async (_event, workspaceRoot: string) => {
    const root = bindActiveWorkspaceRoot(workspaceRoot)
    return listChangeSets(root)
  })

  ipcMain.handle(
    'fs:search',
    async (_event, workspaceRoot: string, options: WorkspaceSearchOptions) => {
      const root = bindActiveWorkspaceRoot(workspaceRoot)
      return searchWorkspace(root, options)
    }
  )

  ipcMain.handle(
    'fs:replace',
    async (_event, workspaceRoot: string, options: WorkspaceReplaceOptions) => {
      const root = bindActiveWorkspaceRoot(workspaceRoot)
      return replaceInWorkspace(root, options)
    }
  )

  ipcMain.handle('settings:get', async () => {
    return getPublicSettings()
  })

  ipcMain.handle('settings:set', async (_event, settings: AppSettings) => {
    await setSettings(settings)
    createMenu()
    await refreshTrayAndHotkey()
  })

  ipcMain.handle('desk:ensureDirs', async (_event, workspaceRoot: string) => {
    await ensureDeskDirs(bindActiveWorkspaceRoot(workspaceRoot))
  })

  ipcMain.handle(
    'desk:captureClipboard',
    async (_event, workspaceRoot: string | null) => {
      const root =
        typeof workspaceRoot === 'string' && workspaceRoot.trim()
          ? bindActiveWorkspaceRoot(workspaceRoot)
          : null
      return captureClipboardToInbox(root)
    }
  )

  ipcMain.handle(
    'desk:listInbox',
    async (_event, workspaceRoot: string, limit?: number) => {
      return listDeskInbox(bindActiveWorkspaceRoot(workspaceRoot), limit)
    }
  )

  ipcMain.handle(
    'desk:listOutbox',
    async (_event, workspaceRoot: string, limit?: number, includeArchived?: boolean) => {
      return listDeskOutbox(bindActiveWorkspaceRoot(workspaceRoot), limit, includeArchived)
    }
  )

  ipcMain.handle(
    'desk:markInboxDone',
    async (_event, workspaceRoot: string, absolutePath: string) => {
      return markInboxDone(bindActiveWorkspaceRoot(workspaceRoot), absolutePath)
    }
  )

  ipcMain.handle('desk:markAllInboxDone', async (_event, workspaceRoot: string) => {
    return markAllInboxDone(bindActiveWorkspaceRoot(workspaceRoot))
  })

  ipcMain.handle(
    'desk:deleteInbox',
    async (_event, workspaceRoot: string, absolutePath: string) => {
      return deleteInboxItem(bindActiveWorkspaceRoot(workspaceRoot), absolutePath)
    }
  )

  ipcMain.handle(
    'desk:archiveOutbox',
    async (_event, workspaceRoot: string, absolutePath: string) => {
      return archiveOutboxItem(bindActiveWorkspaceRoot(workspaceRoot), absolutePath)
    }
  )

  ipcMain.handle('desk:archiveAllOutbox', async (_event, workspaceRoot: string) => {
    return archiveAllOutboxItems(bindActiveWorkspaceRoot(workspaceRoot))
  })

  ipcMain.handle(
    'desk:deleteOutbox',
    async (_event, workspaceRoot: string, absolutePath: string) => {
      return deleteOutboxItem(bindActiveWorkspaceRoot(workspaceRoot), absolutePath)
    }
  )

  ipcMain.handle(
    'desk:runShipCheck',
    async (_event, workspaceRoot: string, absolutePath: string) => {
      const root = bindActiveWorkspaceRoot(workspaceRoot)
      const result = await runDeskShipCheck(root, absolutePath)
      return {
        findings: result.findings,
        body: result.body,
        preset: result.preset
      }
    }
  )

  ipcMain.handle(
    'desk:copyOutboxPayload',
    async (_event, workspaceRoot: string, absolutePath: string) => {
      const root = bindActiveWorkspaceRoot(workspaceRoot)
      return copyOutboxPayload(root, absolutePath)
    }
  )

  ipcMain.handle('desk:getCaptureHotkeyStatus', () => {
    return getDeskCaptureHotkeyStatus()
  })

  ipcMain.handle('desk:getShowHotkeyStatus', () => {
    return getDeskShowHotkeyStatus()
  })

  ipcMain.handle('usage:get', async () => {
    return getUsage()
  })

  ipcMain.handle('usage:reset', async () => {
    return resetUsage()
  })

  ipcMain.handle('workspace:getLast', async () => {
    return getLastWorkspaceRoot()
  })

  ipcMain.handle('workspace:getRecent', async () => {
    return getRecentWorkspaceRoots()
  })

  ipcMain.handle('workspace:addRecent', async (_event, workspaceRoot: string) => {
    setActiveWorkspaceRoot(workspaceRoot)
    await addRecentWorkspaceRoot(workspaceRoot)
  })

  ipcMain.handle('workspace:removeRecent', async (_event, workspaceRoot: string) => {
    await removeRecentWorkspaceRoot(workspaceRoot)
  })

  ipcMain.handle('workspace:setLast', async (_event, workspaceRoot: string | null) => {
    setActiveWorkspaceRoot(workspaceRoot)
    await setLastWorkspaceRoot(workspaceRoot)
  })

  ipcMain.handle('workspace:getSettings', async (_event, workspaceRoot: string) => {
    return getWorkspaceSettings(bindActiveWorkspaceRoot(workspaceRoot))
  })

  ipcMain.handle(
    'workspace:setSettings',
    async (_event, workspaceRoot: string, settings: import('../src/types').WorkspaceSettings) => {
      return setWorkspaceSettings(bindActiveWorkspaceRoot(workspaceRoot), settings)
    }
  )

  ipcMain.handle('ai:chat', async (event, request: ChatRequest) => {
    if (request.mode === 'agent') {
      await runAgent(event.sender, request)
      return
    }
    await streamChat(event.sender, request)
  })

  ipcMain.handle('ai:cancel', (_event, chatId?: string) => {
    return cancelChat(typeof chatId === 'string' ? chatId : undefined)
  })

  ipcMain.handle(
    'ai:resolveApproval',
    (
      event,
      request: { id: string; approved: boolean; detail?: string }
    ): boolean => {
      return resolveAgentApprovalForSender(event.sender.id, request)
    }
  )

  ipcMain.handle(
    'ai:resolveContinue',
    (event, request: { id: string; continue: boolean }): boolean => {
      return resolveAgentContinueForSender(event.sender.id, request)
    }
  )

  ipcMain.handle('ai:complete', async (_event, request: InlineCompletionRequest) => {
    return completeInline(request)
  })

  ipcMain.handle('ai:cancelComplete', () => {
    return cancelInlineCompletion()
  })

  ipcMain.handle('ai:testConnection', async () => {
    return testLlmConnection()
  })

  ipcMain.handle('menu:setAiHelpVisible', (_event, visible: boolean) => {
    setAiHelpMenuVisible(Boolean(visible))
  })

  const bindIndexProgress = (sender: Electron.WebContents): void => {
    setIndexProgressEmitter((root, progress) => {
      if (!sender.isDestroyed()) {
        sender.send('index:progress', root, progress)
      }
    })
  }

  ipcMain.handle('index:build', async (event, workspaceRoot: string) => {
    const root = bindActiveWorkspaceRoot(workspaceRoot)
    bindIndexProgress(event.sender)
    event.sender.send('index:status', 'indexing', root)
    try {
      const result = await buildProjectIndex(root)
      event.sender.send('index:updated', result)
      event.sender.send('index:status', 'ready', root)
      return result
    } catch (error) {
      event.sender.send('index:status', 'error', root)
      throw error
    }
  })

  ipcMain.handle('index:ensureFresh', async (event, workspaceRoot: string) => {
    const root = bindActiveWorkspaceRoot(workspaceRoot)
    bindIndexProgress(event.sender)
    const stale = await isProjectIndexStale(root)
    if (stale) {
      event.sender.send('index:status', 'indexing', root)
    }

    try {
      const result = await ensureProjectIndex(root)
      if (result.rebuilt) {
        event.sender.send('index:updated', result)
      }
      event.sender.send('index:status', 'ready', root)
      return result
    } catch (error) {
      event.sender.send('index:status', 'error', root)
      throw error
    }
  })

  ipcMain.handle('index:watch', (event, workspaceRoot: string) => {
    const root = bindActiveWorkspaceRoot(workspaceRoot)
    bindIndexProgress(event.sender)
    startIndexWatcher(root, event.sender)
  })

  ipcMain.handle('index:unwatch', () => {
    stopIndexWatcher()
  })

  ipcMain.handle(
    'index:getContext',
    async (
      _event,
      workspaceRoot: string,
      options?: {
        currentFile?: string
        referencePaths?: string[]
        preset?: UseCasePreset | null
      }
    ) => {
      return getProjectIndexContext(bindActiveWorkspaceRoot(workspaceRoot), options)
    }
  )

  ipcMain.handle('index:getOutline', async (_event, workspaceRoot: string) => {
    return getWorkspaceOutline(bindActiveWorkspaceRoot(workspaceRoot))
  })

  ipcMain.handle('chat:loadHistory', async (_event, workspaceRoot: string) => {
    return loadChatHistory(bindActiveWorkspaceRoot(workspaceRoot))
  })

  ipcMain.handle(
    'chat:saveHistory',
    async (
      _event,
      workspaceRoot: string,
      history: { activeChatId: string | null; sessions: ChatSession[] }
    ) => {
      await saveChatHistory(bindActiveWorkspaceRoot(workspaceRoot), history)
    }
  )

  ipcMain.handle('openEditors:load', async (_event, workspaceRoot: string) => {
    return loadOpenEditors(bindActiveWorkspaceRoot(workspaceRoot))
  })

  ipcMain.handle(
    'openEditors:save',
    async (_event, workspaceRoot: string, editors: WorkspaceOpenEditors) => {
      await saveOpenEditors(bindActiveWorkspaceRoot(workspaceRoot), editors)
    }
  )

  ipcMain.handle('explorerState:load', async (_event, workspaceRoot: string) => {
    return loadExplorerState(bindActiveWorkspaceRoot(workspaceRoot))
  })

  ipcMain.handle(
    'explorerState:save',
    async (_event, workspaceRoot: string, state: WorkspaceExplorerState) => {
      await saveExplorerState(bindActiveWorkspaceRoot(workspaceRoot), state)
    }
  )

  ipcMain.handle('terminal:listShells', () => {
    return listAvailableShells()
  })

  ipcMain.handle(
    'terminal:create',
    (event, id: string, cwd: string, shellId: string | undefined, session: number) => {
      const safeCwd = assertActiveWorkspacePath(cwd, { allowRoot: true })
      return createTerminal(id, safeCwd, shellId, event.sender, session)
    }
  )

  ipcMain.handle('terminal:write', (_event, id: string, data: string) => {
    return writeTerminal(id, data)
  })

  ipcMain.handle('terminal:resize', (_event, id: string, cols: number, rows: number) => {
    resizeTerminal(id, cols, rows)
  })

  ipcMain.handle('terminal:kill', (_event, id: string, session?: number) => {
    killTerminal(id, session)
  })

  ipcMain.handle('terminal:killAll', () => {
    killAllTerminals()
  })

  ipcMain.handle('terminal:setCwd', (_event, cwd: string) => {
    setAllTerminalsCwd(assertActiveWorkspacePath(cwd, { allowRoot: true }))
  })

  ipcMain.handle(
    'git:status',
    async (_event, workspaceRoot: string, options?: { fetch?: boolean }) => {
      return getGitStatus(bindActiveWorkspaceRoot(workspaceRoot), options)
    }
  )

  ipcMain.handle(
    'git:diff',
    async (_event, workspaceRoot: string, path: string, side?: GitDiffSide) => {
      return getGitDiff(bindActiveWorkspaceRoot(workspaceRoot), path, side)
    }
  )

  ipcMain.handle(
    'git:stage',
    async (_event, workspaceRoot: string, paths: string[]) => {
      return stageGitPaths(bindActiveWorkspaceRoot(workspaceRoot), paths)
    }
  )

  ipcMain.handle(
    'git:unstage',
    async (_event, workspaceRoot: string, paths: string[]) => {
      return unstageGitPaths(bindActiveWorkspaceRoot(workspaceRoot), paths)
    }
  )

  ipcMain.handle(
    'git:commit',
    async (
      _event,
      workspaceRoot: string,
      message: string,
      options?: { paths?: string[] }
    ) => {
      return commitGit(bindActiveWorkspaceRoot(workspaceRoot), message, options)
    }
  )

  ipcMain.handle(
    'git:discard',
    async (_event, workspaceRoot: string, paths: string[]) => {
      return discardGitPaths(bindActiveWorkspaceRoot(workspaceRoot), paths)
    }
  )

  ipcMain.handle('git:push', async (_event, workspaceRoot: string) => {
    return pushGit(bindActiveWorkspaceRoot(workspaceRoot))
  })

  ipcMain.handle('git:pull', async (_event, workspaceRoot: string) => {
    return pullGit(bindActiveWorkspaceRoot(workspaceRoot))
  })

  ipcMain.handle('git:branches', async (_event, workspaceRoot: string) => {
    return listGitBranches(bindActiveWorkspaceRoot(workspaceRoot))
  })

  ipcMain.handle(
    'git:checkout',
    async (_event, workspaceRoot: string, branch: string) => {
      return checkoutGitBranch(bindActiveWorkspaceRoot(workspaceRoot), branch)
    }
  )
}

if (gotSingleInstanceLock) {
  app.whenReady().then(async () => {
    await getSettings()
    await syncDeskTrayEnabledFromSettings()
    applyContentSecurityPolicy()
    const lastRoot = await getLastWorkspaceRoot()
    if (lastRoot) setActiveWorkspaceRoot(lastRoot)
    registerIpcHandlers()
    await createWindow()
    createMenu()
    await refreshTrayAndHotkey()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        void createWindow()
        return
      }
      showMainWindowFromTray(() => mainWindow)
    })
  })

  app.on('before-quit', () => {
    isAppQuitting = true
  })

  app.on('window-all-closed', () => {
    stopIndexWatcher()
    killAllTerminals()
    unregisterDeskHotkeys()
    destroyDeskTray()
    if (process.platform !== 'darwin') app.quit()
  })
}
