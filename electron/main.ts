import { app, BrowserWindow, ipcMain, dialog, Menu } from 'electron'
import { join } from 'path'
import appIcon from '../resources/icon.ico?asset'
import packageJson from '../package.json'
import { t } from '../src/i18n/runtime'
import type { FileEncoding } from '../src/types'
import {
  applyWorkspaceActions,
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
  writeBinaryFile,
  writeFileContent,
  readBinaryFile
} from './services/filesystem'
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
import {
  getWorkspaceSettings,
  setWorkspaceSettings
} from './services/workspace-settings'
import {
  buildProjectIndex,
  ensureProjectIndex,
  getProjectIndexContext,
  isProjectIndexStale
} from './services/project-indexer'
import { startIndexWatcher, stopIndexWatcher } from './services/index-watcher'
import { loadChatHistory, saveChatHistory } from './services/chat-history'
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
import type {
  AppSettings,
  ChatContextRef,
  ChatRequest,
  ChatSession,
  InlineCompletionRequest,
  WorkspaceAction,
  WorkspaceReplaceOptions,
  WorkspaceSearchOptions
} from '../src/types'

let mainWindow: BrowserWindow | null = null
let currentZoomLevel = 0
let lastWheelZoomAt = 0

const ZOOM_STEP = 0.5
const ZOOM_MIN = -3
const ZOOM_MAX = 5
const WHEEL_ZOOM_INTERVAL_MS = 120

function clampZoomLevel(level: number): number {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, level))
}

function applyViewZoom(
  webContents: Electron.WebContents,
  action: 'resetZoom' | 'zoomIn' | 'zoomOut'
): void {
  switch (action) {
    case 'resetZoom':
      currentZoomLevel = 0
      break
    case 'zoomIn':
      currentZoomLevel = clampZoomLevel(currentZoomLevel + ZOOM_STEP)
      break
    case 'zoomOut':
      currentZoomLevel = clampZoomLevel(currentZoomLevel - ZOOM_STEP)
      break
  }
  webContents.setZoomLevel(currentZoomLevel)
}

function registerWheelZoom(webContents: Electron.WebContents): void {
  webContents.on('zoom-changed', (_event, zoomDirection) => {
    const now = Date.now()
    if (now - lastWheelZoomAt < WHEEL_ZOOM_INTERVAL_MS) return
    lastWheelZoomAt = now
    applyViewZoom(webContents, zoomDirection === 'in' ? 'zoomIn' : 'zoomOut')
  })
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: 'Compass',
    icon: appIcon,
      webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webviewTag: true
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

  registerWheelZoom(mainWindow.webContents)

  mainWindow.on('closed', () => {
    mainWindow = null
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
        { role: 'resetZoom', label: t('menu.resetZoom') },
        { role: 'resetZoom', accelerator: 'CmdOrCtrl+num0', visible: false },
        // Show Ctrl++; also bind Ctrl+= and numpad (default Plus alone often needs Shift on Win/Linux).
        { role: 'zoomIn', label: t('menu.zoomIn'), accelerator: 'CmdOrCtrl+Plus' },
        { role: 'zoomIn', accelerator: 'CmdOrCtrl+=', visible: false },
        { role: 'zoomIn', accelerator: 'CmdOrCtrl+numadd', visible: false },
        { role: 'zoomOut', label: t('menu.zoomOut') },
        { role: 'zoomOut', accelerator: 'CmdOrCtrl+numsub', visible: false },
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

type EditAction = 'undo' | 'redo' | 'cut' | 'copy' | 'paste' | 'selectAll'
type ViewAction = 'reload' | 'toggleDevTools' | 'resetZoom' | 'zoomIn' | 'zoomOut'

function registerIpcHandlers(): void {
  ipcMain.handle('shell:quit', () => {
    app.quit()
  })

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

  ipcMain.handle('fs:openFolder', async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      properties: ['openDirectory']
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  ipcMain.handle('fs:readDir', async (_event, dirPath: string) => {
    return readDirectory(dirPath)
  })

  ipcMain.handle('fs:readFile', async (_event, filePath: string, encoding?: FileEncoding) => {
    return readFileContent(filePath, encoding)
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
    async (_event, workspaceRoot: string, actions: WorkspaceAction[]) => {
      return applyWorkspaceActions(workspaceRoot, actions)
    }
  )

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

  ipcMain.handle('ai:cancel', () => {
    return cancelChat()
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

  ipcMain.handle('index:build', async (event, workspaceRoot: string) => {
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
      options?: { currentFile?: string; referencePaths?: string[] }
    ) => {
      return getProjectIndexContext(workspaceRoot, options)
    }
  )

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
}

app.whenReady().then(async () => {
  await getSettings()
  createWindow()
  createMenu()
  registerIpcHandlers()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  stopIndexWatcher()
  killAllTerminals()
  if (process.platform !== 'darwin') app.quit()
})
