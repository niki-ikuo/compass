import { create } from 'zustand'
import type {
  OpenFile,
  ChatMessage,
  ChatSession,
  AppSettings,
  FileTreeNode,
  EditorSelection,
  ActionPreviewItem,
  WorkspaceAction,
  ChatContextRef,
  ChatMode,
  ChatSelectionRef,
  FileEncoding,
  LeftSidebarView,
  EditorRevealRequest,
  WorkspaceSearchResult,
  AgentToolStep,
  UseCasePreset
} from '@/types'
import {
  DEFAULT_SETTINGS,
  normalizeAgentSteps,
  normalizeChatMode,
  normalizeUseCasePreset
} from '@/types'
import { getLanguageFromPath } from '@/utils/language'
import { generateId } from '@/utils/code-blocks'
import { loadPanelLayout, savePanelLayout } from '@/utils/panel-layout'
import { createBrowserTabPath, normalizeBrowserUrl } from '@/utils/browser-tab'
import { t, isDefaultChatTitle } from '@/i18n'

function createEmptyChatSession(): ChatSession {
  const now = Date.now()
  return {
    id: generateId(),
    title: t('chat.newChat'),
    messages: [],
    contextRefs: [],
    createdAt: now,
    updatedAt: now,
    isOpen: true
  }
}

function normalizeChatSession(session: ChatSession): ChatSession {
  return {
    ...session,
    isOpen: session.isOpen !== false,
    contextRefs: Array.isArray(session.contextRefs) ? session.contextRefs : [],
    messages: Array.isArray(session.messages)
      ? session.messages.map((message) => {
          const mode = normalizeChatMode(message.mode)
          const preset = normalizeUseCasePreset(message.preset)
          const agentSteps = normalizeAgentSteps(message.agentSteps)
          return {
            ...message,
            mode: mode || undefined,
            preset: preset || undefined,
            ...(agentSteps ? { agentSteps } : {})
          }
        })
      : []
  }
}

function getOpenSessions(sessions: ChatSession[]): ChatSession[] {
  return sessions.filter((session) => session.isOpen)
}

let chatHistorySaveTimer: ReturnType<typeof setTimeout> | null = null

function scheduleChatHistorySave(workspaceRoot: string | null): void {
  if (!workspaceRoot || typeof window === 'undefined' || !window.compass?.chat) return

  if (chatHistorySaveTimer) clearTimeout(chatHistorySaveTimer)
  chatHistorySaveTimer = setTimeout(() => {
    chatHistorySaveTimer = null
    const state = useAppStore.getState()
    if (!state.workspaceRoot) return
    void window.compass.chat.saveHistory(state.workspaceRoot, {
      activeChatId: state.activeChatId,
      sessions: state.chatSessions
    })
  }, 500)
}

export async function flushChatHistorySave(): Promise<void> {
  if (chatHistorySaveTimer) {
    clearTimeout(chatHistorySaveTimer)
    chatHistorySaveTimer = null
  }
  const state = useAppStore.getState()
  if (!state.workspaceRoot || typeof window === 'undefined' || !window.compass?.chat) return
  await window.compass.chat.saveHistory(state.workspaceRoot, {
    activeChatId: state.activeChatId,
    sessions: state.chatSessions
  })
}

function updateActiveSession(
  sessions: ChatSession[],
  activeChatId: string | null,
  updater: (session: ChatSession) => ChatSession
): ChatSession[] {
  if (!activeChatId) return sessions
  return sessions.map((session) =>
    session.id === activeChatId ? updater(session) : session
  )
}

function normalizePath(filePath: string): string {
  return filePath.replace(/\\/g, '/')
}

function getWriteActionsForFile(
  preview: { actions: WorkspaceAction[] },
  relativePath: string
): WorkspaceAction[] {
  const rel = relativePath.replace(/\\/g, '/')
  const actions: WorkspaceAction[] = []

  for (const action of preview.actions) {
    if (action.type === 'mkdir') {
      const dir = action.path.replace(/\\/g, '/')
      if (rel === dir || rel.startsWith(`${dir}/`)) {
        actions.push(action)
      }
    }
  }

  const writeAction = preview.actions.find(
    (action) =>
      (action.type === 'writeFile' || action.type === 'applyPatch') &&
      action.path.replace(/\\/g, '/') === rel
  )
  if (writeAction) actions.push(writeAction)

  return actions
}

function removeFileFromPendingPreview(
  preview: {
    chatId: string
    actions: WorkspaceAction[]
    items: ActionPreviewItem[]
  },
  filePath: string
): typeof preview | null {
  const normalized = normalizePath(filePath)
  const writeItem = preview.items.find(
    (item): item is Extract<ActionPreviewItem, { type: 'writeFile' }> =>
      item.type === 'writeFile' && normalizePath(item.path) === normalized
  )
  if (!writeItem) return preview

  const relativePath = writeItem.relativePath.replace(/\\/g, '/')
  const remainingWritePaths = new Set(
    preview.items
      .filter(
        (item): item is Extract<ActionPreviewItem, { type: 'writeFile' }> =>
          item.type === 'writeFile' && normalizePath(item.path) !== normalized
      )
      .map((item) => item.relativePath.replace(/\\/g, '/'))
  )

  const remainingActions = preview.actions.filter((action) => {
    if (action.type === 'writeFile' || action.type === 'applyPatch') {
      return action.path.replace(/\\/g, '/') !== relativePath
    }
    if (action.type === 'mkdir') {
      const dir = action.path.replace(/\\/g, '/')
      return [...remainingWritePaths].some(
        (path) => path === dir || path.startsWith(`${dir}/`)
      )
    }
    return true
  })

  const remainingMkdirs = new Set(
    remainingActions
      .filter((action): action is Extract<WorkspaceAction, { type: 'mkdir' }> => action.type === 'mkdir')
      .map((action) => action.path.replace(/\\/g, '/'))
  )

  const remainingItems = preview.items.filter((item) => {
    if (item.type === 'writeFile') {
      return normalizePath(item.path) !== normalized
    }
    if (item.type === 'mkdir') {
      return remainingMkdirs.has(item.relativePath.replace(/\\/g, '/'))
    }
    return true
  })

  if (remainingItems.length === 0) return null
  return { ...preview, actions: remainingActions, items: remainingItems }
}

function resolveAgentApprovalIfPreviewCleared(
  getState: () => {
    pendingWorkspacePreview: unknown
    pendingAgentApprovalId: string | null
    agentApprovalTrace: { applied: string[]; rejected: string[] } | null
  },
  setState: (
    partial: Partial<{
      pendingAgentApprovalId: string | null
      agentApprovalTrace: { applied: string[]; rejected: string[] } | null
    }>
  ) => void
): void {
  const state = getState()
  if (state.pendingWorkspacePreview || !state.pendingAgentApprovalId) return

  const id = state.pendingAgentApprovalId
  const applied = state.agentApprovalTrace?.applied ?? []
  const rejected = state.agentApprovalTrace?.rejected ?? []
  setState({ pendingAgentApprovalId: null, agentApprovalTrace: null })

  if (typeof window === 'undefined' || !window.compass?.ai?.resolveApproval) return

  const approved = applied.length > 0
  const detail = approved
    ? [
        'User partially resolved the proposed workspace actions.',
        applied.length > 0 ? `Applied:\n${applied.map((p) => `- ${p}`).join('\n')}` : null,
        rejected.length > 0 ? `Rejected:\n${rejected.map((p) => `- ${p}`).join('\n')}` : null
      ]
        .filter(Boolean)
        .join('\n')
    : 'User rejected the proposed file changes (partial). Remaining items were cleared without apply.'

  void window.compass.ai.resolveApproval({ id, approved, detail })
}

function finalizePreviewFileInOpenFiles(openFiles: OpenFile[], filePath: string): OpenFile[] {
  const normalized = normalizePath(filePath)
  return openFiles.map((file) => {
    if (normalizePath(file.path) !== normalized || !file.isPreview) return file
    return {
      ...file,
      isPreview: false,
      previewOriginal: undefined,
      isNewPreview: false,
      isDirty: false
    }
  })
}

function revertPreviewFileInOpenFiles(
  openFiles: OpenFile[],
  activeFilePath: string | null,
  filePath: string
): { openFiles: OpenFile[]; activeFilePath: string | null } {
  const normalized = normalizePath(filePath)
  const nextOpenFiles: OpenFile[] = []
  let nextActiveFilePath = activeFilePath

  for (const file of openFiles) {
    if (!file.isPreview || normalizePath(file.path) !== normalized) {
      nextOpenFiles.push(file)
      continue
    }

    if (file.isNewPreview) {
      if (nextActiveFilePath && normalizePath(nextActiveFilePath) === normalized) {
        nextActiveFilePath = null
      }
      continue
    }

    nextOpenFiles.push({
      ...file,
      content: file.previewOriginal ?? file.content,
      isPreview: false,
      previewOriginal: undefined,
      isNewPreview: false,
      isDirty: false
    })
  }

  if (
    nextActiveFilePath &&
    !nextOpenFiles.some((file) => normalizePath(file.path) === normalizePath(nextActiveFilePath!))
  ) {
    nextActiveFilePath =
      nextOpenFiles.find((file) => file.isPreview)?.path ??
      nextOpenFiles[nextOpenFiles.length - 1]?.path ??
      null
  }

  return { openFiles: nextOpenFiles, activeFilePath: nextActiveFilePath }
}

interface AppState {
  workspaceRoot: string | null
  /** 開いているワークスペースの用途既定（`.compass/settings.json`）。未設定は null */
  workspaceDefaultUseCasePreset: UseCasePreset | null
  fileTree: FileTreeNode[]
  openFiles: OpenFile[]
  activeFilePath: string | null
  chatSessions: ChatSession[]
  activeChatId: string | null
  isChatLoading: boolean
  settings: AppSettings
  settingsOpen: boolean
  showFileTree: boolean
  showChat: boolean
  showTerminal: boolean
  leftSidebarView: LeftSidebarView
  searchQuery: string
  searchReplace: string
  searchCaseSensitive: boolean
  searchWholeWord: boolean
  searchUseRegex: boolean
  searchInclude: string
  searchExclude: string
  searchRootPath: string | null
  searchResults: WorkspaceSearchResult | null
  searchSearching: boolean
  searchError: string | null
  searchReplaceOpen: boolean
  editorRevealRequest: EditorRevealRequest | null
  editorSelection: EditorSelection | null
  cursorPosition: { line: number; column: number }
  apiConnected: boolean | null
  indexStatus: 'idle' | 'indexing' | 'ready' | 'error'
  indexMeta: { fileCount: number; relationCount: number; indexedAt: string } | null
  pendingWorkspacePreview: {
    chatId: string
    actions: WorkspaceAction[]
    items: ActionPreviewItem[]
  } | null
  /** Agent proposeActions の承認待ち ID（Edit プレビューと共有） */
  pendingAgentApprovalId: string | null
  /** 部分適用/却下のトレース（pending 消化時に resolve へ載せる） */
  agentApprovalTrace: { applied: string[]; rejected: string[] } | null
  /** 直近の適用失敗（プレビューを残してリトライ可能にする） */
  lastApplyError: string | null
  /** エディタなどからチャット入力へメンション挿入するリクエスト */
  chatComposerInsertRequest: {
    id: number
    mentions: string[]
    selection?: ChatSelectionRef
  } | null
  panelLayout: { fileTreeWidthRatio: number; chatWidthRatio: number; terminalHeight: number }

  setWorkspaceRoot: (root: string | null) => void
  setWorkspaceDefaultUseCasePreset: (preset: UseCasePreset | null) => void
  restoreChatSessions: (sessions: ChatSession[], activeChatId: string | null) => void
  closeWorkspace: () => boolean
  setFileTree: (tree: FileTreeNode[]) => void
  openFile: (path: string, content: string, encoding?: FileEncoding) => void
  openMediaFile: (
    path: string,
    viewKind: 'image' | 'pdf',
    mimeType: string,
    base64: string
  ) => void
  openBrowserTab: (url?: string) => void
  updateBrowserTab: (
    path: string,
    patch: { browserUrl?: string; browserTitle?: string }
  ) => void
  closeFile: (path: string) => void
  setActiveFile: (path: string) => void
  updateFileContent: (path: string, content: string) => void
  setFileEncoding: (path: string, encoding: FileEncoding) => void
  reopenFileWithEncoding: (path: string, encoding: FileEncoding) => Promise<void>
  markFileSaved: (path: string) => void
  syncOpenFileContents: (files: Array<{ path: string; content: string }>) => void
  renameOpenFile: (oldPath: string, newPath: string) => void
  removePaths: (targetPath: string) => void
  createChatSession: () => void
  setActiveChatSession: (id: string) => void
  closeChatSession: (id: string) => void
  reopenChatSession: (id: string) => void
  deleteChatSession: (id: string) => void
  addChatMessage: (
    role: 'user' | 'assistant',
    content: string,
    mode?: ChatMode,
    preset?: UseCasePreset
  ) => void
  updateLastAssistantMessage: (content: string, patch?: { agentSteps?: AgentToolStep[] }) => void
  setChatLoading: (loading: boolean) => void
  clearChat: () => void
  setSettings: (settings: AppSettings) => void
  setSettingsOpen: (open: boolean) => void
  setShowFileTree: (show: boolean) => void
  setShowChat: (show: boolean) => void
  setShowTerminal: (show: boolean) => void
  setLeftSidebarView: (view: LeftSidebarView) => void
  openSearchPanel: (options?: { replace?: boolean; rootPath?: string | null }) => void
  setSearchQuery: (query: string) => void
  setSearchReplace: (value: string) => void
  setSearchCaseSensitive: (value: boolean) => void
  setSearchWholeWord: (value: boolean) => void
  setSearchUseRegex: (value: boolean) => void
  setSearchInclude: (value: string) => void
  setSearchExclude: (value: string) => void
  setSearchRootPath: (path: string | null) => void
  setSearchResults: (results: WorkspaceSearchResult | null) => void
  setSearchSearching: (searching: boolean) => void
  setSearchError: (error: string | null) => void
  setSearchReplaceOpen: (open: boolean) => void
  revealInEditor: (path: string, line: number, column: number, endColumn: number) => void
  clearEditorRevealRequest: () => void
  setEditorSelection: (selection: EditorSelection | null) => void
  setCursorPosition: (line: number, column: number) => void
  setApiConnected: (connected: boolean | null) => void
  setIndexStatus: (status: 'idle' | 'indexing' | 'ready' | 'error') => void
  setIndexMeta: (meta: { fileCount: number; relationCount: number; indexedAt: string } | null) => void
  setPendingWorkspacePreview: (
    preview: { actions: WorkspaceAction[]; items: ActionPreviewItem[] } | null
  ) => void
  setPendingAgentApprovalId: (id: string | null) => void
  clearLastApplyError: () => void
  activateWorkspacePreview: (items: ActionPreviewItem[]) => void
  openPreviewFile: (path: string, newContent: string, originalContent: string, isNew: boolean) => void
  revertWorkspacePreview: () => void
  /** Agent 承認待ち中の適用失敗を観測として返し、再提案させる */
  sendApplyFailureToAgent: () => void
  applyWorkspacePreview: () => Promise<void>
  applyPreviewFile: (filePath: string) => Promise<void>
  rejectPreviewFile: (filePath: string) => void
  addChatContextRef: (ref: ChatContextRef) => void
  addChatContextRefs: (refs: ChatContextRef[]) => void
  removeChatContextRef: (path: string) => void
  clearChatContextRefs: () => void
  requestChatComposerInsert: (
    mentionOrMentions: string | string[],
    selection?: ChatSelectionRef
  ) => void
  clearChatComposerInsertRequest: () => void
  setFileTreeWidthRatio: (ratio: number) => void
  setChatPanelWidthRatio: (ratio: number) => void
  setTerminalHeight: (height: number) => void
  getActiveChatSession: () => ChatSession | null
  getActiveFile: () => OpenFile | null
}

const initialChatSession = createEmptyChatSession()

export const useAppStore = create<AppState>((set, get) => ({
  workspaceRoot: null,
  workspaceDefaultUseCasePreset: null,
  fileTree: [],
  openFiles: [],
  activeFilePath: null,
  chatSessions: [initialChatSession],
  activeChatId: initialChatSession.id,
  isChatLoading: false,
  settings: { ...DEFAULT_SETTINGS },
  settingsOpen: false,
  showFileTree: true,
  showChat: true,
  showTerminal: false,
  leftSidebarView: 'explorer',
  searchQuery: '',
  searchReplace: '',
  searchCaseSensitive: false,
  searchWholeWord: false,
  searchUseRegex: false,
  searchInclude: '',
  searchExclude: '',
  searchRootPath: null,
  searchResults: null,
  searchSearching: false,
  searchError: null,
  searchReplaceOpen: false,
  editorRevealRequest: null,
  editorSelection: null,
  cursorPosition: { line: 1, column: 1 },
  apiConnected: null,
  indexStatus: 'idle',
  indexMeta: null,
  pendingWorkspacePreview: null,
  pendingAgentApprovalId: null,
  agentApprovalTrace: null,
  lastApplyError: null,
  chatComposerInsertRequest: null,
  panelLayout: loadPanelLayout(),

  setWorkspaceRoot: (root) =>
    set((state) => ({
      workspaceRoot: root,
      workspaceDefaultUseCasePreset: root ? state.workspaceDefaultUseCasePreset : null,
      chatSessions: state.chatSessions.map((session) => ({ ...session, contextRefs: [] }))
    })),

  setWorkspaceDefaultUseCasePreset: (preset) =>
    set({ workspaceDefaultUseCasePreset: normalizeUseCasePreset(preset) ?? null }),

  restoreChatSessions: (sessions, activeChatId) => {
    const normalized = sessions.map(normalizeChatSession)

    if (normalized.length === 0) {
      const session = createEmptyChatSession()
      set({ chatSessions: [session], activeChatId: session.id })
      return
    }

    let nextSessions = normalized
    let openSessions = getOpenSessions(nextSessions)

    if (openSessions.length === 0) {
      const session = createEmptyChatSession()
      nextSessions = [...nextSessions, session]
      openSessions = [session]
    }

    const validActiveId =
      activeChatId && openSessions.some((s) => s.id === activeChatId)
        ? activeChatId
        : openSessions[openSessions.length - 1].id

    set({ chatSessions: nextSessions, activeChatId: validActiveId })
  },

  closeWorkspace: () => {
    const state = get()
    if (!state.workspaceRoot) return false

    const dirtyFiles = state.openFiles.filter((file) => file.isDirty && !file.isPreview)
    if (dirtyFiles.length > 0) {
      const confirmed = window.confirm(
        t('workspace.closeDirtyConfirm', { count: dirtyFiles.length })
      )
      if (!confirmed) return false
    }

    if (state.pendingWorkspacePreview) {
      get().revertWorkspacePreview()
    }

    const rootToSave = state.workspaceRoot
    const sessionsToSave = state.chatSessions
    const activeChatIdToSave = state.activeChatId
    if (chatHistorySaveTimer) {
      clearTimeout(chatHistorySaveTimer)
      chatHistorySaveTimer = null
    }
    void window.compass.chat.saveHistory(rootToSave, {
      activeChatId: activeChatIdToSave,
      sessions: sessionsToSave
    })

    set({
      workspaceRoot: null,
      workspaceDefaultUseCasePreset: null,
      fileTree: [],
      openFiles: [],
      activeFilePath: null,
      indexStatus: 'idle',
      indexMeta: null,
      editorSelection: null,
      cursorPosition: { line: 1, column: 1 },
      leftSidebarView: 'explorer',
      searchRootPath: null,
      searchResults: null,
      searchSearching: false,
      searchError: null,
      editorRevealRequest: null,
      chatSessions: state.chatSessions.map((session) => ({ ...session, contextRefs: [] }))
    })
    return true
  },

  setFileTree: (tree) => set({ fileTree: tree }),

  openFile: (path, content, encoding = 'utf8') =>
    set((state) => {
      const existing = state.openFiles.find((f) => f.path === path)
      if (existing) {
        return {
          activeFilePath: path,
          openFiles: state.openFiles.map((f) =>
            f.path === path
              ? {
                  ...f,
                  content,
                  encoding,
                  isDirty: false,
                  viewKind: 'text',
                  mediaMimeType: undefined,
                  mediaBase64: undefined
                }
              : f
          )
        }
      }
      const newFile: OpenFile = {
        path,
        content,
        language: getLanguageFromPath(path),
        encoding,
        isDirty: false,
        viewKind: 'text'
      }
      return {
        openFiles: [...state.openFiles, newFile],
        activeFilePath: path
      }
    }),

  openMediaFile: (path, viewKind, mimeType, base64) =>
    set((state) => {
      const existing = state.openFiles.find((f) => f.path === path)
      const mediaFile: OpenFile = {
        path,
        content: '',
        language: viewKind === 'pdf' ? 'pdf' : 'image',
        encoding: 'utf8',
        isDirty: false,
        viewKind,
        mediaMimeType: mimeType,
        mediaBase64: base64
      }
      if (existing) {
        return {
          activeFilePath: path,
          openFiles: state.openFiles.map((f) => (f.path === path ? mediaFile : f))
        }
      }
      return {
        openFiles: [...state.openFiles, mediaFile],
        activeFilePath: path
      }
    }),

  openBrowserTab: (url) =>
    set((state) => {
      const path = createBrowserTabPath()
      const browserUrl = normalizeBrowserUrl(url ?? '')
      const tab: OpenFile = {
        path,
        content: '',
        language: 'browser',
        encoding: 'utf8',
        isDirty: false,
        viewKind: 'browser',
        browserUrl,
        browserTitle: undefined
      }
      return {
        openFiles: [...state.openFiles, tab],
        activeFilePath: path
      }
    }),

  updateBrowserTab: (path, patch) =>
    set((state) => ({
      openFiles: state.openFiles.map((f) =>
        f.path === path && f.viewKind === 'browser' ? { ...f, ...patch } : f
      )
    })),

  closeFile: (path) =>
    set((state) => {
      const filtered = state.openFiles.filter((f) => f.path !== path)
      let activeFilePath = state.activeFilePath
      if (activeFilePath === path) {
        activeFilePath = filtered.length > 0 ? filtered[filtered.length - 1].path : null
      }
      return { openFiles: filtered, activeFilePath }
    }),

  setActiveFile: (path) => set({ activeFilePath: path }),

  updateFileContent: (path, content) =>
    set((state) => ({
      openFiles: state.openFiles.map((f) =>
        f.path === path ? { ...f, content, isDirty: true } : f
      )
    })),

  setFileEncoding: (path, encoding) =>
    set((state) => ({
      openFiles: state.openFiles.map((f) =>
        f.path === path ? { ...f, encoding, isDirty: true } : f
      )
    })),

  reopenFileWithEncoding: async (path, encoding) => {
    const current = get().openFiles.find((f) => f.path === path)
    if (current?.viewKind === 'image' || current?.viewKind === 'pdf') return

    const decoded = await window.compass.fs.readFile(path, encoding)
    set((state) => ({
      openFiles: state.openFiles.map((f) =>
        f.path === path
          ? {
              ...f,
              content: decoded.content,
              encoding: decoded.encoding,
              isDirty: false,
              viewKind: 'text',
              mediaMimeType: undefined,
              mediaBase64: undefined
            }
          : f
      ),
      activeFilePath: path
    }))
  },

  markFileSaved: (path) =>
    set((state) => ({
      openFiles: state.openFiles.map((f) => (f.path === path ? { ...f, isDirty: false } : f))
    })),

  syncOpenFileContents: (files) =>
    set((state) => {
      if (files.length === 0) return state
      const byPath = new Map(
        files.map((file) => [file.path.replace(/\\/g, '/').toLowerCase(), file.content])
      )
      return {
        openFiles: state.openFiles.map((f) => {
          if (f.isPreview) return f
          const content = byPath.get(f.path.replace(/\\/g, '/').toLowerCase())
          if (content === undefined) return f
          return { ...f, content, isDirty: false }
        })
      }
    }),

  renameOpenFile: (oldPath, newPath) =>
    set((state) => {
      const oldNorm = oldPath.replace(/\\/g, '/')
      const newNorm = newPath.replace(/\\/g, '/')

      const remapPath = (path: string): string => {
        const normalized = path.replace(/\\/g, '/')
        if (normalized === oldNorm) return newPath
        if (normalized.startsWith(`${oldNorm}/`)) {
          return newPath + path.slice(oldPath.length)
        }
        return path
      }

      return {
        openFiles: state.openFiles.map((f) => {
          const updatedPath = remapPath(f.path)
          if (updatedPath === f.path) return f
          return { ...f, path: updatedPath, language: getLanguageFromPath(updatedPath) }
        }),
        activeFilePath: state.activeFilePath ? remapPath(state.activeFilePath) : null
      }
    }),

  removePaths: (targetPath) =>
    set((state) => {
      const normalized = targetPath.replace(/\\/g, '/')
      const filtered = state.openFiles.filter((f) => {
        const path = f.path.replace(/\\/g, '/')
        return path !== normalized && !path.startsWith(`${normalized}/`)
      })
      let activeFilePath = state.activeFilePath
      if (activeFilePath) {
        const active = activeFilePath.replace(/\\/g, '/')
        if (active === normalized || active.startsWith(`${normalized}/`)) {
          activeFilePath = filtered.length > 0 ? filtered[filtered.length - 1].path : null
        }
      }
      return { openFiles: filtered, activeFilePath }
    }),

  createChatSession: () => {
    const state = get()
    if (state.pendingWorkspacePreview) {
      get().revertWorkspacePreview()
    }
    const session = createEmptyChatSession()
    set({
      chatSessions: [...state.chatSessions, session],
      activeChatId: session.id
    })
    scheduleChatHistorySave(state.workspaceRoot)
  },

  setActiveChatSession: (id) => {
    const state = get()
    if (
      state.pendingWorkspacePreview &&
      state.pendingWorkspacePreview.chatId !== id
    ) {
      get().revertWorkspacePreview()
    }
    set({ activeChatId: id })
    scheduleChatHistorySave(state.workspaceRoot)
  },

  closeChatSession: (id) => {
    const state = get()
    const target = state.chatSessions.find((s) => s.id === id)
    if (!target || !target.isOpen) return

    if (
      state.pendingWorkspacePreview &&
      state.pendingWorkspacePreview.chatId === id
    ) {
      get().revertWorkspacePreview()
    }

    const isEmptySession =
      target.messages.length === 0 && target.contextRefs.length === 0

    // 空のチャットは履歴に残さず削除。内容があるものは非表示のみ。
    let nextSessions = isEmptySession
      ? state.chatSessions.filter((s) => s.id !== id)
      : state.chatSessions.map((s) =>
          s.id === id ? { ...s, isOpen: false, updatedAt: Date.now() } : s
        )

    let openSessions = getOpenSessions(nextSessions)
    if (openSessions.length === 0) {
      const session = createEmptyChatSession()
      nextSessions = [...nextSessions, session]
      openSessions = [session]
    }

    let activeChatId = state.activeChatId
    if (activeChatId === id || !openSessions.some((s) => s.id === activeChatId)) {
      activeChatId = openSessions[openSessions.length - 1].id
    }

    set({ chatSessions: nextSessions, activeChatId })
    scheduleChatHistorySave(state.workspaceRoot)
  },

  reopenChatSession: (id) => {
    const state = get()
    const target = state.chatSessions.find((s) => s.id === id)
    if (!target) return

    if (
      state.pendingWorkspacePreview &&
      state.pendingWorkspacePreview.chatId !== id
    ) {
      get().revertWorkspacePreview()
    }

    set({
      chatSessions: state.chatSessions.map((s) =>
        s.id === id ? { ...s, isOpen: true } : s
      ),
      activeChatId: id
    })
    scheduleChatHistorySave(state.workspaceRoot)
  },

  deleteChatSession: (id) => {
    const state = get()
    const target = state.chatSessions.find((s) => s.id === id)
    if (!target) return

    if (
      state.pendingWorkspacePreview &&
      state.pendingWorkspacePreview.chatId === id
    ) {
      get().revertWorkspacePreview()
    }

    let nextSessions = state.chatSessions.filter((s) => s.id !== id)
    let openSessions = getOpenSessions(nextSessions)

    if (openSessions.length === 0) {
      const session = createEmptyChatSession()
      nextSessions = [...nextSessions, session]
      openSessions = [session]
    }

    let activeChatId = state.activeChatId
    if (activeChatId === id || !openSessions.some((s) => s.id === activeChatId)) {
      activeChatId = openSessions[openSessions.length - 1].id
    }

    set({ chatSessions: nextSessions, activeChatId })
    scheduleChatHistorySave(state.workspaceRoot)
  },

  addChatMessage: (role, content, mode, preset) => {
    set((state) => ({
      chatSessions: updateActiveSession(state.chatSessions, state.activeChatId, (session) => {
        const messages: ChatMessage[] = [
          ...session.messages,
          {
            id: generateId(),
            role,
            content,
            timestamp: Date.now(),
            ...(role === 'user' && mode ? { mode } : {}),
            ...(role === 'user' && preset ? { preset } : {})
          }
        ]
        let title = session.title
        if (role === 'user' && isDefaultChatTitle(session.title) && content.trim()) {
          const trimmed = content.trim()
          title = trimmed.length > 24 ? `${trimmed.slice(0, 24)}…` : trimmed
        }
        return { ...session, messages, title, updatedAt: Date.now() }
      })
    }))
    scheduleChatHistorySave(get().workspaceRoot)
  },

  updateLastAssistantMessage: (content, patch) => {
    set((state) => ({
      chatSessions: updateActiveSession(state.chatSessions, state.activeChatId, (session) => {
        const messages = [...session.messages]
        const lastIdx = messages.length - 1
        if (lastIdx >= 0 && messages[lastIdx].role === 'assistant') {
          messages[lastIdx] = {
            ...messages[lastIdx],
            content,
            ...(patch?.agentSteps !== undefined ? { agentSteps: patch.agentSteps } : {})
          }
        }
        return { ...session, messages, updatedAt: Date.now() }
      })
    }))
    scheduleChatHistorySave(get().workspaceRoot)
  },

  setChatLoading: (loading) => set({ isChatLoading: loading }),

  clearChat: () => {
    if (get().pendingWorkspacePreview) {
      get().revertWorkspacePreview()
    }
    set((state) => ({
      chatSessions: updateActiveSession(state.chatSessions, state.activeChatId, (session) => ({
        ...session,
        messages: [],
        contextRefs: [],
        title: t('chat.newChat'),
        updatedAt: Date.now()
      }))
    }))
    scheduleChatHistorySave(get().workspaceRoot)
  },

  setSettings: (settings) => set({ settings }),
  setSettingsOpen: (open) => set({ settingsOpen: open }),
  setShowFileTree: (show) => set({ showFileTree: show }),
  setShowChat: (show) => set({ showChat: show }),
  setShowTerminal: (show) => set({ showTerminal: show }),
  setLeftSidebarView: (view) => set({ leftSidebarView: view }),
  openSearchPanel: (options) =>
    set((state) => ({
      showFileTree: true,
      leftSidebarView: 'search',
      searchReplaceOpen: options?.replace ?? state.searchReplaceOpen,
      searchRootPath:
        options && 'rootPath' in options ? (options.rootPath ?? null) : state.searchRootPath
    })),
  setSearchQuery: (query) => set({ searchQuery: query }),
  setSearchReplace: (value) => set({ searchReplace: value }),
  setSearchCaseSensitive: (value) => set({ searchCaseSensitive: value }),
  setSearchWholeWord: (value) => set({ searchWholeWord: value }),
  setSearchUseRegex: (value) => set({ searchUseRegex: value }),
  setSearchInclude: (value) => set({ searchInclude: value }),
  setSearchExclude: (value) => set({ searchExclude: value }),
  setSearchRootPath: (path) => set({ searchRootPath: path }),
  setSearchResults: (results) => set({ searchResults: results }),
  setSearchSearching: (searching) => set({ searchSearching: searching }),
  setSearchError: (error) => set({ searchError: error }),
  setSearchReplaceOpen: (open) => set({ searchReplaceOpen: open }),
  revealInEditor: (path, line, column, endColumn) =>
    set((state) => ({
      editorRevealRequest: {
        id: (state.editorRevealRequest?.id ?? 0) + 1,
        path,
        line,
        column,
        endColumn
      }
    })),
  clearEditorRevealRequest: () => set({ editorRevealRequest: null }),
  setEditorSelection: (selection) => set({ editorSelection: selection }),
  setCursorPosition: (line, column) => set({ cursorPosition: { line, column } }),
  setApiConnected: (connected) => set({ apiConnected: connected }),
  setIndexStatus: (status) => set({ indexStatus: status }),
  setIndexMeta: (meta) => set({ indexMeta: meta }),

  setPendingWorkspacePreview: (preview) => {
    if (!preview) {
      get().revertWorkspacePreview()
      return
    }
    const chatId = get().activeChatId
    if (!chatId) return
    set({
      pendingWorkspacePreview: { chatId, actions: preview.actions, items: preview.items },
      lastApplyError: null
    })
    if (get().settings.autoOpenAgentPreview) {
      get().activateWorkspacePreview(preview.items)
    }
  },

  setPendingAgentApprovalId: (id) =>
    set({
      pendingAgentApprovalId: id,
      agentApprovalTrace: id ? { applied: [], rejected: [] } : null
    }),

  clearLastApplyError: () => set({ lastApplyError: null }),

  openPreviewFile: (path, newContent, originalContent, isNew) =>
    set((state) => {
      const existingEncoding =
        state.openFiles.find((f) => f.path === path)?.encoding ?? ('utf8' as FileEncoding)
      const file: OpenFile = {
        path,
        content: newContent,
        language: getLanguageFromPath(path),
        encoding: existingEncoding,
        isDirty: false,
        isPreview: true,
        previewOriginal: originalContent,
        isNewPreview: isNew
      }
      const existingIdx = state.openFiles.findIndex((f) => f.path === path)
      if (existingIdx >= 0) {
        const openFiles = [...state.openFiles]
        openFiles[existingIdx] = file
        return { openFiles, activeFilePath: path }
      }
      return {
        openFiles: [...state.openFiles, file],
        activeFilePath: path
      }
    }),

  activateWorkspacePreview: (items) => {
    const writeItems = items.filter(
      (i): i is Extract<ActionPreviewItem, { type: 'writeFile' }> => i.type === 'writeFile'
    )
    if (writeItems.length === 0) return

    set((state) => {
      const openFiles = [...state.openFiles]
      for (const item of writeItems) {
        const existingEncoding =
          openFiles.find((f) => f.path === item.path)?.encoding ?? ('utf8' as FileEncoding)
        const file: OpenFile = {
          path: item.path,
          content: item.newContent,
          language: getLanguageFromPath(item.path),
          encoding: existingEncoding,
          isDirty: false,
          isPreview: true,
          previewOriginal: item.oldContent,
          isNewPreview: item.isNew
        }
        const existingIdx = openFiles.findIndex((f) => f.path === item.path)
        if (existingIdx >= 0) openFiles[existingIdx] = file
        else openFiles.push(file)
      }
      return { openFiles, activeFilePath: writeItems[0].path }
    })
  },

  revertWorkspacePreview: () => {
    const approvalId = get().pendingAgentApprovalId
    set((state) => {
      const openFiles: OpenFile[] = []
      let activeFilePath = state.activeFilePath

      for (const file of state.openFiles) {
        if (!file.isPreview) {
          openFiles.push(file)
          continue
        }
        if (file.isNewPreview) {
          if (activeFilePath === file.path) activeFilePath = null
          continue
        }
        openFiles.push({
          ...file,
          content: file.previewOriginal ?? file.content,
          isPreview: false,
          previewOriginal: undefined,
          isNewPreview: false,
          isDirty: false
        })
      }

      if (!activeFilePath && openFiles.length > 0) {
        activeFilePath = openFiles[openFiles.length - 1].path
      }

      return {
        openFiles,
        activeFilePath,
        pendingWorkspacePreview: null,
        pendingAgentApprovalId: null,
        agentApprovalTrace: null,
        lastApplyError: null
      }
    })
    if (approvalId && typeof window !== 'undefined' && window.compass?.ai?.resolveApproval) {
      void window.compass.ai.resolveApproval({
        id: approvalId,
        approved: false,
        detail: 'User rejected the proposed workspace actions'
      })
    }
  },

  sendApplyFailureToAgent: () => {
    const state = get()
    const approvalId = state.pendingAgentApprovalId
    const error = state.lastApplyError
    if (!approvalId || !error || !state.pendingWorkspacePreview) return

    const actionSummary = state.pendingWorkspacePreview.actions
      .map((a) => `- ${a.type}: ${a.path}`)
      .join('\n')

    set((s) => {
      const openFiles: OpenFile[] = []
      let activeFilePath = s.activeFilePath

      for (const file of s.openFiles) {
        if (!file.isPreview) {
          openFiles.push(file)
          continue
        }
        if (file.isNewPreview) {
          if (activeFilePath === file.path) activeFilePath = null
          continue
        }
        openFiles.push({
          ...file,
          content: file.previewOriginal ?? file.content,
          isPreview: false,
          previewOriginal: undefined,
          isNewPreview: false,
          isDirty: false
        })
      }

      if (!activeFilePath && openFiles.length > 0) {
        activeFilePath = openFiles[openFiles.length - 1].path
      }

      return {
        openFiles,
        activeFilePath,
        pendingWorkspacePreview: null,
        pendingAgentApprovalId: null,
        agentApprovalTrace: null,
        lastApplyError: null
      }
    })

    if (typeof window !== 'undefined' && window.compass?.ai?.resolveApproval) {
      void window.compass.ai.resolveApproval({
        id: approvalId,
        approved: false,
        detail: [
          `Apply failed: ${error}`,
          'The proposed actions were NOT applied.',
          'Inspect the failure, then propose a corrected set of actions (prefer applyPatch for existing files).',
          'Proposed actions were:',
          actionSummary
        ].join('\n')
      })
    }
  },

  applyWorkspacePreview: async () => {
    const state = get()
    if (!state.pendingWorkspacePreview || !state.workspaceRoot) return

    const approvalId = state.pendingAgentApprovalId
    const actionCount = state.pendingWorkspacePreview.actions.length
    const actionSummary = state.pendingWorkspacePreview.actions
      .map((a) => `- ${a.type}: ${a.path}`)
      .join('\n')

    const deleteItems = state.pendingWorkspacePreview.items.filter(
      (item): item is Extract<ActionPreviewItem, { type: 'deleteFile' | 'deleteDir' }> =>
        item.type === 'deleteFile' || item.type === 'deleteDir'
    )

    try {
      await window.compass.fs.applyActions(
        state.workspaceRoot,
        state.pendingWorkspacePreview.actions
      )
    } catch (error) {
      // Keep preview + Agent approval pending so the user can retry apply.
      const message = error instanceof Error ? error.message : 'apply failed'
      set({ lastApplyError: message })
      throw error
    }

    set((s) => {
      let openFiles = s.openFiles.map((f) => {
        if (!f.isPreview) return f
        return {
          ...f,
          isPreview: false,
          previewOriginal: undefined,
          isNewPreview: false,
          isDirty: false
        }
      })
      let activeFilePath = s.activeFilePath

      for (const item of deleteItems) {
        const normalized = normalizePath(item.path)
        openFiles = openFiles.filter((f) => {
          const path = normalizePath(f.path)
          return path !== normalized && !path.startsWith(`${normalized}/`)
        })
        if (activeFilePath) {
          const active = normalizePath(activeFilePath)
          if (active === normalized || active.startsWith(`${normalized}/`)) {
            activeFilePath = openFiles.length > 0 ? openFiles[openFiles.length - 1].path : null
          }
        }
      }

      return {
        openFiles,
        activeFilePath,
        pendingWorkspacePreview: null,
        pendingAgentApprovalId: null,
        agentApprovalTrace: null,
        lastApplyError: null
      }
    })

    if (approvalId && typeof window !== 'undefined' && window.compass?.ai?.resolveApproval) {
      void window.compass.ai.resolveApproval({
        id: approvalId,
        approved: true,
        detail: `User approved and applied ${actionCount} workspace action(s):\n${actionSummary}`
      })
    }
  },

  applyPreviewFile: async (filePath) => {
    const state = get()
    if (!state.pendingWorkspacePreview || !state.workspaceRoot) return

    const normalized = normalizePath(filePath)
    const writeItem = state.pendingWorkspacePreview.items.find(
      (item): item is Extract<ActionPreviewItem, { type: 'writeFile' }> =>
        item.type === 'writeFile' && normalizePath(item.path) === normalized
    )
    if (!writeItem) return

    const actionsToApply = getWriteActionsForFile(
      state.pendingWorkspacePreview,
      writeItem.relativePath
    )
    if (actionsToApply.length === 0) return

    try {
      await window.compass.fs.applyActions(state.workspaceRoot, actionsToApply)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'apply failed'
      set({ lastApplyError: message })
      throw error
    }

    const appliedLabel = writeItem.relativePath.replace(/\\/g, '/')
    set((s) => {
      if (!s.pendingWorkspacePreview) return s
      const openFiles = finalizePreviewFileInOpenFiles(s.openFiles, filePath)
      const pendingWorkspacePreview = removeFileFromPendingPreview(
        s.pendingWorkspacePreview,
        filePath
      )
      const trace = s.agentApprovalTrace
        ? {
            applied: [...s.agentApprovalTrace.applied, appliedLabel],
            rejected: s.agentApprovalTrace.rejected
          }
        : s.pendingAgentApprovalId
          ? { applied: [appliedLabel], rejected: [] }
          : null
      return {
        openFiles,
        pendingWorkspacePreview,
        agentApprovalTrace: trace,
        lastApplyError: null
      }
    })
    resolveAgentApprovalIfPreviewCleared(get, set)
  },

  rejectPreviewFile: (filePath) => {
    const state = get()
    if (!state.pendingWorkspacePreview) return

    const writeItem = state.pendingWorkspacePreview.items.find(
      (item): item is Extract<ActionPreviewItem, { type: 'writeFile' }> =>
        item.type === 'writeFile' && normalizePath(item.path) === normalizePath(filePath)
    )
    const rejectedLabel = writeItem?.relativePath.replace(/\\/g, '/') ?? normalizePath(filePath)

    set((s) => {
      if (!s.pendingWorkspacePreview) return s

      const { openFiles, activeFilePath } = revertPreviewFileInOpenFiles(
        s.openFiles,
        s.activeFilePath,
        filePath
      )
      const pendingWorkspacePreview = removeFileFromPendingPreview(
        s.pendingWorkspacePreview,
        filePath
      )
      const trace = s.agentApprovalTrace
        ? {
            applied: s.agentApprovalTrace.applied,
            rejected: [...s.agentApprovalTrace.rejected, rejectedLabel]
          }
        : s.pendingAgentApprovalId
          ? { applied: [], rejected: [rejectedLabel] }
          : null

      return { openFiles, activeFilePath, pendingWorkspacePreview, agentApprovalTrace: trace, lastApplyError: null }
    })
    resolveAgentApprovalIfPreviewCleared(get, set)
  },

  addChatContextRef: (ref) => {
    get().addChatContextRefs([ref])
  },

  addChatContextRefs: (refs) => {
    if (refs.length === 0) return
    set((state) => ({
      chatSessions: updateActiveSession(state.chatSessions, state.activeChatId, (session) => {
        const existing = new Set(
          session.contextRefs.map((r) => r.path.replace(/\\/g, '/'))
        )
        const next = [...session.contextRefs]
        let changed = false
        for (const ref of refs) {
          const normalized = ref.path.replace(/\\/g, '/')
          if (existing.has(normalized)) continue
          existing.add(normalized)
          next.push(ref)
          changed = true
        }
        if (!changed) return session
        return {
          ...session,
          contextRefs: next,
          updatedAt: Date.now()
        }
      })
    }))
    scheduleChatHistorySave(get().workspaceRoot)
  },

  removeChatContextRef: (path) => {
    set((state) => ({
      chatSessions: updateActiveSession(state.chatSessions, state.activeChatId, (session) => {
        const normalized = path.replace(/\\/g, '/')
        return {
          ...session,
          contextRefs: session.contextRefs.filter(
            (r) => r.path.replace(/\\/g, '/') !== normalized
          ),
          updatedAt: Date.now()
        }
      })
    }))
    scheduleChatHistorySave(get().workspaceRoot)
  },

  clearChatContextRefs: () => {
    set((state) => ({
      chatSessions: updateActiveSession(state.chatSessions, state.activeChatId, (session) => ({
        ...session,
        contextRefs: [],
        updatedAt: Date.now()
      }))
    }))
    scheduleChatHistorySave(get().workspaceRoot)
  },

  requestChatComposerInsert: (mentionOrMentions, selection) => {
    const mentions = Array.isArray(mentionOrMentions)
      ? mentionOrMentions.filter((m) => m.length > 0)
      : mentionOrMentions
        ? [mentionOrMentions]
        : []
    if (mentions.length === 0 && !selection) return
    set((state) => ({
      showChat: true,
      chatComposerInsertRequest: {
        id: (state.chatComposerInsertRequest?.id ?? 0) + 1,
        mentions,
        selection
      }
    }))
  },

  clearChatComposerInsertRequest: () => set({ chatComposerInsertRequest: null }),

  setFileTreeWidthRatio: (ratio) =>
    set((state) => {
      const panelLayout = { ...state.panelLayout, fileTreeWidthRatio: ratio }
      savePanelLayout(panelLayout)
      return { panelLayout }
    }),

  setChatPanelWidthRatio: (ratio) =>
    set((state) => {
      const panelLayout = { ...state.panelLayout, chatWidthRatio: ratio }
      savePanelLayout(panelLayout)
      return { panelLayout }
    }),

  setTerminalHeight: (height) =>
    set((state) => {
      const panelLayout = { ...state.panelLayout, terminalHeight: height }
      savePanelLayout(panelLayout)
      return { panelLayout }
    }),

  getActiveChatSession: () => {
    const state = get()
    return state.chatSessions.find((s) => s.id === state.activeChatId) ?? null
  },

  getActiveFile: () => {
    const state = get()
    return state.openFiles.find((f) => f.path === state.activeFilePath) ?? null
  }
}))
