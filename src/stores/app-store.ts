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
  WorkspaceChangeSet,
  WorkspaceChangeSetSummary,
  ChatContextRef,
  ChatMode,
  ChatSelectionRef,
  FileEncoding,
  LeftSidebarView,
  EditorRevealRequest,
  WorkspaceSearchResult,
  AgentToolStep,
  UseCasePreset,
  PersistedOpenTab,
  WorkspaceOpenEditors,
  WorkspaceExplorerState,
  LlmConnectionState
} from '@/types'
import {
  DEFAULT_SETTINGS,
  normalizeAgentSteps,
  normalizeChatMode,
  normalizeUseCasePreset
} from '@/types'
import { getLanguageFromPath } from '@/utils/language'
import { generateId } from '@/utils/code-blocks'
import {
  buildUndidApplyNote,
  toChatAppliedChangeSet
} from '@/utils/ai-apply-undo'
import {
  loadPanelLayout,
  savePanelLayout,
  toPersistedPanelLayout
} from '@/utils/panel-layout'
import { createBrowserTabPath, normalizeBrowserUrl } from '@/utils/browser-tab'
import { SETTINGS_TAB_PATH } from '@/utils/settings-tab'
import { moveItemByDropIndex, reorderOpenSessionsById } from '@/utils/tab-reorder'
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
          const model =
            typeof message.model === 'string' && message.model.trim()
              ? message.model.trim()
              : undefined
          const agentSteps = normalizeAgentSteps(message.agentSteps)
          return {
            ...message,
            mode: mode || undefined,
            preset: preset || undefined,
            model,
            ...(agentSteps ? { agentSteps } : {})
          }
        })
      : []
  }
}

function getOpenSessions(sessions: ChatSession[]): ChatSession[] {
  return sessions.filter((session) => session.isOpen)
}

/** 開いているチャットが無いときに空セッションを1つ用意する（パネル再表示時） */
function ensureOpenChatSession(sessions: ChatSession[]): {
  sessions: ChatSession[]
  activeChatId: string
} {
  const openSessions = getOpenSessions(sessions)
  if (openSessions.length > 0) {
    return {
      sessions,
      activeChatId: openSessions[openSessions.length - 1].id
    }
  }
  const session = createEmptyChatSession()
  return {
    sessions: [...sessions, session],
    activeChatId: session.id
  }
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

let openEditorsSaveTimer: ReturnType<typeof setTimeout> | null = null
let openEditorsSaveSuspended = false

function toPersistedOpenEditors(state: {
  openFiles: OpenFile[]
  activeFilePath: string | null
}): WorkspaceOpenEditors {
  const openTabs: PersistedOpenTab[] = []
  for (const file of state.openFiles) {
    if (file.isPreview || file.isTransient || file.viewKind === 'settings') continue
    if (file.viewKind === 'browser') {
      openTabs.push({
        path: file.path,
        viewKind: 'browser',
        browserUrl: file.browserUrl ?? 'about:blank'
      })
      continue
    }
    if (file.viewKind === 'image' || file.viewKind === 'pdf') {
      openTabs.push({ path: file.path, viewKind: file.viewKind })
      continue
    }
    openTabs.push({ path: file.path, viewKind: 'text' })
  }

  let activeFilePath = state.activeFilePath
  if (activeFilePath && !openTabs.some((tab) => tab.path === activeFilePath)) {
    activeFilePath = openTabs[openTabs.length - 1]?.path ?? null
  }

  return { version: 1, activeFilePath, openTabs }
}

function scheduleOpenEditorsSave(workspaceRoot: string | null): void {
  if (
    openEditorsSaveSuspended ||
    !workspaceRoot ||
    typeof window === 'undefined' ||
    !window.compass?.openEditors
  ) {
    return
  }

  if (openEditorsSaveTimer) clearTimeout(openEditorsSaveTimer)
  openEditorsSaveTimer = setTimeout(() => {
    openEditorsSaveTimer = null
    const state = useAppStore.getState()
    if (!state.workspaceRoot || openEditorsSaveSuspended) return
    void window.compass.openEditors.save(
      state.workspaceRoot,
      toPersistedOpenEditors(state)
    )
  }, 500)
}

export async function flushOpenEditorsSave(): Promise<void> {
  if (openEditorsSaveTimer) {
    clearTimeout(openEditorsSaveTimer)
    openEditorsSaveTimer = null
  }
  const state = useAppStore.getState()
  if (
    !state.workspaceRoot ||
    typeof window === 'undefined' ||
    !window.compass?.openEditors
  ) {
    return
  }
  await window.compass.openEditors.save(state.workspaceRoot, toPersistedOpenEditors(state))
}

export async function withOpenEditorsSaveSuspended<T>(fn: () => Promise<T>): Promise<T> {
  openEditorsSaveSuspended = true
  if (openEditorsSaveTimer) {
    clearTimeout(openEditorsSaveTimer)
    openEditorsSaveTimer = null
  }
  try {
    return await fn()
  } finally {
    openEditorsSaveSuspended = false
  }
}

function updateActiveSession(
  sessions: ChatSession[],
  activeChatId: string | null,
  updater: (session: ChatSession) => ChatSession
): ChatSession[] {
  if (!activeChatId) return sessions
  return updateSessionById(sessions, activeChatId, updater)
}

function updateSessionById(
  sessions: ChatSession[],
  chatId: string | null | undefined,
  updater: (session: ChatSession) => ChatSession
): ChatSession[] {
  if (!chatId) return sessions
  return sessions.map((session) => (session.id === chatId ? updater(session) : session))
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

function finalizePreviewFileInOpenFiles(
  openFiles: OpenFile[],
  filePath: string,
  newContent?: string
): OpenFile[] {
  const normalized = normalizePath(filePath)
  return openFiles.map((file) => {
    if (normalizePath(file.path) !== normalized) return file
    // Preview tabs already hold newContent; non-preview open tabs stay stale unless synced.
    if (!file.isPreview && newContent === undefined) return file
    return {
      ...file,
      content: newContent !== undefined ? newContent : file.content,
      isPreview: false,
      previewOriginal: undefined,
      isNewPreview: false,
      isDirty: false
    }
  })
}

function appliedWriteContentByPath(
  items: ActionPreviewItem[]
): Map<string, string> {
  const byPath = new Map<string, string>()
  for (const item of items) {
    if (item.type !== 'writeFile') continue
    byPath.set(normalizePath(item.path).toLowerCase(), item.newContent)
  }
  return byPath
}

function bannerFromChangeSet(changeSet: WorkspaceChangeSet): {
  changeSetId: string
  chatId: string
  entryCount: number
  createdAt: number
} {
  return {
    changeSetId: changeSet.id,
    chatId: changeSet.chatId,
    entryCount: changeSet.entries.length,
    createdAt: changeSet.createdAt
  }
}

function attachAppliedChangeSetToSessions(
  sessions: ChatSession[],
  chatId: string,
  changeSet: WorkspaceChangeSet
): ChatSession[] {
  const record = toChatAppliedChangeSet(changeSet)
  return updateSessionById(sessions, chatId, (session) => {
    const messages = [...session.messages]
    const lastIdx = messages.length - 1
    const last = lastIdx >= 0 ? messages[lastIdx] : null
    if (last?.role === 'assistant') {
      const existing = last.appliedChangeSets ?? []
      messages[lastIdx] = {
        ...last,
        appliedChangeSets: [...existing, record]
      }
      return { ...session, messages, updatedAt: Date.now() }
    }
    messages.push({
      id: generateId(),
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      appliedChangeSets: [record]
    })
    return { ...session, messages, updatedAt: Date.now() }
  })
}

function markAppliedChangeSetUndoneInSessions(
  sessions: ChatSession[],
  changeSetId: string
): ChatSession[] {
  return sessions.map((session) => {
    let changed = false
    const messages = session.messages.map((message) => {
      if (!message.appliedChangeSets?.some((item) => item.id === changeSetId)) {
        return message
      }
      changed = true
      return {
        ...message,
        appliedChangeSets: message.appliedChangeSets.map((item) =>
          item.id === changeSetId ? { ...item, status: 'undone' as const } : item
        )
      }
    })
    return changed ? { ...session, messages, updatedAt: Date.now() } : session
  })
}

function appendUndoNoteToSessions(
  sessions: ChatSession[],
  changeSet: WorkspaceChangeSet,
  agentRunning: boolean
): ChatSession[] {
  const note = buildUndidApplyNote(changeSet, { agentRunning })
  return updateSessionById(sessions, changeSet.chatId, (session) => {
    const messages = [...session.messages]
    const lastIdx = messages.length - 1
    const last = lastIdx >= 0 ? messages[lastIdx] : null
    if (last?.role === 'assistant') {
      messages[lastIdx] = {
        ...last,
        content: last.content ? `${last.content}\n\n${note}` : note
      }
    } else {
      messages.push({
        id: generateId(),
        role: 'assistant',
        content: note,
        timestamp: Date.now()
      })
    }
    return { ...session, messages, updatedAt: Date.now() }
  })
}

function applyUndoSuccessToStore(
  get: () => {
    workspaceRoot: string | null
    openFiles: OpenFile[]
    activeFilePath: string | null
    chatSessions: ChatSession[]
    loadingChatIds: string[]
    lastAiApplyUndo: {
      changeSetId: string
      chatId: string
      entryCount: number
      createdAt: number
    } | null
    refreshAiApplyHistory: () => Promise<void>
  },
  set: (partial: Record<string, unknown>) => void,
  changeSet: WorkspaceChangeSet
): void {
  const state = get()
  if (!state.workspaceRoot) return

  const synced = syncOpenFilesAfterUndo(
    state.openFiles,
    state.activeFilePath,
    state.workspaceRoot,
    changeSet
  )
  const agentRunning = state.loadingChatIds.includes(changeSet.chatId)
  let sessions = markAppliedChangeSetUndoneInSessions(state.chatSessions, changeSet.id)
  sessions = appendUndoNoteToSessions(sessions, changeSet, agentRunning)

  set({
    openFiles: synced.openFiles,
    activeFilePath: synced.activeFilePath,
    chatSessions: sessions,
    lastAiApplyUndo:
      state.lastAiApplyUndo?.changeSetId === changeSet.id ? null : state.lastAiApplyUndo,
    lastAiUndoError: null
  })
  scheduleChatHistorySave(state.workspaceRoot)
  void get().refreshAiApplyHistory()
}

function syncOpenFilesAfterUndo(
  openFiles: OpenFile[],
  activeFilePath: string | null,
  workspaceRoot: string,
  changeSet: WorkspaceChangeSet
): { openFiles: OpenFile[]; activeFilePath: string | null } {
  let nextOpenFiles = [...openFiles]
  let nextActive = activeFilePath

  const toAbsolute = (relativePath: string): string => {
    const root = workspaceRoot.replace(/\\/g, '/').replace(/\/+$/, '')
    const rel = relativePath.replace(/\\/g, '/').replace(/^\/+/, '')
    return `${root}/${rel}`
  }

  for (const entry of changeSet.entries) {
    const absolute = normalizePath(toAbsolute(entry.relativePath))

    if (entry.type === 'writeFile') {
      if (entry.wasNew) {
        nextOpenFiles = nextOpenFiles.filter((f) => normalizePath(f.path) !== absolute)
        if (nextActive && normalizePath(nextActive) === absolute) {
          nextActive = null
        }
      } else {
        nextOpenFiles = nextOpenFiles.map((f) =>
          normalizePath(f.path) === absolute
            ? {
                ...f,
                content: entry.before ?? '',
                isDirty: false,
                isPreview: false,
                previewOriginal: undefined,
                isNewPreview: false
              }
            : f
        )
      }
      continue
    }

    if (entry.type === 'deleteFile') {
      const existingIdx = nextOpenFiles.findIndex((f) => normalizePath(f.path) === absolute)
      const restored: OpenFile = {
        path: absolute,
        content: entry.before,
        language: getLanguageFromPath(absolute),
        encoding: 'utf8',
        isDirty: false
      }
      if (existingIdx >= 0) nextOpenFiles[existingIdx] = restored
      else nextOpenFiles.push(restored)
      continue
    }

    if (entry.type === 'deleteDir') {
      const prefix = `${absolute}/`
      nextOpenFiles = nextOpenFiles.filter((f) => {
        const path = normalizePath(f.path)
        return path !== absolute && !path.startsWith(prefix)
      })
      if (nextActive) {
        const active = normalizePath(nextActive)
        if (active === absolute || active.startsWith(prefix)) nextActive = null
      }
    }
  }

  if (
    nextActive &&
    !nextOpenFiles.some((f) => normalizePath(f.path) === normalizePath(nextActive!))
  ) {
    nextActive = nextOpenFiles[nextOpenFiles.length - 1]?.path ?? null
  }

  return { openFiles: nextOpenFiles, activeFilePath: nextActive }
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
  /**
   * 起動時に復元するエクスプローラー状態。
   * `undefined` = 未読込 / `null` = 保存なし（デフォルト） / オブジェクト = 復元
   */
  persistedExplorerState: WorkspaceExplorerState | null | undefined
  openFiles: OpenFile[]
  activeFilePath: string | null
  chatSessions: ChatSession[]
  activeChatId: string | null
  /** 生成中のチャットセッション ID（並行実行可） */
  loadingChatIds: string[]
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
  llmConnection: LlmConnectionState
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
  /** Apply 成功後の Undo 案内（直近の Change Set） */
  lastAiApplyUndo: {
    changeSetId: string
    chatId: string
    entryCount: number
    createdAt: number
  } | null
  /** 直近の AI Apply Undo 失敗 */
  lastAiUndoError: string | null
  /** 直近 Change Set の簡易一覧（新しい順） */
  aiApplyHistory: WorkspaceChangeSetSummary[]
  /** エディタなどからチャット入力へメンション挿入するリクエスト */
  chatComposerInsertRequest: {
    id: number
    mentions: string[]
    selection?: ChatSelectionRef
  } | null
  panelLayout: { fileTreeWidthRatio: number; chatWidthRatio: number; terminalHeight: number }

  setWorkspaceRoot: (root: string | null) => void
  setWorkspaceDefaultUseCasePreset: (preset: UseCasePreset | null) => void
  setPersistedExplorerState: (state: WorkspaceExplorerState | null | undefined) => void
  restoreChatSessions: (sessions: ChatSession[], activeChatId: string | null) => void
  closeWorkspace: () => boolean
  setFileTree: (tree: FileTreeNode[]) => void
  openFile: (
    path: string,
    content: string,
    encoding?: FileEncoding,
    options?: { transient?: boolean }
  ) => void
  openMediaFile: (
    path: string,
    viewKind: 'image' | 'pdf',
    mimeType: string,
    base64: string,
    options?: { transient?: boolean }
  ) => void
  openBrowserTab: (url?: string) => void
  openSettingsTab: () => void
  updateBrowserTab: (
    path: string,
    patch: { browserUrl?: string; browserTitle?: string }
  ) => void
  closeFile: (path: string) => void
  /** 複数タブを一度に閉じる（未保存確認は呼び出し側） */
  closeFiles: (paths: string[]) => void
  /** 一時プレビュータブを通常タブに固定する */
  pinTransientFile: (path: string) => void
  setActiveFile: (path: string) => void
  /** エディタタブを dropIndex（移動前の挿入位置）へ並べ替え */
  reorderOpenFile: (fromPath: string, dropIndex: number) => void
  updateFileContent: (path: string, content: string) => void
  setFileEncoding: (path: string, encoding: FileEncoding) => void
  reopenFileWithEncoding: (path: string, encoding: FileEncoding) => Promise<void>
  markFileSaved: (path: string) => void
  syncOpenFileContents: (files: Array<{ path: string; content: string }>) => void
  renameOpenFile: (oldPath: string, newPath: string) => void
  removePaths: (targetPath: string) => void
  createChatSession: () => void
  setActiveChatSession: (id: string) => void
  /** 開いているチャットタブを dropIndex（開いているタブ内の挿入位置）へ並べ替え */
  reorderChatSession: (fromId: string, dropIndexAmongOpen: number) => void
  closeChatSession: (id: string) => void
  reopenChatSession: (id: string) => void
  deleteChatSession: (id: string) => void
  addChatMessage: (
    chatId: string,
    role: 'user' | 'assistant',
    content: string,
    mode?: ChatMode,
    preset?: UseCasePreset,
    model?: string
  ) => void
  /** user + 空の assistant を1回の更新で追加（送信時の二重スクロール防止） */
  addChatExchange: (
    chatId: string,
    userContent: string,
    mode?: ChatMode,
    preset?: UseCasePreset,
    model?: string
  ) => void
  updateLastAssistantMessage: (
    chatId: string,
    content: string,
    patch?: { agentSteps?: AgentToolStep[] }
  ) => void
  setChatLoading: (chatId: string, loading: boolean) => void
  isChatLoading: (chatId?: string | null) => boolean
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
  setLlmConnection: (connection: LlmConnectionState) => void
  setIndexStatus: (status: 'idle' | 'indexing' | 'ready' | 'error') => void
  setIndexMeta: (meta: { fileCount: number; relationCount: number; indexedAt: string } | null) => void
  setPendingWorkspacePreview: (
    preview: {
      actions: WorkspaceAction[]
      items: ActionPreviewItem[]
      /** 省略時は activeChatId */
      chatId?: string
    } | null
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
  dismissAiApplyUndoBanner: () => void
  undoLastAiApply: () => Promise<WorkspaceChangeSet>
  undoAiApplyById: (changeSetId: string) => Promise<WorkspaceChangeSet>
  undoAiAppliesForChat: (chatId: string) => Promise<WorkspaceChangeSet[]>
  refreshAiApplyHistory: () => Promise<void>
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
const initialPanelLayout = loadPanelLayout()

export const useAppStore = create<AppState>((set, get) => ({
  workspaceRoot: null,
  workspaceDefaultUseCasePreset: null,
  fileTree: [],
  persistedExplorerState: undefined,
  openFiles: [],
  activeFilePath: null,
  chatSessions: [initialChatSession],
  activeChatId: initialChatSession.id,
  loadingChatIds: [],
  settings: { ...DEFAULT_SETTINGS },
  settingsOpen: false,
  showFileTree: initialPanelLayout.showFileTree,
  showChat: initialPanelLayout.showChat,
  showTerminal: initialPanelLayout.showTerminal,
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
  llmConnection: {
    status: 'incomplete',
    error: null,
    code: null,
    method: null
  },
  indexStatus: 'idle',
  indexMeta: null,
  pendingWorkspacePreview: null,
  pendingAgentApprovalId: null,
  agentApprovalTrace: null,
  lastApplyError: null,
  lastAiApplyUndo: null,
  lastAiUndoError: null,
  aiApplyHistory: [],
  chatComposerInsertRequest: null,
  panelLayout: {
    fileTreeWidthRatio: initialPanelLayout.fileTreeWidthRatio,
    chatWidthRatio: initialPanelLayout.chatWidthRatio,
    terminalHeight: initialPanelLayout.terminalHeight
  },

  setWorkspaceRoot: (root) =>
    set((state) => ({
      workspaceRoot: root,
      workspaceDefaultUseCasePreset: root ? state.workspaceDefaultUseCasePreset : null,
      persistedExplorerState: root ? state.persistedExplorerState : undefined,
      chatSessions: state.chatSessions.map((session) => ({ ...session, contextRefs: [] }))
    })),

  setWorkspaceDefaultUseCasePreset: (preset) =>
    set({ workspaceDefaultUseCasePreset: normalizeUseCasePreset(preset) ?? null }),

  setPersistedExplorerState: (state) => set({ persistedExplorerState: state }),

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

    if (state.loadingChatIds.length > 0 && typeof window !== 'undefined' && window.compass?.ai) {
      void window.compass.ai.cancel()
    }

    const rootToSave = state.workspaceRoot
    const sessionsToSave = state.chatSessions
    const activeChatIdToSave = state.activeChatId
    const openEditorsToSave = toPersistedOpenEditors(state)
    if (chatHistorySaveTimer) {
      clearTimeout(chatHistorySaveTimer)
      chatHistorySaveTimer = null
    }
    if (openEditorsSaveTimer) {
      clearTimeout(openEditorsSaveTimer)
      openEditorsSaveTimer = null
    }
    void window.compass.chat.saveHistory(rootToSave, {
      activeChatId: activeChatIdToSave,
      sessions: sessionsToSave
    })
    if (typeof window !== 'undefined' && window.compass?.openEditors) {
      void window.compass.openEditors.save(rootToSave, openEditorsToSave)
    }

    set({
      workspaceRoot: null,
      workspaceDefaultUseCasePreset: null,
      fileTree: [],
      persistedExplorerState: undefined,
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
      loadingChatIds: [],
      lastAiApplyUndo: null,
      lastAiUndoError: null,
      aiApplyHistory: [],
      chatSessions: state.chatSessions.map((session) => ({ ...session, contextRefs: [] }))
    })
    return true
  },

  setFileTree: (tree) => set({ fileTree: tree }),

  openFile: (path, content, encoding = 'utf8', options) => {
    const transient = options?.transient === true
    set((state) => {
      const normalized = normalizePath(path)
      const existing = state.openFiles.find((f) => normalizePath(f.path) === normalized)
      // 既存タブは内容を上書きしない（未保存編集の消失を防ぐ）。再読込は reopenFileWithEncoding 等を使う
      if (existing) {
        if (!transient && existing.isTransient) {
          return {
            openFiles: state.openFiles.map((f) =>
              normalizePath(f.path) === normalized ? { ...f, isTransient: false } : f
            ),
            activeFilePath: existing.path
          }
        }
        return { activeFilePath: existing.path }
      }
      const newFile: OpenFile = {
        path,
        content,
        language: getLanguageFromPath(path),
        encoding,
        isDirty: false,
        viewKind: 'text',
        ...(transient ? { isTransient: true } : {})
      }
      if (transient) {
        const transientIdx = state.openFiles.findIndex((f) => f.isTransient)
        if (transientIdx >= 0) {
          const openFiles = [...state.openFiles]
          openFiles[transientIdx] = newFile
          return { openFiles, activeFilePath: path }
        }
      }
      return {
        openFiles: [...state.openFiles, newFile],
        activeFilePath: path
      }
    })
    scheduleOpenEditorsSave(get().workspaceRoot)
  },

  openMediaFile: (path, viewKind, mimeType, base64, options) => {
    const transient = options?.transient === true
    set((state) => {
      const normalized = normalizePath(path)
      const existing = state.openFiles.find((f) => normalizePath(f.path) === normalized)
      if (existing) {
        if (!transient && existing.isTransient) {
          return {
            openFiles: state.openFiles.map((f) =>
              normalizePath(f.path) === normalized ? { ...f, isTransient: false } : f
            ),
            activeFilePath: existing.path
          }
        }
        return { activeFilePath: existing.path }
      }
      const mediaFile: OpenFile = {
        path,
        content: '',
        language: viewKind === 'pdf' ? 'pdf' : 'image',
        encoding: 'utf8',
        isDirty: false,
        viewKind,
        mediaMimeType: mimeType,
        mediaBase64: base64,
        ...(transient ? { isTransient: true } : {})
      }
      if (transient) {
        const transientIdx = state.openFiles.findIndex((f) => f.isTransient)
        if (transientIdx >= 0) {
          const openFiles = [...state.openFiles]
          openFiles[transientIdx] = mediaFile
          return { openFiles, activeFilePath: path }
        }
      }
      return {
        openFiles: [...state.openFiles, mediaFile],
        activeFilePath: path
      }
    })
    scheduleOpenEditorsSave(get().workspaceRoot)
  },

  openBrowserTab: (url) => {
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
    })
    scheduleOpenEditorsSave(get().workspaceRoot)
  },

  openSettingsTab: () =>
    set((state) => {
      const existing = state.openFiles.find((f) => f.viewKind === 'settings')
      if (existing) {
        return { activeFilePath: existing.path }
      }
      const tab: OpenFile = {
        path: SETTINGS_TAB_PATH,
        content: '',
        language: 'settings',
        encoding: 'utf8',
        isDirty: false,
        viewKind: 'settings'
      }
      return {
        openFiles: [...state.openFiles, tab],
        activeFilePath: tab.path
      }
    }),

  updateBrowserTab: (path, patch) => {
    set((state) => ({
      openFiles: state.openFiles.map((f) =>
        f.path === path && f.viewKind === 'browser' ? { ...f, ...patch } : f
      )
    }))
    if (patch.browserUrl !== undefined) {
      scheduleOpenEditorsSave(get().workspaceRoot)
    }
  },

  closeFile: (path) => {
    get().closeFiles([path])
  },

  closeFiles: (paths) => {
    if (paths.length === 0) return
    const pathSet = new Set(paths)
    set((state) => {
      const filtered = state.openFiles.filter((f) => !pathSet.has(f.path))
      let activeFilePath = state.activeFilePath
      if (activeFilePath && pathSet.has(activeFilePath)) {
        activeFilePath = filtered.length > 0 ? filtered[filtered.length - 1].path : null
      }
      return { openFiles: filtered, activeFilePath }
    })
    scheduleOpenEditorsSave(get().workspaceRoot)
  },

  pinTransientFile: (path) => {
    const normalized = normalizePath(path)
    const state = get()
    const target = state.openFiles.find((f) => normalizePath(f.path) === normalized)
    if (!target?.isTransient) return
    set({
      openFiles: state.openFiles.map((f) =>
        normalizePath(f.path) === normalized ? { ...f, isTransient: false } : f
      )
    })
    scheduleOpenEditorsSave(get().workspaceRoot)
  },

  setActiveFile: (path) => {
    set({ activeFilePath: path })
    scheduleOpenEditorsSave(get().workspaceRoot)
  },

  reorderOpenFile: (fromPath, dropIndex) => {
    const state = get()
    const fromIndex = state.openFiles.findIndex((f) => f.path === fromPath)
    if (fromIndex < 0) return
    const openFiles = moveItemByDropIndex(state.openFiles, fromIndex, dropIndex)
    if (openFiles === state.openFiles) return
    set({ openFiles })
    scheduleOpenEditorsSave(state.workspaceRoot)
  },

  updateFileContent: (path, content) =>
    set((state) => ({
      openFiles: state.openFiles.map((f) =>
        f.path === path
          ? { ...f, content, isDirty: true, isTransient: false }
          : f
      )
    })),

  setFileEncoding: (path, encoding) =>
    set((state) => ({
      openFiles: state.openFiles.map((f) =>
        f.path === path
          ? { ...f, encoding, isDirty: true, isTransient: false }
          : f
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

  renameOpenFile: (oldPath, newPath) => {
    set((state) => {
      const oldNorm = oldPath.replace(/\\/g, '/')

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
    })
    scheduleOpenEditorsSave(get().workspaceRoot)
  },

  removePaths: (targetPath) => {
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
    })
    scheduleOpenEditorsSave(get().workspaceRoot)
  },

  createChatSession: () => {
    const state = get()
    if (state.pendingWorkspacePreview) {
      get().revertWorkspacePreview()
    }
    const session = createEmptyChatSession()
    set({
      chatSessions: [...state.chatSessions, session],
      activeChatId: session.id,
      showChat: true
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
    set({ activeChatId: id, showChat: true })
    scheduleChatHistorySave(state.workspaceRoot)
  },

  reorderChatSession: (fromId, dropIndexAmongOpen) => {
    const state = get()
    const chatSessions = reorderOpenSessionsById(
      state.chatSessions,
      fromId,
      dropIndexAmongOpen
    )
    if (chatSessions === state.chatSessions) return
    set({ chatSessions })
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
    const nextSessions = isEmptySession
      ? state.chatSessions.filter((s) => s.id !== id)
      : state.chatSessions.map((s) =>
          s.id === id ? { ...s, isOpen: false, updatedAt: Date.now() } : s
        )

    const openSessions = getOpenSessions(nextSessions)
    // 最終タブを閉じたら空タブを作らず、チャットパネル自体を閉じる
    if (openSessions.length === 0) {
      set({ chatSessions: nextSessions, activeChatId: null, showChat: false })
      scheduleChatHistorySave(state.workspaceRoot)
      return
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
      activeChatId: id,
      showChat: true
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

    const nextSessions = state.chatSessions.filter((s) => s.id !== id)
    const openSessions = getOpenSessions(nextSessions)

    // 開いているタブが無くなったら空タブを作らず、パネルを閉じる
    if (openSessions.length === 0) {
      set({
        chatSessions: nextSessions,
        activeChatId: null,
        showChat: false
      })
      scheduleChatHistorySave(state.workspaceRoot)
      return
    }

    let activeChatId = state.activeChatId
    if (activeChatId === id || !openSessions.some((s) => s.id === activeChatId)) {
      activeChatId = openSessions[openSessions.length - 1].id
    }

    set({ chatSessions: nextSessions, activeChatId })
    scheduleChatHistorySave(state.workspaceRoot)
  },

  addChatMessage: (chatId, role, content, mode, preset, model) => {
    const trimmedModel = typeof model === 'string' ? model.trim() : ''
    set((state) => ({
      chatSessions: updateSessionById(state.chatSessions, chatId, (session) => {
        const messages: ChatMessage[] = [
          ...session.messages,
          {
            id: generateId(),
            role,
            content,
            timestamp: Date.now(),
            ...(role === 'user' && mode ? { mode } : {}),
            ...(role === 'user' && preset ? { preset } : {}),
            ...(role === 'user' && trimmedModel ? { model: trimmedModel } : {})
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

  addChatExchange: (chatId, userContent, mode, preset, model) => {
    const trimmedModel = typeof model === 'string' ? model.trim() : ''
    const now = Date.now()
    set((state) => ({
      chatSessions: updateSessionById(state.chatSessions, chatId, (session) => {
        const messages: ChatMessage[] = [
          ...session.messages,
          {
            id: generateId(),
            role: 'user',
            content: userContent,
            timestamp: now,
            ...(mode ? { mode } : {}),
            ...(preset ? { preset } : {}),
            ...(trimmedModel ? { model: trimmedModel } : {})
          },
          {
            id: generateId(),
            role: 'assistant',
            content: '',
            timestamp: now
          }
        ]
        let title = session.title
        if (isDefaultChatTitle(session.title) && userContent.trim()) {
          const trimmed = userContent.trim()
          title = trimmed.length > 24 ? `${trimmed.slice(0, 24)}…` : trimmed
        }
        return { ...session, messages, title, updatedAt: now }
      })
    }))
    scheduleChatHistorySave(get().workspaceRoot)
  },

  updateLastAssistantMessage: (chatId, content, patch) => {
    let changed = false
    set((state) => {
      const session = state.chatSessions.find((item) => item.id === chatId)
      if (!session) return state
      const lastIdx = session.messages.length - 1
      const last = lastIdx >= 0 ? session.messages[lastIdx] : null
      if (!last || last.role !== 'assistant') return state
      const stepsUnchanged =
        patch?.agentSteps === undefined || patch.agentSteps === last.agentSteps
      if (last.content === content && stepsUnchanged) return state

      changed = true
      return {
        chatSessions: updateSessionById(state.chatSessions, chatId, (current) => {
          const messages = [...current.messages]
          const idx = messages.length - 1
          if (idx >= 0 && messages[idx].role === 'assistant') {
            messages[idx] = {
              ...messages[idx],
              content,
              ...(patch?.agentSteps !== undefined ? { agentSteps: patch.agentSteps } : {})
            }
          }
          return { ...current, messages, updatedAt: Date.now() }
        })
      }
    })
    if (changed) scheduleChatHistorySave(get().workspaceRoot)
  },

  setChatLoading: (chatId, loading) =>
    set((state) => {
      const has = state.loadingChatIds.includes(chatId)
      if (loading) {
        if (has) return state
        return { loadingChatIds: [...state.loadingChatIds, chatId] }
      }
      if (!has) return state
      return { loadingChatIds: state.loadingChatIds.filter((id) => id !== chatId) }
    }),

  isChatLoading: (chatId) => {
    const ids = get().loadingChatIds
    if (chatId === undefined) return ids.length > 0
    if (!chatId) return false
    return ids.includes(chatId)
  },

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
  setShowChat: (show) => {
    if (!show) {
      set({ showChat: false })
      return
    }
    const state = get()
    const openSessions = getOpenSessions(state.chatSessions)
    if (openSessions.length === 0) {
      const ensured = ensureOpenChatSession(state.chatSessions)
      set({
        showChat: true,
        chatSessions: ensured.sessions,
        activeChatId: ensured.activeChatId
      })
      scheduleChatHistorySave(state.workspaceRoot)
      return
    }
    const activeChatId =
      state.activeChatId && openSessions.some((s) => s.id === state.activeChatId)
        ? state.activeChatId
        : openSessions[openSessions.length - 1].id
    set({ showChat: true, activeChatId })
  },
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
  setLlmConnection: (connection) => set({ llmConnection: connection }),
  setIndexStatus: (status) => set({ indexStatus: status }),
  setIndexMeta: (meta) => set({ indexMeta: meta }),

  setPendingWorkspacePreview: (preview) => {
    if (!preview) {
      get().revertWorkspacePreview()
      return
    }
    const chatId = preview.chatId ?? get().activeChatId
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
    const chatId = state.pendingWorkspacePreview.chatId
    const actionCount = state.pendingWorkspacePreview.actions.length
    const actionSummary = state.pendingWorkspacePreview.actions
      .map((a) => `- ${a.type}: ${a.path}`)
      .join('\n')

    const deleteItems = state.pendingWorkspacePreview.items.filter(
      (item): item is Extract<ActionPreviewItem, { type: 'deleteFile' | 'deleteDir' }> =>
        item.type === 'deleteFile' || item.type === 'deleteDir'
    )
    const writeContents = appliedWriteContentByPath(state.pendingWorkspacePreview.items)

    let changeSet: WorkspaceChangeSet | undefined
    try {
      const result = await window.compass.fs.applyActions(
        state.workspaceRoot,
        state.pendingWorkspacePreview.actions,
        { undo: { chatId, source: 'preview-all' } }
      )
      changeSet = result.changeSet
    } catch (error) {
      // Keep preview + Agent approval pending so the user can retry apply.
      const message = error instanceof Error ? error.message : 'apply failed'
      set({ lastApplyError: message })
      throw error
    }

    set((s) => {
      let openFiles = s.openFiles.map((f) => {
        const appliedContent = writeContents.get(normalizePath(f.path).toLowerCase())
        if (appliedContent !== undefined) {
          return {
            ...f,
            content: appliedContent,
            isPreview: false,
            previewOriginal: undefined,
            isNewPreview: false,
            isDirty: false
          }
        }
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
        lastApplyError: null,
        lastAiUndoError: null,
        lastAiApplyUndo: changeSet ? bannerFromChangeSet(changeSet) : s.lastAiApplyUndo,
        chatSessions: changeSet
          ? attachAppliedChangeSetToSessions(s.chatSessions, chatId, changeSet)
          : s.chatSessions
      }
    })

    if (changeSet) scheduleChatHistorySave(get().workspaceRoot)
    if (changeSet) void get().refreshAiApplyHistory()

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

    const chatId = state.pendingWorkspacePreview.chatId
    let changeSet: WorkspaceChangeSet | undefined
    try {
      const result = await window.compass.fs.applyActions(
        state.workspaceRoot,
        actionsToApply,
        { undo: { chatId, source: 'preview-file' } }
      )
      changeSet = result.changeSet
    } catch (error) {
      const message = error instanceof Error ? error.message : 'apply failed'
      set({ lastApplyError: message })
      throw error
    }

    const appliedLabel = writeItem.relativePath.replace(/\\/g, '/')
    set((s) => {
      if (!s.pendingWorkspacePreview) return s
      const openFiles = finalizePreviewFileInOpenFiles(
        s.openFiles,
        filePath,
        writeItem.newContent
      )
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
        lastApplyError: null,
        lastAiUndoError: null,
        lastAiApplyUndo: changeSet ? bannerFromChangeSet(changeSet) : s.lastAiApplyUndo,
        chatSessions: changeSet
          ? attachAppliedChangeSetToSessions(s.chatSessions, chatId, changeSet)
          : s.chatSessions
      }
    })
    if (changeSet) scheduleChatHistorySave(get().workspaceRoot)
    if (changeSet) void get().refreshAiApplyHistory()
    resolveAgentApprovalIfPreviewCleared(get, set)
  },

  dismissAiApplyUndoBanner: () => set({ lastAiApplyUndo: null, lastAiUndoError: null }),

  undoLastAiApply: async () => {
    const state = get()
    if (!state.workspaceRoot) {
      throw new Error('No workspace open')
    }

    try {
      const result = await window.compass.fs.undoLastAiApply(state.workspaceRoot)
      applyUndoSuccessToStore(get, set, result.changeSet)
      return result.changeSet
    } catch (error) {
      const message = error instanceof Error ? error.message : 'undo failed'
      set({ lastAiUndoError: message })
      throw error
    }
  },

  undoAiApplyById: async (changeSetId) => {
    const state = get()
    if (!state.workspaceRoot) {
      throw new Error('No workspace open')
    }

    try {
      const result = await window.compass.fs.undoAiApply(state.workspaceRoot, changeSetId)
      applyUndoSuccessToStore(get, set, result.changeSet)
      return result.changeSet
    } catch (error) {
      const message = error instanceof Error ? error.message : 'undo failed'
      set({ lastAiUndoError: message })
      throw error
    }
  },

  undoAiAppliesForChat: async (chatId) => {
    const state = get()
    if (!state.workspaceRoot) {
      throw new Error('No workspace open')
    }

    try {
      const result = await window.compass.fs.undoChatAiApplies(state.workspaceRoot, chatId)
      if (result.undone.length === 0) {
        if (result.stoppedReason === 'blocked_other_chat') {
          const message = t('fs.undoChatBlocked')
          set({ lastAiUndoError: message })
          throw new Error(message)
        }
        const message = t('fs.undoNothing')
        set({ lastAiUndoError: message })
        throw new Error(message)
      }
      // Apply open-file sync for each undo in order (already on disk); use last for note stacking.
      let openFiles = state.openFiles
      let activeFilePath = state.activeFilePath
      for (const changeSet of result.undone) {
        const synced = syncOpenFilesAfterUndo(
          openFiles,
          activeFilePath,
          state.workspaceRoot,
          changeSet
        )
        openFiles = synced.openFiles
        activeFilePath = synced.activeFilePath
      }

      let sessions = state.chatSessions
      for (const changeSet of result.undone) {
        sessions = markAppliedChangeSetUndoneInSessions(sessions, changeSet.id)
        const agentRunning = get().loadingChatIds.includes(changeSet.chatId)
        sessions = appendUndoNoteToSessions(sessions, changeSet, agentRunning)
      }

      const tipBanner =
        result.undone.length > 0
          ? null
          : state.lastAiApplyUndo

      set({
        openFiles,
        activeFilePath,
        chatSessions: sessions,
        lastAiApplyUndo:
          state.lastAiApplyUndo &&
          result.undone.some((item) => item.id === state.lastAiApplyUndo?.changeSetId)
            ? null
            : tipBanner,
        lastAiUndoError: null
      })
      scheduleChatHistorySave(state.workspaceRoot)
      void get().refreshAiApplyHistory()
      return result.undone
    } catch (error) {
      const message = error instanceof Error ? error.message : 'undo failed'
      set({ lastAiUndoError: message })
      throw error
    }
  },

  refreshAiApplyHistory: async () => {
    const root = get().workspaceRoot
    if (!root || !window.compass?.fs?.listAiApplies) {
      set({ aiApplyHistory: [] })
      return
    }
    try {
      const history = await window.compass.fs.listAiApplies(root)
      set({ aiApplyHistory: history })
    } catch {
      set({ aiApplyHistory: [] })
    }
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
    set((state) => {
      const openSessions = getOpenSessions(state.chatSessions)
      const ensured =
        openSessions.length === 0
          ? ensureOpenChatSession(state.chatSessions)
          : {
              sessions: state.chatSessions,
              activeChatId:
                state.activeChatId && openSessions.some((s) => s.id === state.activeChatId)
                  ? state.activeChatId
                  : openSessions[openSessions.length - 1].id
            }
      return {
        showChat: true,
        chatSessions: ensured.sessions,
        activeChatId: ensured.activeChatId,
        chatComposerInsertRequest: {
          id: (state.chatComposerInsertRequest?.id ?? 0) + 1,
          mentions,
          selection
        }
      }
    })
    scheduleChatHistorySave(get().workspaceRoot)
  },

  clearChatComposerInsertRequest: () => set({ chatComposerInsertRequest: null }),

  setFileTreeWidthRatio: (ratio) =>
    set((state) => ({
      panelLayout: { ...state.panelLayout, fileTreeWidthRatio: ratio }
    })),

  setChatPanelWidthRatio: (ratio) =>
    set((state) => ({
      panelLayout: { ...state.panelLayout, chatWidthRatio: ratio }
    })),

  setTerminalHeight: (height) =>
    set((state) => ({
      panelLayout: { ...state.panelLayout, terminalHeight: height }
    })),

  getActiveChatSession: () => {
    const state = get()
    return state.chatSessions.find((s) => s.id === state.activeChatId) ?? null
  },

  getActiveFile: () => {
    const state = get()
    return state.openFiles.find((f) => f.path === state.activeFilePath) ?? null
  }
}))

useAppStore.subscribe((state, prev) => {
  if (
    state.showFileTree === prev.showFileTree &&
    state.showChat === prev.showChat &&
    state.showTerminal === prev.showTerminal &&
    state.panelLayout === prev.panelLayout
  ) {
    return
  }
  savePanelLayout(
    toPersistedPanelLayout(state.panelLayout, {
      showFileTree: state.showFileTree,
      showChat: state.showChat,
      showTerminal: state.showTerminal
    })
  )
})
