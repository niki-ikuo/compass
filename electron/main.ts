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
  refreshDeskCaptureHotkey,
  unregisterDeskCaptureHotkey
} from './services/desk-hotkey'
import { listDeskInbox, listDeskOutbox } from './services/desk-list'
import { archiveOutboxItem, archiveAllOutboxItems, deleteOutboxItem } from './services/desk-outbox'
import { copyOutboxPayload, runDeskShipCheck } from './services/desk-ship-check'
import { cancelChat, cancelInlineCompletion, completeInline, streamChat } from './services/ai-client'
import { runAgent, resolveAgentApproval, resolveAgentContinue } from './services/agent-runner'
import {
  getSettings,
  setSettings,
  getLastWorkspaceRoot,
  setLastWorkspaceRoot,
  getRecentWorkspaceRoots,
  addRecentWorkspaceRoot,
  removeRecentWorkspaceRoot
} from './services/settings'
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
/** クローズ確認ダイアログ／レンダラ応答の処理中（二重ダイアログ防止） */
let closeRequestInFlight = false
let closeRequestResetTimer: ReturnType<typeof setTimeout> | null = null

// Windows トーストの送信元を electron.app.Electron ではなく Compass にする
if (process.platform === 'win32') {
  app.setAppUserModelId('com.compass.editor')
}

function resetCloseRequestState(): void {
  closeRequestInFlight = false
  if (closeRequestResetTimer) {
    clearTimeout(closeRequestResetTimer)
    closeRequestResetTimer = null
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

/** パッケージ済みビルド向け CSP。開発中は Vite HMR が unsafe-eval を要するため未設定のまま（Electron も警告を許容）。 */
function applyPackagedContentSecurityPolicy(): void {
  if (!app.isPackaged) return

  const csp = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self' http: https:",
    "media-src 'self' blob:",
    "worker-src 'self' blob:",
    "frame-src 'self' http: https:"
  ].join('; ')

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const url = details.url
    // アプリ本体のみ。BrowserViewer 等の外部ページには付けない
    const isAppShell = url.startsWith('file:')
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
      sandbox: false,
      webviewTag: true,
      additionalArguments: [`${COLOR_THEME_ARG_PREFIX}${settings.colorTheme}`]
    }
  })

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show()
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
        { role: 'quit', label: t('menu.quit') }
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
          accelerator: 'CmdOrCtrl+`',
          click: () => mainWindow?.webContents.send('menu:toggle-terminal')
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

type EditAction = 'undo' | 'redo' | 'cut' | 'copy' | 'paste' | 'selectAll'
type ViewAction = 'reload' | 'toggleDevTools' | 'resetZoom' | 'zoomIn' | 'zoomOut'

function registerIpcHandlers(): void {
  ipcMain.handle('shell:quit', () => {
    // app.quit() 直呼びではなく close フロー（未保存確認）を通す
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.close()
      return
    }
    app.quit()
  })

  ipcMain.handle('app:allow-close', () => {
    resetCloseRequestState()
    allowWindowClose = true
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.close()
    }
  })

  ipcMain.handle('app:cancel-close', () => {
    resetCloseRequestState()
  })

  ipcMain.handle('dialog:unsavedQuit', async (_event, count: number) => {
    if (!mainWindow || mainWindow.isDestroyed()) return 'cancel' as const
    const dirtyCount = typeof count === 'number' && count > 0 ? count : 1
    const { response } = await dialog.showMessageBox(mainWindow, {
      type: 'warning',
      buttons: [t('app.quitSave'), t('app.quitDiscard'), t('app.quitCancel')],
      defaultId: 0,
      cancelId: 2,
      noLink: true,
      title: t('app.quitUnsavedTitle'),
      message: t('app.quitUnsavedMessage', { count: dirtyCount })
    })
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
    shell.showItemInFolder(targetPath)
  })

  ipcMain.handle('shell:openPath', async (_event, targetPath: string) => {
    if (typeof targetPath !== 'string' || targetPath.trim() === '') {
      throw new Error('Invalid path')
    }
    const errorMessage = await shell.openPath(targetPath.trim())
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
      return readDirectory(dirPath, options)
    }
  )

  ipcMain.handle('fs:readFile', async (_event, filePath: string, encoding?: FileEncoding) => {
    return readFileContent(filePath, encoding)
  })

  ipcMain.handle('fs:openEditorFile', async (_event, filePath: string) => {
    return openEditorFile(filePath)
  })

  ipcMain.handle(
    'fs:writeFile',
    async (_event, filePath: string, content: string, encoding?: FileEncoding) => {
      await writeFileContent(filePath, content, encoding ?? 'utf8')
    }
  )

  ipcMain.handle(
    'fs:writeBinaryFile',
    async (_event, filePath: string, base64: string) => {
      await writeBinaryFile(filePath, base64)
    }
  )

  ipcMain.handle('fs:readBinaryFile', async (_event, filePath: string) => {
    return readBinaryFile(filePath)
  })

  ipcMain.handle('fs:createFile', async (_event, parentDir: string, name: string) => {
    return createFile(parentDir, name)
  })

  ipcMain.handle('fs:createDirectory', async (_event, parentDir: string, name: string) => {
    return createDirectory(parentDir, name)
  })

  ipcMain.handle('fs:rename', async (_event, targetPath: string, newName: string) => {
    return renamePath(targetPath, newName)
  })

  ipcMain.handle('fs:move', async (_event, sourcePath: string, destDir: string) => {
    return movePath(sourcePath, destDir)
  })

  ipcMain.handle(
    'fs:copy',
    async (_event, sourcePaths: string[], destDir: string) => {
      return copyPathsInto(sourcePaths, destDir)
    }
  )

  ipcMain.handle('fs:delete', async (_event, targetPath: string) => {
    await deletePath(targetPath)
  })

  ipcMain.handle('fs:pickFiles', async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      properties: ['openFile', 'multiSelections']
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths
  })

  ipcMain.handle(
    'fs:importFiles',
    async (_event, parentDir: string, sourcePaths: string[]) => {
      return importFilesToWorkspace(parentDir, sourcePaths)
    }
  )

  ipcMain.handle(
    'fs:resolveChatContext',
    async (_event, workspaceRoot: string, references: ChatContextRef[]) => {
      return resolveChatContext(workspaceRoot, references)
    }
  )

  ipcMain.handle(
    'fs:previewActions',
    async (_event, workspaceRoot: string, actions: WorkspaceAction[]) => {
      return previewWorkspaceActions(workspaceRoot, actions)
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
      return applyWorkspaceActionsRecordingUndo(workspaceRoot, actions, options)
    }
  )

  ipcMain.handle('fs:undoLastAiApply', async (_event, workspaceRoot: string) => {
    return undoLastChangeSet(workspaceRoot)
  })

  ipcMain.handle(
    'fs:undoAiApply',
    async (_event, workspaceRoot: string, changeSetId: string) => {
      return undoChangeSet(workspaceRoot, changeSetId)
    }
  )

  ipcMain.handle(
    'fs:undoChatAiApplies',
    async (_event, workspaceRoot: string, chatId: string) => {
      return undoChatApplies(workspaceRoot, chatId)
    }
  )

  ipcMain.handle('fs:listAiApplies', async (_event, workspaceRoot: string) => {
    return listChangeSets(workspaceRoot)
  })

  ipcMain.handle(
    'fs:search',
    async (_event, workspaceRoot: string, options: WorkspaceSearchOptions) => {
      return searchWorkspace(workspaceRoot, options)
    }
  )

  ipcMain.handle(
    'fs:replace',
    async (_event, workspaceRoot: string, options: WorkspaceReplaceOptions) => {
      return replaceInWorkspace(workspaceRoot, options)
    }
  )

  ipcMain.handle('settings:get', async () => {
    return getSettings()
  })

  ipcMain.handle('settings:set', async (_event, settings: AppSettings) => {
    await setSettings(settings)
    createMenu()
    await refreshDeskCaptureHotkey(() => mainWindow)
  })

  ipcMain.handle('desk:ensureDirs', async (_event, workspaceRoot: string) => {
    await ensureDeskDirs(workspaceRoot)
  })

  ipcMain.handle(
    'desk:captureClipboard',
    async (_event, workspaceRoot: string | null) => {
      return captureClipboardToInbox(workspaceRoot)
    }
  )

  ipcMain.handle(
    'desk:listInbox',
    async (_event, workspaceRoot: string, limit?: number) => {
      return listDeskInbox(workspaceRoot, limit)
    }
  )

  ipcMain.handle(
    'desk:listOutbox',
    async (_event, workspaceRoot: string, limit?: number, includeArchived?: boolean) => {
      return listDeskOutbox(workspaceRoot, limit, includeArchived)
    }
  )

  ipcMain.handle(
    'desk:markInboxDone',
    async (_event, workspaceRoot: string, absolutePath: string) => {
      return markInboxDone(workspaceRoot, absolutePath)
    }
  )

  ipcMain.handle('desk:markAllInboxDone', async (_event, workspaceRoot: string) => {
    return markAllInboxDone(workspaceRoot)
  })

  ipcMain.handle(
    'desk:deleteInbox',
    async (_event, workspaceRoot: string, absolutePath: string) => {
      return deleteInboxItem(workspaceRoot, absolutePath)
    }
  )

  ipcMain.handle(
    'desk:archiveOutbox',
    async (_event, workspaceRoot: string, absolutePath: string) => {
      return archiveOutboxItem(workspaceRoot, absolutePath)
    }
  )

  ipcMain.handle('desk:archiveAllOutbox', async (_event, workspaceRoot: string) => {
    return archiveAllOutboxItems(workspaceRoot)
  })

  ipcMain.handle(
    'desk:deleteOutbox',
    async (_event, workspaceRoot: string, absolutePath: string) => {
      return deleteOutboxItem(workspaceRoot, absolutePath)
    }
  )

  ipcMain.handle('desk:runShipCheck', async (_event, absolutePath: string) => {
    const result = await runDeskShipCheck(absolutePath)
    return {
      findings: result.findings,
      body: result.body,
      preset: result.preset
    }
  })

  ipcMain.handle('desk:copyOutboxPayload', async (_event, absolutePath: string) => {
    return copyOutboxPayload(absolutePath)
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
    await addRecentWorkspaceRoot(workspaceRoot)
  })

  ipcMain.handle('workspace:removeRecent', async (_event, workspaceRoot: string) => {
    await removeRecentWorkspaceRoot(workspaceRoot)
  })

  ipcMain.handle('workspace:setLast', async (_event, workspaceRoot: string | null) => {
    await setLastWorkspaceRoot(workspaceRoot)
  })

  ipcMain.handle('workspace:getSettings', async (_event, workspaceRoot: string) => {
    return getWorkspaceSettings(workspaceRoot)
  })

  ipcMain.handle(
    'workspace:setSettings',
    async (_event, workspaceRoot: string, settings: import('../src/types').WorkspaceSettings) => {
      return setWorkspaceSettings(workspaceRoot, settings)
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
      _event,
      request: { id: string; approved: boolean; detail?: string }
    ): boolean => {
      return resolveAgentApproval(request)
    }
  )

  ipcMain.handle(
    'ai:resolveContinue',
    (_event, request: { id: string; continue: boolean }): boolean => {
      return resolveAgentContinue(request)
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
    bindIndexProgress(event.sender)
    event.sender.send('index:status', 'indexing', workspaceRoot)
    try {
      const result = await buildProjectIndex(workspaceRoot)
      event.sender.send('index:updated', result)
      event.sender.send('index:status', 'ready', workspaceRoot)
      return result
    } catch (error) {
      event.sender.send('index:status', 'error', workspaceRoot)
      throw error
    }
  })

  ipcMain.handle('index:ensureFresh', async (event, workspaceRoot: string) => {
    bindIndexProgress(event.sender)
    const stale = await isProjectIndexStale(workspaceRoot)
    if (stale) {
      event.sender.send('index:status', 'indexing', workspaceRoot)
    }

    try {
      const result = await ensureProjectIndex(workspaceRoot)
      if (result.rebuilt) {
        event.sender.send('index:updated', result)
      }
      event.sender.send('index:status', 'ready', workspaceRoot)
      return result
    } catch (error) {
      event.sender.send('index:status', 'error', workspaceRoot)
      throw error
    }
  })

  ipcMain.handle('index:watch', (event, workspaceRoot: string) => {
    bindIndexProgress(event.sender)
    startIndexWatcher(workspaceRoot, event.sender)
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
      return getProjectIndexContext(workspaceRoot, options)
    }
  )

  ipcMain.handle('index:getOutline', async (_event, workspaceRoot: string) => {
    return getWorkspaceOutline(workspaceRoot)
  })

  ipcMain.handle('chat:loadHistory', async (_event, workspaceRoot: string) => {
    return loadChatHistory(workspaceRoot)
  })

  ipcMain.handle(
    'chat:saveHistory',
    async (
      _event,
      workspaceRoot: string,
      history: { activeChatId: string | null; sessions: ChatSession[] }
    ) => {
      await saveChatHistory(workspaceRoot, history)
    }
  )

  ipcMain.handle('openEditors:load', async (_event, workspaceRoot: string) => {
    return loadOpenEditors(workspaceRoot)
  })

  ipcMain.handle(
    'openEditors:save',
    async (_event, workspaceRoot: string, editors: WorkspaceOpenEditors) => {
      await saveOpenEditors(workspaceRoot, editors)
    }
  )

  ipcMain.handle('explorerState:load', async (_event, workspaceRoot: string) => {
    return loadExplorerState(workspaceRoot)
  })

  ipcMain.handle(
    'explorerState:save',
    async (_event, workspaceRoot: string, state: WorkspaceExplorerState) => {
      await saveExplorerState(workspaceRoot, state)
    }
  )

  ipcMain.handle('terminal:listShells', () => {
    return listAvailableShells()
  })

  ipcMain.handle(
    'terminal:create',
    (event, id: string, cwd: string, shellId: string | undefined, session: number) => {
      return createTerminal(id, cwd, shellId, event.sender, session)
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
    setAllTerminalsCwd(cwd)
  })

  ipcMain.handle(
    'git:status',
    async (_event, workspaceRoot: string, options?: { fetch?: boolean }) => {
      return getGitStatus(workspaceRoot, options)
    }
  )

  ipcMain.handle(
    'git:diff',
    async (_event, workspaceRoot: string, path: string, side?: GitDiffSide) => {
      return getGitDiff(workspaceRoot, path, side)
    }
  )

  ipcMain.handle(
    'git:stage',
    async (_event, workspaceRoot: string, paths: string[]) => {
      return stageGitPaths(workspaceRoot, paths)
    }
  )

  ipcMain.handle(
    'git:unstage',
    async (_event, workspaceRoot: string, paths: string[]) => {
      return unstageGitPaths(workspaceRoot, paths)
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
      return commitGit(workspaceRoot, message, options)
    }
  )

  ipcMain.handle(
    'git:discard',
    async (_event, workspaceRoot: string, paths: string[]) => {
      return discardGitPaths(workspaceRoot, paths)
    }
  )

  ipcMain.handle('git:push', async (_event, workspaceRoot: string) => {
    return pushGit(workspaceRoot)
  })

  ipcMain.handle('git:pull', async (_event, workspaceRoot: string) => {
    return pullGit(workspaceRoot)
  })

  ipcMain.handle('git:branches', async (_event, workspaceRoot: string) => {
    return listGitBranches(workspaceRoot)
  })

  ipcMain.handle(
    'git:checkout',
    async (_event, workspaceRoot: string, branch: string) => {
      return checkoutGitBranch(workspaceRoot, branch)
    }
  )
}

app.whenReady().then(async () => {
  await getSettings()
  applyPackagedContentSecurityPolicy()
  registerIpcHandlers()
  await createWindow()
  createMenu()
  await refreshDeskCaptureHotkey(() => mainWindow)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow()
  })
})

app.on('window-all-closed', () => {
  stopIndexWatcher()
  killAllTerminals()
  unregisterDeskCaptureHotkey()
  if (process.platform !== 'darwin') app.quit()
})
