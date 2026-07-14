import { DEFAULT_LOCALE, type LocaleId } from '../i18n/types'
export type { LocaleId } from '../i18n/types'

export type FileEncoding =
  | 'utf8'
  | 'utf8bom'
  | 'shiftjis'
  | 'eucjp'
  | 'utf16le'
  | 'utf16be'
  | 'windows1252'

export interface DecodedFileContent {
  content: string
  encoding: FileEncoding
}

export interface OpenFile {
  path: string
  content: string
  language: string
  encoding: FileEncoding
  isDirty: boolean
  isPreview?: boolean
  previewOriginal?: string
  isNewPreview?: boolean
}

export interface FileTreeNode {
  name: string
  path: string
  isDirectory: boolean
  children?: FileTreeNode[]
  isPreview?: boolean
  previewKind?: 'new-file' | 'new-folder' | 'modified' | 'deleted'
}

export interface ChatContextRef {
  path: string
  name: string
  isDirectory: boolean
}

/** エディタで指定した選択行（チャット指示用） */
export interface ChatSelectionRef {
  path: string
  startLine: number
  endLine: number
  text: string
}

export interface ResolvedContextFile {
  relativePath: string
  content: string
  truncated: boolean
}

export interface ResolvedFolderContext {
  relativePath: string
  structure: string[]
  files: ResolvedContextFile[]
  truncated: boolean
}

export interface ResolvedChatContext {
  files: ResolvedContextFile[]
  folders: ResolvedFolderContext[]
}

export type ChatMode = 'edit' | 'ask' | 'agent'

/** Agent ランの概念的ライフサイクル（UI / ランナー共有） */
export type AgentRunState =
  | 'idle'
  | 'thinking'
  | 'tool_call'
  | 'waiting_approval'
  | 'applying'
  | 'done'
  | 'error'
  | 'aborted'

export type AgentToolName = 'readFile' | 'listDir' | 'search' | 'proposeActions' | 'exec'

export type AgentToolStepStatus = 'running' | 'waiting_approval' | 'done' | 'error'

/** チャット履歴に載せるツールステップ（アシスタントメッセージに埋め込む） */
export interface AgentToolStep {
  id: string
  name: string
  args: Record<string, unknown>
  status: AgentToolStepStatus
  ok?: boolean
  summary?: string
}

export interface AgentToolStartEvent {
  id: string
  name: string
  args: Record<string, unknown>
}

export interface AgentToolResultEvent {
  id: string
  name: string
  ok: boolean
  summary: string
}

export interface AgentStepEvent {
  label: string
}

/** Agent 書き込み提案の承認待ち（Phase 2） */
export interface AgentNeedApprovalEvent {
  id: string
  actions: WorkspaceAction[]
  items: ActionPreviewItem[]
}

export interface AgentResolveApprovalRequest {
  id: string
  approved: boolean
  detail?: string
}

export function normalizeChatMode(mode: unknown): ChatMode | undefined {
  if (mode === 'ask' || mode === 'edit' || mode === 'agent') return mode
  return undefined
}

export function normalizeAgentSteps(raw: unknown): AgentToolStep[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined
  const steps: AgentToolStep[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const s = item as Partial<AgentToolStep>
    if (typeof s.id !== 'string' || typeof s.name !== 'string') continue
    const status: AgentToolStepStatus =
      s.status === 'running' ||
      s.status === 'waiting_approval' ||
      s.status === 'error' ||
      s.status === 'done'
        ? s.status
        : 'done'
    steps.push({
      id: s.id,
      name: s.name,
      args:
        s.args && typeof s.args === 'object' && !Array.isArray(s.args)
          ? (s.args as Record<string, unknown>)
          : {},
      // 途中保存の running / waiting_approval は履歴読込時に error 扱い
      status: status === 'running' || status === 'waiting_approval' ? 'error' : status,
      ok: typeof s.ok === 'boolean' ? s.ok : status === 'done',
      summary:
        typeof s.summary === 'string'
          ? s.summary
          : status === 'running' || status === 'waiting_approval'
            ? 'interrupted'
            : undefined
    })
  }
  return steps.length > 0 ? steps : undefined
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: number
  mode?: ChatMode
  /** Agent モード時のツールステップ（永続化） */
  agentSteps?: AgentToolStep[]
}

export interface ChatSession {
  id: string
  title: string
  messages: ChatMessage[]
  contextRefs: ChatContextRef[]
  createdAt: number
  updatedAt: number
  /** false のときタブ非表示（履歴には残る） */
  isOpen: boolean
}

export type ColorThemeId = 'dark' | 'light' | 'midnight' | 'high-contrast'

export type LlmProviderId =
  | 'openai'
  | 'google'
  | 'deepseek'
  | 'groq'
  | 'openrouter'
  | 'ollama'
  | 'custom'

export interface AppSettings {
  /** 選択中の LLM プロバイダ */
  providerId: LlmProviderId
  apiBaseUrl: string
  /** 現在のプロバイダ向け API Key */
  apiKey: string
  /** プロバイダごとの API Key（切替時に復元） */
  providerKeys: Partial<Record<LlmProviderId, string>>
  model: string
  temperature: number
  maxTokens: number
  colorTheme: ColorThemeId
  /** UI / AI 応答の表示言語 */
  locale: LocaleId
  /** エディタのインライン補完（ゴーストテキスト） */
  inlineCompletionsEnabled: boolean
}

export interface ChatRequest {
  messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>
  workspaceRoot?: string
  mode?: ChatMode
  context?: {
    filePath?: string
    fileContent?: string
    /** @deprecated selections を優先。後方互換のため残す */
    selection?: string
    selections?: ChatSelectionRef[]
    references?: ChatContextRef[]
  }
}

/** インライン補完リクエスト（カーソル前後の抜粋のみ） */
export interface InlineCompletionRequest {
  filePath?: string
  language?: string
  prefix: string
  suffix: string
}

export interface InlineCompletionResult {
  text: string
  cancelled?: boolean
  error?: string
}

export type WorkspaceAction =
  | { type: 'mkdir'; path: string }
  | { type: 'writeFile'; path: string; content: string }
  | { type: 'deleteFile'; path: string }
  | { type: 'deleteDir'; path: string }

export interface WorkspaceActionResult {
  applied: WorkspaceAction[]
}

export type ActionPreviewItem =
  | { type: 'mkdir'; path: string; relativePath: string; alreadyExists: boolean }
  | {
      type: 'writeFile'
      path: string
      relativePath: string
      oldContent: string
      newContent: string
      isNew: boolean
    }
  | {
      type: 'deleteFile' | 'deleteDir'
      path: string
      relativePath: string
      exists: boolean
    }

export interface IndexBuildResult {
  workspaceRoot: string
  fileCount: number
  relationCount: number
  indexedAt: string
}

export interface EnsureIndexResult extends IndexBuildResult {
  rebuilt: boolean
}

export interface ProjectIndexContext {
  indexedAt: string
  fileCount: number
  aiContext: string
}

export interface CodeBlock {
  language: string
  code: string
}

export interface EditorSelection {
  startLine: number
  startColumn: number
  endLine: number
  endColumn: number
  text: string
}

export interface TerminalShell {
  id: string
  label: string
  path: string
  args: string[]
}

export interface WorkspaceSearchOptions {
  query: string
  caseSensitive?: boolean
  wholeWord?: boolean
  useRegex?: boolean
  include?: string
  exclude?: string
  rootPath?: string
  maxResults?: number
}

export interface WorkspaceSearchMatch {
  line: number
  column: number
  endColumn: number
  preview: string
  matchText: string
}

export interface WorkspaceSearchFileResult {
  path: string
  relativePath: string
  matches: WorkspaceSearchMatch[]
}

export interface WorkspaceSearchResult {
  files: WorkspaceSearchFileResult[]
  totalMatches: number
  truncated: boolean
  filesSearched: number
}

export interface WorkspaceReplaceOptions extends WorkspaceSearchOptions {
  replace: string
  /** 置換対象を特定ファイルに限定する場合 */
  paths?: string[]
}

export interface WorkspaceReplaceResult {
  filesChanged: number
  replacements: number
  changedFiles: Array<{ path: string; content: string }>
  errors: Array<{ path: string; message: string }>
}

export type LeftSidebarView = 'explorer' | 'search'

export interface EditorRevealRequest {
  id: number
  path: string
  line: number
  column: number
  endColumn: number
}

export interface CompassAPI {
  fs: {
    openFolder: () => Promise<string | null>
    readDir: (dirPath: string) => Promise<FileTreeNode[]>
    readFile: (filePath: string, encoding?: FileEncoding) => Promise<DecodedFileContent>
    writeFile: (filePath: string, content: string, encoding?: FileEncoding) => Promise<void>
    createFile: (parentDir: string, name: string) => Promise<string>
    createDirectory: (parentDir: string, name: string) => Promise<string>
    rename: (targetPath: string, newName: string) => Promise<string>
    move: (sourcePath: string, destDir: string) => Promise<string>
    delete: (targetPath: string) => Promise<void>
    search: (
      workspaceRoot: string,
      options: WorkspaceSearchOptions
    ) => Promise<WorkspaceSearchResult>
    replace: (
      workspaceRoot: string,
      options: WorkspaceReplaceOptions
    ) => Promise<WorkspaceReplaceResult>
    resolveChatContext: (
      workspaceRoot: string,
      references: ChatContextRef[]
    ) => Promise<ResolvedChatContext>
    previewActions: (
      workspaceRoot: string,
      actions: WorkspaceAction[]
    ) => Promise<ActionPreviewItem[]>
    applyActions: (
      workspaceRoot: string,
      actions: WorkspaceAction[]
    ) => Promise<WorkspaceActionResult>
  }
  ai: {
    chat: (request: ChatRequest) => Promise<void>
    cancel: () => Promise<boolean>
    complete: (request: InlineCompletionRequest) => Promise<InlineCompletionResult>
    cancelComplete: () => Promise<boolean>
    onChunk: (callback: (chunk: string) => void) => () => void
    onDone: (callback: () => void) => () => void
    onAborted: (callback: () => void) => () => void
    onError: (callback: (error: string) => void) => () => void
    onToolStart: (callback: (event: AgentToolStartEvent) => void) => () => void
    onToolResult: (callback: (event: AgentToolResultEvent) => void) => () => void
    onStep: (callback: (event: AgentStepEvent) => void) => () => void
    onNeedApproval: (callback: (event: AgentNeedApprovalEvent) => void) => () => void
    resolveApproval: (request: AgentResolveApprovalRequest) => Promise<boolean>
  }
  settings: {
    get: () => Promise<AppSettings>
    set: (settings: AppSettings) => Promise<void>
  }
  workspace: {
    getLast: () => Promise<string | null>
    getRecent: () => Promise<string[]>
    addRecent: (workspaceRoot: string) => Promise<void>
    removeRecent: (workspaceRoot: string) => Promise<void>
    setLast: (workspaceRoot: string | null) => Promise<void>
  }
  shell: {
    quit: () => Promise<void>
    edit: (action: 'undo' | 'redo' | 'cut' | 'copy' | 'paste' | 'selectAll') => Promise<void>
    view: (
      action: 'reload' | 'toggleDevTools' | 'resetZoom' | 'zoomIn' | 'zoomOut'
    ) => Promise<void>
    showAbout: () => Promise<void>
  }
  menu: {
    onOpenFolder: (callback: () => void) => () => void
    onCloseFolder: (callback: () => void) => () => void
    onSave: (callback: () => void) => () => void
    onSettings: (callback: () => void) => () => void
    onToggleTerminal: (callback: () => void) => () => void
    onFindInFile: (callback: () => void) => () => void
    onReplaceInFile: (callback: () => void) => () => void
    onFindInFiles: (callback: () => void) => () => void
    onReplaceInFiles: (callback: () => void) => () => void
  }
  index: {
    build: (workspaceRoot: string) => Promise<IndexBuildResult>
    ensureFresh: (workspaceRoot: string) => Promise<EnsureIndexResult>
    watch: (workspaceRoot: string) => Promise<void>
    unwatch: () => Promise<void>
    getContext: (
      workspaceRoot: string,
      options?: { currentFile?: string; referencePaths?: string[] }
    ) => Promise<ProjectIndexContext | null>
    onUpdated: (callback: (result: IndexBuildResult) => void) => () => void
    onStatus: (
      callback: (status: 'indexing' | 'ready' | 'error', workspaceRoot: string) => void
    ) => () => void
  }
  chat: {
    loadHistory: (
      workspaceRoot: string
    ) => Promise<{ activeChatId: string | null; sessions: ChatSession[] }>
    saveHistory: (
      workspaceRoot: string,
      history: { activeChatId: string | null; sessions: ChatSession[] }
    ) => Promise<void>
  }
  terminal: {
    listShells: () => Promise<TerminalShell[]>
    create: (
      id: string,
      cwd: string,
      shellId: string | undefined,
      session?: number
    ) => Promise<{ ok: true; shellId: string; replay: string } | { ok: false; error: string }>
    write: (id: string, data: string) => Promise<boolean>
    resize: (id: string, cols: number, rows: number) => Promise<void>
    kill: (id: string, session?: number) => Promise<void>
    killAll: () => Promise<void>
    setCwd: (cwd: string) => Promise<void>
    onData: (callback: (id: string, data: string) => void) => () => void
    onExit: (callback: (id: string, exitCode: number) => void) => () => void
  }
}

declare global {
  interface Window {
    compass: CompassAPI
  }
}

export const DEFAULT_SETTINGS: AppSettings = {
  providerId: 'openai',
  apiBaseUrl: 'https://api.openai.com/v1',
  apiKey: '',
  providerKeys: {},
  model: 'gpt-4o-mini',
  temperature: 0.2,
  maxTokens: 4096,
  colorTheme: 'dark',
  locale: DEFAULT_LOCALE,
  inlineCompletionsEnabled: true
}
