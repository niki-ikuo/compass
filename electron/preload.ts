import { contextBridge, ipcRenderer } from 'electron'
import type {
  AppSettings,
  ChatContextRef,
  ChatRequest,
  DecodedFileContent,
  FileEncoding,
  FileTreeNode,
  IndexBuildResult,
  EnsureIndexResult,
  ProjectIndexContext,
  ResolvedChatContext,
  ActionPreviewItem,
  WorkspaceAction,
  WorkspaceActionResult,
  WorkspaceSearchOptions,
  WorkspaceSearchResult,
  WorkspaceReplaceOptions,
  WorkspaceReplaceResult,
  ChatSession,
  TerminalShell,
  UseCasePreset,
  InlineCompletionRequest,
  InlineCompletionResult,
  AgentToolStartEvent,
  AgentToolResultEvent,
  AgentStepEvent,
  AgentNeedApprovalEvent,
  AgentResolveApprovalRequest,
  AgentNeedContinueEvent,
  AgentResolveContinueRequest,
  AgentNeedExecApprovalEvent,
  WorkspaceSettings,
  WorkspaceOpenEditors,
  HelpDoc,
  HelpDocMeta,
  HelpSearchHit,
  HelpAskRequest,
  HelpAskResult,
  LlmConnectionTestResult,
  LocaleId
} from '../src/types'

const compassAPI = {
  fs: {
    openFolder: (): Promise<string | null> => ipcRenderer.invoke('fs:openFolder'),
    readDir: (
      dirPath: string,
      options?: { missingOk?: boolean }
    ): Promise<FileTreeNode[]> => ipcRenderer.invoke('fs:readDir', dirPath, options),
    readFile: (filePath: string, encoding?: FileEncoding): Promise<DecodedFileContent> =>
      ipcRenderer.invoke('fs:readFile', filePath, encoding),
    writeFile: (filePath: string, content: string, encoding?: FileEncoding): Promise<void> =>
      ipcRenderer.invoke('fs:writeFile', filePath, content, encoding),
    writeBinaryFile: (filePath: string, base64: string): Promise<void> =>
      ipcRenderer.invoke('fs:writeBinaryFile', filePath, base64),
    readBinaryFile: (filePath: string): Promise<{ base64: string; size: number }> =>
      ipcRenderer.invoke('fs:readBinaryFile', filePath),
    createFile: (parentDir: string, name: string): Promise<string> =>
      ipcRenderer.invoke('fs:createFile', parentDir, name),
    createDirectory: (parentDir: string, name: string): Promise<string> =>
      ipcRenderer.invoke('fs:createDirectory', parentDir, name),
    rename: (targetPath: string, newName: string): Promise<string> =>
      ipcRenderer.invoke('fs:rename', targetPath, newName),
    move: (sourcePath: string, destDir: string): Promise<string> =>
      ipcRenderer.invoke('fs:move', sourcePath, destDir),
    delete: (targetPath: string): Promise<void> => ipcRenderer.invoke('fs:delete', targetPath),
    pickFiles: (): Promise<string[] | null> => ipcRenderer.invoke('fs:pickFiles'),
    importFiles: (parentDir: string, sourcePaths: string[]): Promise<string[]> =>
      ipcRenderer.invoke('fs:importFiles', parentDir, sourcePaths),
    resolveChatContext: (
      workspaceRoot: string,
      references: ChatContextRef[]
    ): Promise<ResolvedChatContext> =>
      ipcRenderer.invoke('fs:resolveChatContext', workspaceRoot, references),
    previewActions: (
      workspaceRoot: string,
      actions: WorkspaceAction[]
    ): Promise<ActionPreviewItem[]> =>
      ipcRenderer.invoke('fs:previewActions', workspaceRoot, actions),
    applyActions: (
      workspaceRoot: string,
      actions: WorkspaceAction[]
    ): Promise<WorkspaceActionResult> =>
      ipcRenderer.invoke('fs:applyActions', workspaceRoot, actions),
    search: (
      workspaceRoot: string,
      options: WorkspaceSearchOptions
    ): Promise<WorkspaceSearchResult> => ipcRenderer.invoke('fs:search', workspaceRoot, options),
    replace: (
      workspaceRoot: string,
      options: WorkspaceReplaceOptions
    ): Promise<WorkspaceReplaceResult> => ipcRenderer.invoke('fs:replace', workspaceRoot, options)
  },
  ai: {
    chat: (request: ChatRequest): Promise<void> => ipcRenderer.invoke('ai:chat', request),
    cancel: (chatId?: string): Promise<boolean> => ipcRenderer.invoke('ai:cancel', chatId),
    complete: (request: InlineCompletionRequest): Promise<InlineCompletionResult> =>
      ipcRenderer.invoke('ai:complete', request),
    cancelComplete: (): Promise<boolean> => ipcRenderer.invoke('ai:cancelComplete'),
    testConnection: (): Promise<LlmConnectionTestResult> =>
      ipcRenderer.invoke('ai:testConnection'),
    onChunk: (callback: (chatId: string, chunk: string) => void): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, chatId: string, chunk: string): void =>
        callback(chatId, chunk)
      ipcRenderer.on('ai:chunk', handler)
      return () => ipcRenderer.removeListener('ai:chunk', handler)
    },
    onDone: (callback: (chatId: string) => void): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, chatId: string): void => callback(chatId)
      ipcRenderer.on('ai:done', handler)
      return () => ipcRenderer.removeListener('ai:done', handler)
    },
    onAborted: (callback: (chatId: string) => void): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, chatId: string): void => callback(chatId)
      ipcRenderer.on('ai:aborted', handler)
      return () => ipcRenderer.removeListener('ai:aborted', handler)
    },
    onError: (callback: (chatId: string, error: string) => void): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, chatId: string, error: string): void =>
        callback(chatId, error)
      ipcRenderer.on('ai:error', handler)
      return () => ipcRenderer.removeListener('ai:error', handler)
    },
    onToolStart: (
      callback: (chatId: string, event: AgentToolStartEvent) => void
    ): (() => void) => {
      const handler = (
        _event: Electron.IpcRendererEvent,
        chatId: string,
        payload: AgentToolStartEvent
      ): void => callback(chatId, payload)
      ipcRenderer.on('ai:toolStart', handler)
      return () => ipcRenderer.removeListener('ai:toolStart', handler)
    },
    onToolResult: (
      callback: (chatId: string, event: AgentToolResultEvent) => void
    ): (() => void) => {
      const handler = (
        _event: Electron.IpcRendererEvent,
        chatId: string,
        payload: AgentToolResultEvent
      ): void => callback(chatId, payload)
      ipcRenderer.on('ai:toolResult', handler)
      return () => ipcRenderer.removeListener('ai:toolResult', handler)
    },
    onStep: (callback: (chatId: string, event: AgentStepEvent) => void): (() => void) => {
      const handler = (
        _event: Electron.IpcRendererEvent,
        chatId: string,
        payload: AgentStepEvent
      ): void => callback(chatId, payload)
      ipcRenderer.on('ai:step', handler)
      return () => ipcRenderer.removeListener('ai:step', handler)
    },
    onNeedApproval: (
      callback: (chatId: string, event: AgentNeedApprovalEvent) => void
    ): (() => void) => {
      const handler = (
        _event: Electron.IpcRendererEvent,
        chatId: string,
        payload: AgentNeedApprovalEvent
      ): void => callback(chatId, payload)
      ipcRenderer.on('ai:needApproval', handler)
      return () => ipcRenderer.removeListener('ai:needApproval', handler)
    },
    resolveApproval: (request: AgentResolveApprovalRequest): Promise<boolean> =>
      ipcRenderer.invoke('ai:resolveApproval', request),
    onNeedExecApproval: (
      callback: (chatId: string, event: AgentNeedExecApprovalEvent) => void
    ): (() => void) => {
      const handler = (
        _event: Electron.IpcRendererEvent,
        chatId: string,
        payload: AgentNeedExecApprovalEvent
      ): void => callback(chatId, payload)
      ipcRenderer.on('ai:needExecApproval', handler)
      return () => ipcRenderer.removeListener('ai:needExecApproval', handler)
    },
    onNeedContinue: (
      callback: (chatId: string, event: AgentNeedContinueEvent) => void
    ): (() => void) => {
      const handler = (
        _event: Electron.IpcRendererEvent,
        chatId: string,
        payload: AgentNeedContinueEvent
      ): void => callback(chatId, payload)
      ipcRenderer.on('ai:needContinue', handler)
      return () => ipcRenderer.removeListener('ai:needContinue', handler)
    },
    resolveContinue: (request: AgentResolveContinueRequest): Promise<boolean> =>
      ipcRenderer.invoke('ai:resolveContinue', request)
  },
  settings: {
    get: (): Promise<AppSettings> => ipcRenderer.invoke('settings:get'),
    set: (settings: AppSettings): Promise<void> => ipcRenderer.invoke('settings:set', settings)
  },
  workspace: {
    getLast: (): Promise<string | null> => ipcRenderer.invoke('workspace:getLast'),
    getRecent: (): Promise<string[]> => ipcRenderer.invoke('workspace:getRecent'),
    addRecent: (workspaceRoot: string): Promise<void> =>
      ipcRenderer.invoke('workspace:addRecent', workspaceRoot),
    removeRecent: (workspaceRoot: string): Promise<void> =>
      ipcRenderer.invoke('workspace:removeRecent', workspaceRoot),
    setLast: (workspaceRoot: string | null): Promise<void> =>
      ipcRenderer.invoke('workspace:setLast', workspaceRoot),
    getSettings: (workspaceRoot: string): Promise<WorkspaceSettings> =>
      ipcRenderer.invoke('workspace:getSettings', workspaceRoot),
    setSettings: (
      workspaceRoot: string,
      settings: WorkspaceSettings
    ): Promise<WorkspaceSettings> =>
      ipcRenderer.invoke('workspace:setSettings', workspaceRoot, settings)
  },
  shell: {
    quit: (): Promise<void> => ipcRenderer.invoke('shell:quit'),
    edit: (
      action: 'undo' | 'redo' | 'cut' | 'copy' | 'paste' | 'selectAll'
    ): Promise<void> => ipcRenderer.invoke('shell:edit', action),
    view: (
      action: 'reload' | 'toggleDevTools' | 'resetZoom' | 'zoomIn' | 'zoomOut'
    ): Promise<void> => ipcRenderer.invoke('shell:view', action),
    showAbout: (): Promise<void> => ipcRenderer.invoke('shell:showAbout'),
    showItemInFolder: (targetPath: string): Promise<void> =>
      ipcRenderer.invoke('shell:showItemInFolder', targetPath),
    openExternal: (url: string): Promise<void> => ipcRenderer.invoke('shell:openExternal', url)
  },
  help: {
    list: (locale: LocaleId): Promise<HelpDocMeta[]> => ipcRenderer.invoke('help:list', locale),
    get: (id: string, locale: LocaleId): Promise<HelpDoc> =>
      ipcRenderer.invoke('help:get', id, locale),
    search: (query: string, locale: LocaleId): Promise<HelpSearchHit[]> =>
      ipcRenderer.invoke('help:search', query, locale),
    ask: (request: HelpAskRequest): Promise<HelpAskResult> => ipcRenderer.invoke('help:ask', request),
    cancelAsk: (): Promise<boolean> => ipcRenderer.invoke('help:cancelAsk')
  },
  menu: {
    onOpenFolder: (callback: () => void): (() => void) => {
      const handler = (): void => callback()
      ipcRenderer.on('menu:open-folder', handler)
      return () => ipcRenderer.removeListener('menu:open-folder', handler)
    },
    onCloseFolder: (callback: () => void): (() => void) => {
      const handler = (): void => callback()
      ipcRenderer.on('menu:close-folder', handler)
      return () => ipcRenderer.removeListener('menu:close-folder', handler)
    },
    onSave: (callback: () => void): (() => void) => {
      const handler = (): void => callback()
      ipcRenderer.on('menu:save', handler)
      return () => ipcRenderer.removeListener('menu:save', handler)
    },
    onSettings: (callback: () => void): (() => void) => {
      const handler = (): void => callback()
      ipcRenderer.on('menu:settings', handler)
      return () => ipcRenderer.removeListener('menu:settings', handler)
    },
    onToggleTerminal: (callback: () => void): (() => void) => {
      const handler = (): void => callback()
      ipcRenderer.on('menu:toggle-terminal', handler)
      return () => ipcRenderer.removeListener('menu:toggle-terminal', handler)
    },
    onFindInFile: (callback: () => void): (() => void) => {
      const handler = (): void => callback()
      ipcRenderer.on('menu:find-in-file', handler)
      return () => ipcRenderer.removeListener('menu:find-in-file', handler)
    },
    onReplaceInFile: (callback: () => void): (() => void) => {
      const handler = (): void => callback()
      ipcRenderer.on('menu:replace-in-file', handler)
      return () => ipcRenderer.removeListener('menu:replace-in-file', handler)
    },
    onFindInFiles: (callback: () => void): (() => void) => {
      const handler = (): void => callback()
      ipcRenderer.on('menu:find-in-files', handler)
      return () => ipcRenderer.removeListener('menu:find-in-files', handler)
    },
    onReplaceInFiles: (callback: () => void): (() => void) => {
      const handler = (): void => callback()
      ipcRenderer.on('menu:replace-in-files', handler)
      return () => ipcRenderer.removeListener('menu:replace-in-files', handler)
    },
    onOpenHelp: (callback: () => void): (() => void) => {
      const handler = (): void => callback()
      ipcRenderer.on('menu:open-help', handler)
      return () => ipcRenderer.removeListener('menu:open-help', handler)
    },
    onOpenAiHelp: (callback: () => void): (() => void) => {
      const handler = (): void => callback()
      ipcRenderer.on('menu:open-ai-help', handler)
      return () => ipcRenderer.removeListener('menu:open-ai-help', handler)
    },
    setAiHelpVisible: (visible: boolean): Promise<void> =>
      ipcRenderer.invoke('menu:setAiHelpVisible', visible)
  },
  index: {
    build: (workspaceRoot: string): Promise<IndexBuildResult> =>
      ipcRenderer.invoke('index:build', workspaceRoot),
    ensureFresh: (workspaceRoot: string): Promise<EnsureIndexResult> =>
      ipcRenderer.invoke('index:ensureFresh', workspaceRoot),
    watch: (workspaceRoot: string): Promise<void> =>
      ipcRenderer.invoke('index:watch', workspaceRoot),
    unwatch: (): Promise<void> => ipcRenderer.invoke('index:unwatch'),
    getContext: (
      workspaceRoot: string,
      options?: {
        currentFile?: string
        referencePaths?: string[]
        preset?: UseCasePreset | null
      }
    ): Promise<ProjectIndexContext | null> =>
      ipcRenderer.invoke('index:getContext', workspaceRoot, options),
    onUpdated: (callback: (result: IndexBuildResult) => void): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, result: IndexBuildResult): void =>
        callback(result)
      ipcRenderer.on('index:updated', handler)
      return () => ipcRenderer.removeListener('index:updated', handler)
    },
    onStatus: (
      callback: (status: 'indexing' | 'ready' | 'error', workspaceRoot: string) => void
    ): (() => void) => {
      const handler = (
        _event: Electron.IpcRendererEvent,
        status: 'indexing' | 'ready' | 'error',
        workspaceRoot: string
      ): void => callback(status, workspaceRoot)
      ipcRenderer.on('index:status', handler)
      return () => ipcRenderer.removeListener('index:status', handler)
    }
  },
  chat: {
    loadHistory: (
      workspaceRoot: string
    ): Promise<{ activeChatId: string | null; sessions: ChatSession[] }> =>
      ipcRenderer.invoke('chat:loadHistory', workspaceRoot),
    saveHistory: (
      workspaceRoot: string,
      history: { activeChatId: string | null; sessions: ChatSession[] }
    ): Promise<void> => ipcRenderer.invoke('chat:saveHistory', workspaceRoot, history)
  },
  openEditors: {
    load: (workspaceRoot: string): Promise<WorkspaceOpenEditors> =>
      ipcRenderer.invoke('openEditors:load', workspaceRoot),
    save: (workspaceRoot: string, editors: WorkspaceOpenEditors): Promise<void> =>
      ipcRenderer.invoke('openEditors:save', workspaceRoot, editors)
  },
  terminal: (() => {
    type DataCallback = (id: string, data: string) => void
    type ExitCallback = (id: string, exitCode: number) => void

    const dataSubscribers = new Set<DataCallback>()
    const exitSubscribers = new Set<ExitCallback>()

    const DATA_CHANNEL = 'terminal:data'
    const EXIT_CHANNEL = 'terminal:exit'

    // Renderer reload / dev HMR re-runs preload while ipcRenderer keeps prior handlers.
    ipcRenderer.removeAllListeners(DATA_CHANNEL)
    ipcRenderer.on(DATA_CHANNEL, (_event, id: string, data: string) => {
      for (const callback of dataSubscribers) {
        callback(id, data)
      }
    })

    ipcRenderer.removeAllListeners(EXIT_CHANNEL)
    ipcRenderer.on(EXIT_CHANNEL, (_event, id: string, exitCode: number) => {
      for (const callback of exitSubscribers) {
        callback(id, exitCode)
      }
    })

    return {
      listShells: (): Promise<TerminalShell[]> => ipcRenderer.invoke('terminal:listShells'),
      create: (
        id: string,
        cwd: string,
        shellId: string | undefined,
        session?: number
      ): Promise<{ ok: true; shellId: string; replay: string } | { ok: false; error: string }> =>
        ipcRenderer.invoke('terminal:create', id, cwd, shellId, session),
      write: (id: string, data: string): Promise<boolean> =>
        ipcRenderer.invoke('terminal:write', id, data),
      resize: (id: string, cols: number, rows: number): Promise<void> =>
        ipcRenderer.invoke('terminal:resize', id, cols, rows),
      kill: (id: string, session?: number): Promise<void> =>
        ipcRenderer.invoke('terminal:kill', id, session),
      killAll: (): Promise<void> => ipcRenderer.invoke('terminal:killAll'),
      setCwd: (cwd: string): Promise<void> => ipcRenderer.invoke('terminal:setCwd', cwd),
      onData: (callback: DataCallback): (() => void) => {
        dataSubscribers.add(callback)
        return () => {
          dataSubscribers.delete(callback)
        }
      },
      onExit: (callback: ExitCallback): (() => void) => {
        exitSubscribers.add(callback)
        return () => {
          exitSubscribers.delete(callback)
        }
      }
    }
  })()
}

contextBridge.exposeInMainWorld('compass', compassAPI)
