import { useEffect, useRef, useState, useMemo, useCallback } from 'react'
import type { FileTreeNode } from '@/types'
import { useAppStore } from '@/stores/app-store'
import { buildWorkspaceIndex } from '@/utils/project-index'
import { mergePreviewIntoTree } from '@/utils/preview-tree'
import {
  CHAT_CONTEXT_DRAG_MIME,
  serializeChatContextRefs,
  toChatContextRef
} from '@/utils/chat-context-drag'
import {
  FILE_MOVE_DRAG_MIME,
  hasFileMoveDrag,
  parseFileMovePaths,
  serializeFileMovePaths
} from '@/utils/file-move-drag'
import { formatContextMention } from '@/utils/chat-mentions'
import { useI18n } from '@/i18n'
import { basename } from '@/utils/path'
import {
  buildUniqueTemplateFileName,
  listDocTemplates,
  listEffectiveDocTemplates,
  type DocTemplate
} from '@/utils/doc-templates'
import { buildUniqueFileName, getNameStemSelectionEnd } from '@/utils/unique-file-name'
import { getErrorMessage } from '@/utils/error-message'
import { ConfirmDialog } from './ConfirmDialog'
import { TemplateManagerDialog } from './TemplateManagerDialog'
import {
  NewFileIcon,
  NewFolderIcon,
  ExpandAllIcon,
  CollapseAllIcon,
  RefreshIcon,
  ChevronRightIcon,
  ChevronDownIcon
} from './icons/ToolbarIcons'
import { FileTreeNodeIcon } from './icons/FileTypeIcons'
import { openWorkspaceFile } from '@/utils/open-workspace-file'

type InputMode = 'create-file' | 'create-folder' | 'rename'

interface ContextMenuState {
  x: number
  y: number
  node: FileTreeNode | null
}

interface CreateMenuState {
  x: number
  y: number
  parentDir: string
}

interface TemplateMenuState {
  x: number
  y: number
  parentDir: string
}

interface InlineInputState {
  mode: InputMode
  parentDir: string
  targetPath?: string
  defaultName: string
}

interface ExplorerClipboard {
  mode: 'copy' | 'cut'
  paths: string[]
}

function normalizeNodePath(path: string): string {
  return path.replace(/\\/g, '/')
}

function parentDirPath(path: string): string {
  const sepIdx = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return sepIdx >= 0 ? path.slice(0, sepIdx) : ''
}

function canMoveInto(sourcePaths: string[], destDir: string): boolean {
  const destNorm = normalizeNodePath(destDir)
  let hasMovable = false

  for (const source of sourcePaths) {
    const sourceNorm = normalizeNodePath(source)
    if (destNorm === sourceNorm || destNorm.startsWith(`${sourceNorm}/`)) {
      return false
    }
    if (parentDirPath(sourceNorm) !== destNorm) {
      hasMovable = true
    }
  }

  return hasMovable
}

function listChildNames(nodes: FileTreeNode[], dirPath: string): string[] {
  const target = normalizeNodePath(dirPath)
  const walk = (list: FileTreeNode[]): string[] | null => {
    for (const node of list) {
      if (normalizeNodePath(node.path) === target) {
        return (node.children ?? []).map((child) => child.name)
      }
      if (node.children) {
        const found = walk(node.children)
        if (found) return found
      }
    }
    return null
  }
  return walk(nodes) ?? []
}

function resolveCreateParentDir(
  node: FileTreeNode | null,
  workspaceRoot: string
): string {
  if (!node) return workspaceRoot
  if (node.isDirectory) return node.path
  return parentDirPath(node.path) || workspaceRoot
}

function findNodeByPath(nodes: FileTreeNode[], path: string): FileTreeNode | null {
  const target = normalizeNodePath(path)
  for (const node of nodes) {
    if (normalizeNodePath(node.path) === target) return node
    if (node.children) {
      const found = findNodeByPath(node.children, path)
      if (found) return found
    }
  }
  return null
}

/** 選択中のフォルダ（ファイルなら親）へ作成。未選択時はワークスペース直下 */
function resolveCreateParentFromSelection(
  selectedPaths: Set<string>,
  lastSelectedPath: string | null,
  rootedTree: FileTreeNode[],
  workspaceRoot: string
): string {
  const lastNorm = lastSelectedPath ? normalizeNodePath(lastSelectedPath) : null
  const focusPath =
    lastNorm && selectedPaths.has(lastNorm)
      ? lastSelectedPath!
      : selectedPaths.size > 0
        ? [...selectedPaths][selectedPaths.size - 1]
        : null

  if (!focusPath) return workspaceRoot
  const node = findNodeByPath(rootedTree, focusPath)
  return resolveCreateParentDir(node, workspaceRoot)
}

function collectDirectoryPaths(nodes: FileTreeNode[]): string[] {
  const paths: string[] = []
  for (const node of nodes) {
    if (node.isDirectory) {
      paths.push(normalizeNodePath(node.path))
      if (node.children) paths.push(...collectDirectoryPaths(node.children))
    }
  }
  return paths
}

function collectVisibleNodes(nodes: FileTreeNode[], expandedDirs: Set<string>): FileTreeNode[] {
  const result: FileTreeNode[] = []
  for (const node of nodes) {
    result.push(node)
    if (node.isDirectory && expandedDirs.has(normalizeNodePath(node.path)) && node.children) {
      result.push(...collectVisibleNodes(node.children, expandedDirs))
    }
  }
  return result
}

/** 未保存時のデフォルト: ワークスペースルートだけ開く */
function getDefaultExpandedDirs(workspaceRoot: string): Set<string> {
  return new Set([normalizeNodePath(workspaceRoot)])
}

function collectAllNodePaths(nodes: FileTreeNode[]): string[] {
  const paths: string[] = []
  for (const node of nodes) {
    paths.push(normalizeNodePath(node.path))
    if (node.children) paths.push(...collectAllNodePaths(node.children))
  }
  return paths
}

function filterExistingPaths(paths: string[], known: Set<string>): Set<string> {
  const next = new Set<string>()
  for (const path of paths) {
    const normalized = normalizeNodePath(path)
    if (known.has(normalized)) next.add(normalized)
  }
  return next
}

/** 選択が見えるよう、選択パスの祖先ディレクトリを展開に含める */
function ensureAncestorsExpanded(
  expanded: Set<string>,
  selectedPaths: Iterable<string>,
  workspaceRoot: string
): Set<string> {
  const rootNorm = normalizeNodePath(workspaceRoot)
  const next = new Set(expanded)
  next.add(rootNorm)
  for (const selected of selectedPaths) {
    const normalized = normalizeNodePath(selected)
    let current = parentDirPath(normalized)
    while (current && current.length > 0) {
      const currentNorm = normalizeNodePath(current)
      next.add(currentNorm)
      if (currentNorm === rootNorm) break
      const parent = parentDirPath(currentNorm)
      if (!parent || parent === currentNorm) break
      current = parent
    }
  }
  return next
}

function filterTopLevelPaths(paths: string[]): string[] {
  const normalized = paths.map(normalizeNodePath).sort((a, b) => a.length - b.length)
  const result: string[] = []
  for (const path of normalized) {
    if (!result.some((parent) => path === parent || path.startsWith(`${parent}/`))) {
      result.push(path)
    }
  }
  return result
}

/** 作成行の仮パス（scrollIntoView / data-tree-path 用） */
const CREATE_ROW_PATH = '__compass_creating__'

/** readDir と同じ並び（フォルダ優先 → 名前順）での挿入位置 */
function findCreateInsertIndex(
  children: FileTreeNode[],
  defaultName: string,
  isDirectory: boolean
): number {
  for (let i = 0; i < children.length; i++) {
    const child = children[i]
    if (isDirectory) {
      if (!child.isDirectory) return i
      if (defaultName.localeCompare(child.name) <= 0) return i
    } else {
      if (child.isDirectory) continue
      if (defaultName.localeCompare(child.name) <= 0) return i
    }
  }
  return children.length
}

interface FileTreeItemProps {
  node: FileTreeNode
  depth: number
  expandedDirs: Set<string>
  selectedPaths: Set<string>
  dropTargetPath: string | null
  onToggleExpand: (path: string) => void
  onItemClick: (node: FileTreeNode, e: React.MouseEvent) => void
  onContextMenu: (e: React.MouseEvent, node: FileTreeNode) => void
  onDragStart: (e: React.DragEvent, node: FileTreeNode) => void
  onDragEnd: () => void
  onDragOverTarget: (e: React.DragEvent, destDir: string) => void
  onDragLeaveTarget: (e: React.DragEvent, destDir: string) => void
  onDropOnTarget: (e: React.DragEvent, destDir: string) => void
  renamingPath: string | null
  onRenameSubmit: (targetPath: string, newName: string) => void | Promise<void>
  onRenameCancel: () => void
  createInput: InlineInputState | null
  onCreateSubmit: (name: string) => void | Promise<void>
  onCreateCancel: () => void
}

const TYPEAHEAD_RESET_MS = 500

function isEditableKeyboardTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return (
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.tagName === 'SELECT' ||
    target.isContentEditable
  )
}

function InlineNameInput({
  defaultName,
  isDirectory = false,
  onSubmit,
  onCancel
}: {
  defaultName: string
  isDirectory?: boolean
  onSubmit: (name: string) => void | Promise<void>
  onCancel: () => void
}) {
  const [value, setValue] = useState(defaultName)
  const inputRef = useRef<HTMLInputElement>(null)
  /** Enter / Escape 後の blur で二重確定しないようにする */
  const settledRef = useRef(false)

  useEffect(() => {
    const input = inputRef.current
    if (!input) return
    input.focus()
    const end = getNameStemSelectionEnd(defaultName, isDirectory)
    input.setSelectionRange(0, end)
  }, [defaultName, isDirectory])

  const finish = (action: 'submit' | 'cancel') => {
    if (settledRef.current) return
    settledRef.current = true
    if (action === 'cancel') {
      onCancel()
      return
    }
    const trimmed = value.trim()
    if (!trimmed) {
      onCancel()
      return
    }
    void Promise.resolve(onSubmit(trimmed)).then(
      () => {
        // 成功時は入力行がアンマウントされる想定
      },
      () => {
        // 失敗時は名前を直して再試行できるようにする
        settledRef.current = false
      }
    )
  }

  return (
    <input
      ref={inputRef}
      className="file-tree-input"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          finish('submit')
        }
        if (e.key === 'Escape') {
          e.preventDefault()
          finish('cancel')
        }
      }}
      onBlur={() => finish('submit')}
      onClick={(e) => e.stopPropagation()}
    />
  )
}

function CreateInlineRow({
  depth,
  defaultName,
  isDirectory,
  onSubmit,
  onCancel
}: {
  depth: number
  defaultName: string
  isDirectory: boolean
  onSubmit: (name: string) => void | Promise<void>
  onCancel: () => void
}) {
  return (
    <div
      className="file-tree-item creating"
      style={{ paddingLeft: depth * 12 + 8 }}
      data-tree-path={CREATE_ROW_PATH}
      onClick={(e) => e.stopPropagation()}
    >
      <span className="file-tree-expand file-tree-expand-spacer" />
      <span className="file-tree-icon">
        <FileTreeNodeIcon name={defaultName} isDirectory={isDirectory} />
      </span>
      <InlineNameInput
        defaultName={defaultName}
        isDirectory={isDirectory}
        onSubmit={onSubmit}
        onCancel={onCancel}
      />
    </div>
  )
}

function FileTreeItem({
  node,
  depth,
  expandedDirs,
  selectedPaths,
  dropTargetPath,
  onToggleExpand,
  onItemClick,
  onContextMenu,
  onDragStart,
  onDragEnd,
  onDragOverTarget,
  onDragLeaveTarget,
  onDropOnTarget,
  renamingPath,
  onRenameSubmit,
  onRenameCancel,
  createInput,
  onCreateSubmit,
  onCreateCancel
}: FileTreeItemProps) {
  const { t } = useI18n()
  const normalizedPath = normalizeNodePath(node.path)
  const isExpanded = expandedDirs.has(normalizedPath)
  const isSelected = selectedPaths.has(normalizedPath)
  const isRenaming = renamingPath === node.path
  const isDraggable = !isRenaming && !node.isPreview
  const isDropTarget =
    node.isDirectory && !node.isPreview && dropTargetPath === normalizedPath
  const ariaLevel = depth + 1

  const handleClick = (e: React.MouseEvent) => {
    if (isRenaming) return
    onItemClick(node, e)
  }

  const handleExpandClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!isRenaming) onToggleExpand(node.path)
  }

  const renderChildRows = (children: FileTreeNode[]) => {
    const childDepth = depth + 1
    const showCreate =
      createInput !== null &&
      normalizeNodePath(createInput.parentDir) === normalizedPath
    const insertAt = showCreate
      ? findCreateInsertIndex(
          children,
          createInput.defaultName,
          createInput.mode === 'create-folder'
        )
      : -1

    const createRow = showCreate ? (
      <CreateInlineRow
        key={CREATE_ROW_PATH}
        depth={childDepth}
        defaultName={createInput.defaultName}
        isDirectory={createInput.mode === 'create-folder'}
        onSubmit={onCreateSubmit}
        onCancel={onCreateCancel}
      />
    ) : null

    const rows: React.ReactNode[] = []
    children.forEach((child, index) => {
      if (createRow && index === insertAt) rows.push(createRow)
      rows.push(
        <FileTreeItem
          key={child.path}
          node={child}
          depth={childDepth}
          expandedDirs={expandedDirs}
          selectedPaths={selectedPaths}
          dropTargetPath={dropTargetPath}
          onToggleExpand={onToggleExpand}
          onItemClick={onItemClick}
          onContextMenu={onContextMenu}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          onDragOverTarget={onDragOverTarget}
          onDragLeaveTarget={onDragLeaveTarget}
          onDropOnTarget={onDropOnTarget}
          renamingPath={renamingPath}
          onRenameSubmit={onRenameSubmit}
          onRenameCancel={onRenameCancel}
          createInput={createInput}
          onCreateSubmit={onCreateSubmit}
          onCreateCancel={onCreateCancel}
        />
      )
    })
    if (createRow && insertAt === children.length) rows.push(createRow)
    return rows
  }

  if (node.isDirectory) {
    const previewClass = node.isPreview
      ? ` preview preview-${node.previewKind ?? 'new-folder'}`
      : ''
    return (
      <div role="group">
        <div
          className={`file-tree-item directory${previewClass}${isDraggable ? ' draggable' : ''}${isSelected ? ' selected' : ''}${isDropTarget ? ' drop-target' : ''}`}
          style={{ paddingLeft: depth * 12 + 8 }}
          role="treeitem"
          aria-selected={isSelected}
          aria-expanded={isExpanded}
          aria-level={ariaLevel}
          data-tree-path={normalizedPath}
          draggable={isDraggable}
          onDragStart={(e) => onDragStart(e, node)}
          onDragEnd={onDragEnd}
          onDragOver={
            node.isPreview ? undefined : (e) => onDragOverTarget(e, node.path)
          }
          onDragLeave={
            node.isPreview ? undefined : (e) => onDragLeaveTarget(e, node.path)
          }
          onDrop={node.isPreview ? undefined : (e) => onDropOnTarget(e, node.path)}
          onClick={handleClick}
          onContextMenu={(e) => onContextMenu(e, node)}
        >
          <span className="file-tree-expand" onClick={handleExpandClick}>
            {isExpanded ? <ChevronDownIcon /> : <ChevronRightIcon />}
          </span>
          <span className="file-tree-icon">
            <FileTreeNodeIcon name={node.name} isDirectory isExpanded={isExpanded} />
          </span>
          {isRenaming ? (
            <InlineNameInput
              defaultName={node.name}
              isDirectory
              onSubmit={(name) => onRenameSubmit(node.path, name)}
              onCancel={onRenameCancel}
            />
          ) : (
            <span className="file-tree-name">
              {node.name}
              {node.isPreview && (
                <span className="file-tree-preview-badge">
                  {node.previewKind === 'deleted' ? t('common.delete') : t('common.new')}
                </span>
              )}
            </span>
          )}
        </div>
        {isExpanded && renderChildRows(node.children ?? [])}
      </div>
    )
  }

  const previewClass = node.isPreview ? ` preview preview-${node.previewKind ?? 'modified'}` : ''
  const fileParentDir = parentDirPath(node.path)

  return (
    <div
      className={`file-tree-item file${previewClass}${isDraggable ? ' draggable' : ''}${isSelected ? ' selected' : ''}`}
      style={{ paddingLeft: depth * 12 + 8 }}
      role="treeitem"
      aria-selected={isSelected}
      aria-level={ariaLevel}
      data-tree-path={normalizedPath}
      draggable={isDraggable}
      onDragStart={(e) => onDragStart(e, node)}
      onDragEnd={onDragEnd}
      onDragOver={
        node.isPreview || !fileParentDir
          ? undefined
          : (e) => onDragOverTarget(e, fileParentDir)
      }
      onDragLeave={
        node.isPreview || !fileParentDir
          ? undefined
          : (e) => onDragLeaveTarget(e, fileParentDir)
      }
      onDrop={
        node.isPreview || !fileParentDir
          ? undefined
          : (e) => onDropOnTarget(e, fileParentDir)
      }
      onClick={handleClick}
      onContextMenu={(e) => onContextMenu(e, node)}
    >
      <span className="file-tree-expand file-tree-expand-spacer" />
      <span className="file-tree-icon">
        <FileTreeNodeIcon name={node.name} />
      </span>
      {isRenaming ? (
        <InlineNameInput
          defaultName={node.name}
          onSubmit={(name) => onRenameSubmit(node.path, name)}
          onCancel={onRenameCancel}
        />
      ) : (
        <span className="file-tree-name">
          {node.name}
          {node.isPreview && (
            <span className="file-tree-preview-badge">
              {node.previewKind === 'new-file'
                ? t('common.new')
                : node.previewKind === 'deleted'
                  ? t('common.delete')
                  : t('common.modified')}
            </span>
          )}
        </span>
      )}
    </div>
  )
}

export function FileTree() {
  const { t, locale } = useI18n()
  const fileTree = useAppStore((s) => s.fileTree)
  const workspaceRoot = useAppStore((s) => s.workspaceRoot)
  const persistedExplorerState = useAppStore((s) => s.persistedExplorerState)
  const pendingWorkspacePreview = useAppStore((s) => s.pendingWorkspacePreview)
  const openPreviewFile = useAppStore((s) => s.openPreviewFile)
  const setActiveFile = useAppStore((s) => s.setActiveFile)
  const renameOpenFile = useAppStore((s) => s.renameOpenFile)
  const removePaths = useAppStore((s) => s.removePaths)

  const displayTree = useMemo(() => {
    if (!workspaceRoot || !pendingWorkspacePreview) return fileTree
    return mergePreviewIntoTree(fileTree, pendingWorkspacePreview.items, workspaceRoot)
  }, [fileTree, pendingWorkspacePreview, workspaceRoot])

  const rootedTree = useMemo((): FileTreeNode[] => {
    if (!workspaceRoot) return displayTree
    return [
      {
        name: basename(workspaceRoot),
        path: workspaceRoot,
        isDirectory: true,
        children: displayTree
      }
    ]
  }, [workspaceRoot, displayTree])

  const isWorkspaceRootPath = useCallback(
    (path: string) =>
      !!workspaceRoot && normalizeNodePath(path) === normalizeNodePath(workspaceRoot),
    [workspaceRoot]
  )

  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const [createMenu, setCreateMenu] = useState<CreateMenuState | null>(null)
  const [templateMenu, setTemplateMenu] = useState<TemplateMenuState | null>(null)
  const [explorerClipboard, setExplorerClipboard] = useState<ExplorerClipboard | null>(null)
  const [docTemplates, setDocTemplates] = useState<DocTemplate[]>(() => listDocTemplates(locale))
  const [templateManagerOpen, setTemplateManagerOpen] = useState(false)
  const [inlineInput, setInlineInput] = useState<InlineInputState | null>(null)
  const [renamingPath, setRenamingPath] = useState<string | null>(null)
  const [pendingDeleteTargets, setPendingDeleteTargets] = useState<FileTreeNode[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(() => new Set())
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(() => new Set())
  const [dropTargetPath, setDropTargetPath] = useState<string | null>(null)
  const lastSelectedPathRef = useRef<string | null>(null)
  const focusedPathRef = useRef<string | null>(null)
  const treeContentRef = useRef<HTMLDivElement>(null)
  const typeaheadRef = useRef<{ query: string; timeoutId: number | null }>({
    query: '',
    timeoutId: null
  })
  const treeInitializedRef = useRef(false)
  const persistExpandedReadyRef = useRef(false)
  const draggingPathsRef = useRef<string[] | null>(null)
  const createMenuRef = useRef<HTMLDivElement>(null)
  const templateMenuRef = useRef<HTMLDivElement>(null)
  const contextMenuRef = useRef<HTMLDivElement>(null)
  const docTemplatesRef = useRef(docTemplates)
  docTemplatesRef.current = docTemplates

  useEffect(() => {
    let cancelled = false
    void listEffectiveDocTemplates(workspaceRoot, locale).then((list) => {
      if (!cancelled) setDocTemplates(list)
    })
    return () => {
      cancelled = true
    }
  }, [workspaceRoot, locale])

  useEffect(() => {
    treeInitializedRef.current = false
    persistExpandedReadyRef.current = false
    setSelectedPaths(new Set())
    lastSelectedPathRef.current = null
    focusedPathRef.current = null
    setExpandedDirs(workspaceRoot ? getDefaultExpandedDirs(workspaceRoot) : new Set())
    setDropTargetPath(null)
    setExplorerClipboard(null)
    draggingPathsRef.current = null
  }, [workspaceRoot])

  useEffect(() => {
    if (!workspaceRoot) return
    if (persistedExplorerState === undefined) {
      treeInitializedRef.current = false
      persistExpandedReadyRef.current = false
      return
    }
    if (treeInitializedRef.current) return

    const knownDirs = new Set(collectDirectoryPaths(rootedTree))
    knownDirs.add(normalizeNodePath(workspaceRoot))
    const knownNodes = new Set(collectAllNodePaths(rootedTree))
    knownNodes.add(normalizeNodePath(workspaceRoot))

    if (persistedExplorerState === null) {
      setExpandedDirs(getDefaultExpandedDirs(workspaceRoot))
      setSelectedPaths(new Set())
      lastSelectedPathRef.current = null
      focusedPathRef.current = null
    } else {
      const selected = filterExistingPaths(persistedExplorerState.selectedPaths, knownNodes)
      let expanded = filterExistingPaths(persistedExplorerState.expandedDirs, knownDirs)
      expanded = ensureAncestorsExpanded(expanded, selected, workspaceRoot)
      setExpandedDirs(expanded)
      setSelectedPaths(selected)
      const last = persistedExplorerState.lastSelectedPath
        ? normalizeNodePath(persistedExplorerState.lastSelectedPath)
        : null
      const focus =
        last && selected.has(last) ? last : ([...selected][selected.size - 1] ?? null)
      lastSelectedPathRef.current = focus
      focusedPathRef.current = focus
    }
    treeInitializedRef.current = true
    persistExpandedReadyRef.current = true
  }, [workspaceRoot, persistedExplorerState, rootedTree])

  useEffect(() => {
    if (!workspaceRoot || !persistExpandedReadyRef.current) return
    const handle = window.setTimeout(() => {
      void window.compass.explorerState.save(workspaceRoot, {
        version: 1,
        expandedDirs: [...expandedDirs],
        selectedPaths: [...selectedPaths],
        lastSelectedPath: lastSelectedPathRef.current
      })
    }, 300)
    return () => window.clearTimeout(handle)
  }, [workspaceRoot, expandedDirs, selectedPaths])

  const visibleNodes = useMemo(
    () => collectVisibleNodes(rootedTree, expandedDirs),
    [rootedTree, expandedDirs]
  )

  const refreshTree = useCallback(async () => {
    // Always read from the store so memoized handlers never call a stale no-op refresh.
    const root = useAppStore.getState().workspaceRoot
    if (!root) return
    const tree = await window.compass.fs.readDir(root)
    useAppStore.getState().setFileTree(tree)
    void buildWorkspaceIndex(root)
  }, [])

  const handleOpenFile = async (path: string) => {
    const previewItem = pendingWorkspacePreview?.items.find(
      (item): item is Extract<typeof item, { type: 'writeFile' }> =>
        item.type === 'writeFile' && item.path.replace(/\\/g, '/') === path.replace(/\\/g, '/')
    )

    if (previewItem) {
      openPreviewFile(previewItem.path, previewItem.newContent, previewItem.oldContent, previewItem.isNew)
      return
    }

    const openFiles = useAppStore.getState().openFiles
    const existingPreview = openFiles.find(
      (f) => f.path.replace(/\\/g, '/') === path.replace(/\\/g, '/') && f.isPreview
    )
    if (existingPreview) {
      setActiveFile(path)
      return
    }

    await openWorkspaceFile(path)
  }

  const handleToggleExpand = useCallback((path: string) => {
    const normalized = normalizeNodePath(path)
    const wasExpanded = expandedDirs.has(normalized)
    setExpandedDirs((prev) => {
      const next = new Set(prev)
      if (wasExpanded) next.delete(normalized)
      else next.add(normalized)
      return next
    })
    if (wasExpanded) {
      setInlineInput((current) => {
        if (!current) return current
        const parentNorm = normalizeNodePath(current.parentDir)
        if (parentNorm === normalized || parentNorm.startsWith(`${normalized}/`)) {
          return null
        }
        return current
      })
    }
  }, [expandedDirs])

  const setDirExpanded = useCallback((path: string, expanded: boolean) => {
    const normalized = normalizeNodePath(path)
    setExpandedDirs((prev) => {
      const next = new Set(prev)
      if (expanded) next.add(normalized)
      else next.delete(normalized)
      return next
    })
  }, [])

  const scrollTreePathIntoView = useCallback((path: string) => {
    const normalized = normalizeNodePath(path)
    requestAnimationFrame(() => {
      const root = treeContentRef.current
      if (!root) return
      const escaped =
        typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
          ? CSS.escape(normalized)
          : normalized.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
      const el = root.querySelector(`[data-tree-path="${escaped}"]`)
      el?.scrollIntoView({ block: 'nearest' })
    })
  }, [])

  const focusTreeContent = useCallback(() => {
    requestAnimationFrame(() => {
      treeContentRef.current?.focus({ preventScroll: true })
    })
  }, [])

  /** キーボード/マウスコモンの選択移動。range 時はアンカーを維持 */
  const moveSelectionTo = useCallback(
    (path: string, options?: { range?: boolean }) => {
      const normalized = normalizeNodePath(path)
      focusedPathRef.current = normalized

      if (options?.range && lastSelectedPathRef.current) {
        const visiblePaths = visibleNodes.map((n) => normalizeNodePath(n.path))
        const anchorIdx = visiblePaths.indexOf(lastSelectedPathRef.current)
        const focusIdx = visiblePaths.indexOf(normalized)
        if (anchorIdx >= 0 && focusIdx >= 0) {
          const start = Math.min(anchorIdx, focusIdx)
          const end = Math.max(anchorIdx, focusIdx)
          setSelectedPaths(new Set(visiblePaths.slice(start, end + 1)))
          scrollTreePathIntoView(normalized)
          return
        }
      }

      setSelectedPaths(new Set([normalized]))
      lastSelectedPathRef.current = normalized
      scrollTreePathIntoView(normalized)
    },
    [visibleNodes, scrollTreePathIntoView]
  )

  const handleExpandAll = () => {
    setExpandedDirs(new Set(collectDirectoryPaths(rootedTree)))
  }

  const handleCollapseAll = () => {
    setExpandedDirs(new Set())
    setInlineInput(null)
  }

  const closeAllMenus = useCallback(() => {
    setContextMenu(null)
    setCreateMenu(null)
    setTemplateMenu(null)
  }, [])

  const isAnyMenuOpen = contextMenu !== null || createMenu !== null || templateMenu !== null

  const handleItemClick = useCallback(
    (node: FileTreeNode, e: React.MouseEvent) => {
      closeAllMenus()
      focusTreeContent()
      const normalized = normalizeNodePath(node.path)

      if (e.ctrlKey || e.metaKey) {
        setSelectedPaths((prev) => {
          const next = new Set(prev)
          if (next.has(normalized)) next.delete(normalized)
          else next.add(normalized)
          return next
        })
        lastSelectedPathRef.current = normalized
        focusedPathRef.current = normalized
        return
      }

      if (e.shiftKey && lastSelectedPathRef.current) {
        const visiblePaths = visibleNodes.map((n) => normalizeNodePath(n.path))
        const anchorIdx = visiblePaths.indexOf(lastSelectedPathRef.current)
        const clickIdx = visiblePaths.indexOf(normalized)
        if (anchorIdx >= 0 && clickIdx >= 0) {
          const start = Math.min(anchorIdx, clickIdx)
          const end = Math.max(anchorIdx, clickIdx)
          const range = visiblePaths.slice(start, end + 1)
          setSelectedPaths(new Set(range))
          focusedPathRef.current = normalized
          return
        }
      }

      setSelectedPaths(new Set([normalized]))
      lastSelectedPathRef.current = normalized
      focusedPathRef.current = normalized

      if (node.isDirectory) {
        handleToggleExpand(node.path)
      } else {
        void handleOpenFile(node.path)
      }
    },
    [handleToggleExpand, visibleNodes, closeAllMenus, focusTreeContent]
  )

  const getDeleteTargets = useCallback(
    (contextNode: FileTreeNode | null): FileTreeNode[] => {
      if (selectedPaths.size > 0) {
        const selectedNodes = visibleNodes.filter((n) =>
          selectedPaths.has(normalizeNodePath(n.path))
        )
        const topLevelPaths = filterTopLevelPaths([...selectedPaths])
        return selectedNodes.filter(
          (n) =>
            topLevelPaths.includes(normalizeNodePath(n.path)) &&
            !n.isPreview &&
            !isWorkspaceRootPath(n.path)
        )
      }
      if (contextNode && !contextNode.isPreview && !isWorkspaceRootPath(contextNode.path)) {
        return [contextNode]
      }
      return []
    },
    [selectedPaths, visibleNodes, isWorkspaceRootPath]
  )

  const getChatAttachTargets = useCallback(
    (contextNode: FileTreeNode | null): FileTreeNode[] => {
      if (selectedPaths.size > 0) {
        const selectedNodes = visibleNodes.filter(
          (n) => selectedPaths.has(normalizeNodePath(n.path)) && !n.isPreview
        )
        if (selectedNodes.length === 0) return []
        const topLevelPaths = filterTopLevelPaths(
          selectedNodes.map((n) => normalizeNodePath(n.path))
        )
        return selectedNodes.filter((n) =>
          topLevelPaths.includes(normalizeNodePath(n.path))
        )
      }
      if (contextNode && !contextNode.isPreview) {
        return [contextNode]
      }
      return []
    },
    [selectedPaths, visibleNodes]
  )

  const getMoveSourcePaths = useCallback(
    (dragNode: FileTreeNode): string[] => {
      if (isWorkspaceRootPath(dragNode.path)) return []
      const normalized = normalizeNodePath(dragNode.path)
      if (selectedPaths.has(normalized) && selectedPaths.size > 1) {
        const selectedNodes = visibleNodes.filter(
          (n) =>
            selectedPaths.has(normalizeNodePath(n.path)) &&
            !n.isPreview &&
            !isWorkspaceRootPath(n.path)
        )
        const topLevelPaths = filterTopLevelPaths(
          selectedNodes.map((n) => normalizeNodePath(n.path))
        )
        return selectedNodes
          .filter((n) => topLevelPaths.includes(normalizeNodePath(n.path)))
          .map((n) => n.path)
      }
      return [dragNode.path]
    },
    [selectedPaths, visibleNodes, isWorkspaceRootPath]
  )

  const copyTargetsToClipboard = useCallback(
    (contextNode: FileTreeNode | null, mode: 'copy' | 'cut') => {
      const targets = getDeleteTargets(contextNode)
      if (targets.length === 0) return
      setExplorerClipboard({
        mode,
        paths: targets.map((n) => n.path)
      })
      setContextMenu(null)
      setError(null)
    },
    [getDeleteTargets]
  )

  const pasteClipboard = useCallback(
    async (destDir: string) => {
      if (!explorerClipboard || explorerClipboard.paths.length === 0) return
      setContextMenu(null)
      setCreateMenu(null)
      setTemplateMenu(null)

      const sources = filterTopLevelPaths(explorerClipboard.paths)
      if (sources.length === 0) return

      try {
        if (explorerClipboard.mode === 'copy') {
          const created = await window.compass.fs.copy(sources, destDir)
          if (created.length === 0) return
          const createdNorm = created.map(normalizeNodePath)
          setSelectedPaths(new Set(createdNorm))
          const focus = createdNorm[createdNorm.length - 1] ?? null
          lastSelectedPathRef.current = focus
          focusedPathRef.current = focus
          setExpandedDirs((prev) => {
            const next = new Set(prev)
            next.add(normalizeNodePath(destDir))
            return next
          })
          await refreshTree()
        } else {
          const moves: Array<{ from: string; to: string }> = []
          for (const source of sources) {
            if (!canMoveInto([source], destDir)) {
              throw new Error(t('fs.cannotMoveIntoSelf'))
            }
            const newPath = await window.compass.fs.move(source, destDir)
            if (newPath !== source) {
              renameOpenFile(source, newPath)
              moves.push({ from: source, to: newPath })
            }
          }
          setExplorerClipboard(null)
          if (moves.length > 0) {
            const movedPaths = moves.map((m) => normalizeNodePath(m.to))
            setSelectedPaths(new Set(movedPaths))
            const focus = movedPaths[movedPaths.length - 1] ?? null
            lastSelectedPathRef.current = focus
            focusedPathRef.current = focus
            setExpandedDirs((prev) => {
              const next = new Set(prev)
              next.add(normalizeNodePath(destDir))
              for (const { from, to } of moves) {
                const fromNorm = normalizeNodePath(from)
                const toNorm = normalizeNodePath(to)
                for (const path of [...next]) {
                  if (path === fromNorm) {
                    next.delete(path)
                    next.add(toNorm)
                  } else if (path.startsWith(`${fromNorm}/`)) {
                    next.delete(path)
                    next.add(toNorm + path.slice(fromNorm.length))
                  }
                }
              }
              return next
            })
            await refreshTree()
          }
        }
        setError(null)
      } catch (err) {
        setError(
          getErrorMessage(
            err,
            explorerClipboard.mode === 'copy' ? t('explorer.copyFailed') : t('explorer.pasteFailed')
          )
        )
        await refreshTree()
      } finally {
        focusTreeContent()
      }
    },
    [explorerClipboard, renameOpenFile, refreshTree, t, focusTreeContent]
  )

  const requestDelete = useCallback(
    (contextNode: FileTreeNode | null) => {
      setContextMenu(null)
      const targets = getDeleteTargets(contextNode)
      if (targets.length === 0) return
      setPendingDeleteTargets(targets)
    },
    [getDeleteTargets]
  )

  const addTargetsToChat = useCallback(
    (contextNode: FileTreeNode | null) => {
      setContextMenu(null)
      const targets = getChatAttachTargets(contextNode)
      if (targets.length === 0) return

      const refs = targets.map(toChatContextRef)
      const store = useAppStore.getState()
      store.addChatContextRefs(refs)
      store.requestChatComposerInsert(
        refs.map((ref) =>
          formatContextMention(ref.path, ref.isDirectory, store.workspaceRoot)
        )
      )
    },
    [getChatAttachTargets]
  )

  const showItemInFolder = useCallback(
    async (node: FileTreeNode) => {
      setContextMenu(null)
      if (node.isPreview) return
      try {
        await window.compass.shell.showItemInFolder(node.path)
        setError(null)
      } catch (err) {
        setError(getErrorMessage(err, t('explorer.showInOsExplorerFailed')))
      }
    },
    [t]
  )

  const openWithDefaultApp = useCallback(
    async (node: FileTreeNode) => {
      setContextMenu(null)
      if (node.isPreview || node.isDirectory) return
      try {
        await window.compass.shell.openPath(node.path)
        setError(null)
      } catch (err) {
        setError(getErrorMessage(err, t('explorer.openWithDefaultAppFailed')))
      }
    },
    [t]
  )

  const cancelPendingDelete = useCallback(() => {
    setPendingDeleteTargets(null)
    focusTreeContent()
  }, [focusTreeContent])

  const confirmPendingDelete = useCallback(async () => {
    const targets = pendingDeleteTargets
    setPendingDeleteTargets(null)
    if (!targets || targets.length === 0) {
      focusTreeContent()
      return
    }

    try {
      for (const target of targets) {
        await window.compass.fs.delete(target.path)
        removePaths(target.path)
      }
      setSelectedPaths(new Set())
      lastSelectedPathRef.current = null
      focusedPathRef.current = null
      setExpandedDirs((prev) => {
        const next = new Set(prev)
        for (const target of targets) {
          const normalized = normalizeNodePath(target.path)
          for (const path of [...next]) {
            if (path === normalized || path.startsWith(`${normalized}/`)) {
              next.delete(path)
            }
          }
        }
        return next
      })
      await refreshTree()
      setError(null)
    } catch (err) {
      setError(getErrorMessage(err, t('explorer.deleteFailed')))
      await refreshTree()
    } finally {
      focusTreeContent()
    }
  }, [pendingDeleteTargets, removePaths, refreshTree, t, focusTreeContent])

  const handleNodeDragStart = useCallback(
    (e: React.DragEvent, node: FileTreeNode) => {
      if (node.isPreview) {
        e.preventDefault()
        return
      }

      const normalized = normalizeNodePath(node.path)
      const chatTargets =
        selectedPaths.has(normalized) && selectedPaths.size > 1
          ? getChatAttachTargets(node)
          : [node]
      const chatPayload = serializeChatContextRefs(chatTargets.map(toChatContextRef))
      e.dataTransfer.setData(CHAT_CONTEXT_DRAG_MIME, chatPayload)
      // Unicode パス向けフォールバック（カスタム MIME が空になる環境対策）
      e.dataTransfer.setData('text/plain', chatPayload)

      // Workspace root can be attached to chat, but must not be moved in the tree.
      if (isWorkspaceRootPath(node.path)) {
        draggingPathsRef.current = null
        e.dataTransfer.effectAllowed = 'copy'
        return
      }

      const movePaths = getMoveSourcePaths(node)
      if (movePaths.length === 0) {
        draggingPathsRef.current = null
        e.dataTransfer.effectAllowed = 'copy'
        return
      }

      draggingPathsRef.current = movePaths
      e.dataTransfer.setData(FILE_MOVE_DRAG_MIME, serializeFileMovePaths(movePaths))
      e.dataTransfer.effectAllowed = 'copyMove'
    },
    [getChatAttachTargets, getMoveSourcePaths, isWorkspaceRootPath, selectedPaths]
  )

  const handleNodeDragEnd = useCallback(() => {
    draggingPathsRef.current = null
    setDropTargetPath(null)
  }, [])

  const handleDragOverTarget = useCallback((e: React.DragEvent, destDir: string) => {
    if (!hasFileMoveDrag(e.dataTransfer)) return
    const sources = draggingPathsRef.current
    if (!sources || !canMoveInto(sources, destDir)) return

    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = 'move'
    setDropTargetPath(normalizeNodePath(destDir))
  }, [])

  const handleDragLeaveTarget = useCallback((e: React.DragEvent, destDir: string) => {
    const related = e.relatedTarget as Node | null
    if (related && e.currentTarget.contains(related)) return
    setDropTargetPath((prev) =>
      prev === normalizeNodePath(destDir) ? null : prev
    )
  }, [])

  const handleDropOnTarget = useCallback(
    async (e: React.DragEvent, destDir: string) => {
      if (!hasFileMoveDrag(e.dataTransfer)) return
      e.preventDefault()
      e.stopPropagation()
      setDropTargetPath(null)

      const sources =
        parseFileMovePaths(e.dataTransfer) ?? draggingPathsRef.current
      draggingPathsRef.current = null
      if (!sources || !canMoveInto(sources, destDir)) return

      try {
        const moves: Array<{ from: string; to: string }> = []
        for (const source of sources) {
          if (!canMoveInto([source], destDir)) continue
          const newPath = await window.compass.fs.move(source, destDir)
          if (newPath !== source) {
            renameOpenFile(source, newPath)
            moves.push({ from: source, to: newPath })
          }
        }

        if (moves.length > 0) {
          const movedPaths = moves.map((m) => normalizeNodePath(m.to))
          setSelectedPaths(new Set(movedPaths))
          const focus = movedPaths[movedPaths.length - 1] ?? null
          lastSelectedPathRef.current = focus
          focusedPathRef.current = focus
          setExpandedDirs((prev) => {
            const next = new Set(prev)
            next.add(normalizeNodePath(destDir))
            for (const { from, to } of moves) {
              const fromNorm = normalizeNodePath(from)
              const toNorm = normalizeNodePath(to)
              for (const path of [...next]) {
                if (path === fromNorm) {
                  next.delete(path)
                  next.add(toNorm)
                } else if (path.startsWith(`${fromNorm}/`)) {
                  next.delete(path)
                  next.add(toNorm + path.slice(fromNorm.length))
                }
              }
            }
            return next
          })
          await refreshTree()
        }
        setError(null)
      } catch (err) {
        setError(getErrorMessage(err, t('explorer.moveFailed')))
        await refreshTree()
      }
    },
    [renameOpenFile, refreshTree, t]
  )

  const startCreate = (mode: 'create-file' | 'create-folder', parentDir: string) => {
    setContextMenu(null)
    setCreateMenu(null)
    setTemplateMenu(null)
    setRenamingPath(null)
    setExpandedDirs((prev) => {
      let next = new Set(prev)
      next.add(normalizeNodePath(parentDir))
      if (workspaceRoot) {
        next = ensureAncestorsExpanded(next, [parentDir], workspaceRoot)
      }
      return next
    })
    const preferredName =
      mode === 'create-file' ? t('explorer.defaultNewTextFile') : t('explorer.defaultNewFolder')
    const defaultName = buildUniqueFileName(preferredName, listChildNames(rootedTree, parentDir))
    setInlineInput({
      mode,
      parentDir,
      defaultName
    })
    setError(null)
  }

  const openCreateMenu = (parentDir: string, x: number, y: number) => {
    setContextMenu(null)
    setTemplateMenu(null)
    setCreateMenu({ parentDir, x, y })
    setError(null)
  }

  /** 右クリックメニューから「新規…」をフライアウトで開く（親メニューは残す） */
  const openCreateSubmenu = (parentDir: string, anchor: HTMLElement) => {
    const rect = anchor.getBoundingClientRect()
    setTemplateMenu(null)
    setCreateMenu({ parentDir, x: rect.right + 1, y: rect.top })
    setError(null)
  }

  const openTemplateSubmenu = (parentDir: string, anchor: HTMLElement) => {
    const rect = anchor.getBoundingClientRect()
    setTemplateMenu({ parentDir, x: rect.right + 1, y: rect.top })
    setError(null)
    void listEffectiveDocTemplates(workspaceRoot, locale).then(setDocTemplates)
  }

  const closeTemplateSubmenu = () => {
    setTemplateMenu(null)
  }

  const closeCreateSubmenu = () => {
    setCreateMenu(null)
    setTemplateMenu(null)
  }

  const handleContextMenuMouseLeave = (e: React.MouseEvent) => {
    const related = e.relatedTarget as Node | null
    if (related && createMenuRef.current?.contains(related)) return
    if (related && templateMenuRef.current?.contains(related)) return
    closeCreateSubmenu()
  }

  const handleCreateMenuMouseLeave = (e: React.MouseEvent) => {
    const related = e.relatedTarget as Node | null
    if (related && templateMenuRef.current?.contains(related)) return
    if (related && contextMenuRef.current?.contains(related)) {
      closeTemplateSubmenu()
      return
    }
    closeTemplateSubmenu()
    // 右クリック由来のフライアウトは、メニュー群から外れたら閉じる
    if (contextMenu) closeCreateSubmenu()
  }

  const handleTemplateMenuMouseLeave = (e: React.MouseEvent) => {
    const related = e.relatedTarget as Node | null
    if (related && createMenuRef.current?.contains(related)) return
    if (related && contextMenuRef.current?.contains(related)) {
      closeTemplateSubmenu()
      return
    }
    closeTemplateSubmenu()
  }

  const expandParentDir = useCallback((parentDir: string) => {
    setExpandedDirs((prev) => {
      const next = new Set(prev)
      next.add(normalizeNodePath(parentDir))
      return next
    })
  }, [])

  const selectTreePaths = useCallback((paths: string[]) => {
    if (paths.length === 0) return
    const normalized = paths.map((path) => normalizeNodePath(path))
    setSelectedPaths(new Set(normalized))
    const focus = normalized[normalized.length - 1] ?? null
    lastSelectedPathRef.current = focus
    focusedPathRef.current = focus
    if (focus) scrollTreePathIntoView(focus)
  }, [scrollTreePathIntoView])

  const importFromFile = async (parentDir: string) => {
    setCreateMenu(null)
    setContextMenu(null)
    setTemplateMenu(null)

    try {
      const picked = await window.compass.fs.pickFiles()
      if (!picked || picked.length === 0) return

      const createdPaths = await window.compass.fs.importFiles(parentDir, picked)
      if (createdPaths.length === 0) return

      expandParentDir(parentDir)
      await refreshTree()
      selectTreePaths(createdPaths)
      await handleOpenFile(createdPaths[0])
      setError(null)
    } catch (err) {
      setError(getErrorMessage(err, t('explorer.importFailed')))
    }
  }

  const getToolbarCreateParentDir = () =>
    resolveCreateParentFromSelection(
      selectedPaths,
      lastSelectedPathRef.current,
      rootedTree,
      workspaceRoot!
    )

  const createFromTemplate = async (parentDir: string, templateId: string) => {
    setTemplateMenu(null)
    setContextMenu(null)
    setCreateMenu(null)
    const template =
      docTemplatesRef.current.find((item) => item.id === templateId) ??
      (await listEffectiveDocTemplates(workspaceRoot, locale)).find((item) => item.id === templateId)
    if (!template) return

    const existingNames = listChildNames(rootedTree, parentDir)
    const fileName = buildUniqueTemplateFileName(template.defaultFileName, existingNames)

    try {
      const createdPath = await window.compass.fs.createFile(parentDir, fileName)
      await window.compass.fs.writeFile(createdPath, template.body)
      expandParentDir(parentDir)
      await refreshTree()
      selectTreePaths([createdPath])
      await handleOpenFile(createdPath)
      setError(null)
    } catch (err) {
      setError(getErrorMessage(err, t('explorer.createFailed')))
    }
  }

  const startRename = useCallback((node: FileTreeNode) => {
    if (node.isPreview || isWorkspaceRootPath(node.path)) return
    setContextMenu(null)
    setCreateMenu(null)
    setTemplateMenu(null)
    setInlineInput(null)
    setRenamingPath(node.path)
    setError(null)
  }, [isWorkspaceRootPath])

  const handleCreateSubmit = async (name: string) => {
    if (!inlineInput) {
      throw new Error(t('explorer.createFailed'))
    }
    try {
      let createdPath: string
      if (inlineInput.mode === 'create-file') {
        createdPath = await window.compass.fs.createFile(inlineInput.parentDir, name)
        await refreshTree()
        selectTreePaths([createdPath])
        await handleOpenFile(createdPath)
      } else {
        createdPath = await window.compass.fs.createDirectory(inlineInput.parentDir, name)
        await refreshTree()
        selectTreePaths([createdPath])
      }
      setInlineInput(null)
      setError(null)
      focusTreeContent()
    } catch (err) {
      setError(getErrorMessage(err, t('explorer.createFailed')))
      requestAnimationFrame(() => {
        treeContentRef.current
          ?.querySelector<HTMLInputElement>('.file-tree-input')
          ?.focus()
      })
      throw err
    }
  }

  const handleCreateCancel = useCallback(() => {
    setInlineInput(null)
    focusTreeContent()
  }, [focusTreeContent])

  useEffect(() => {
    if (!inlineInput) return
    scrollTreePathIntoView(CREATE_ROW_PATH)
  }, [inlineInput, scrollTreePathIntoView])

  const handleRenameSubmit = async (targetPath: string, newName: string) => {
    try {
      const newPath = await window.compass.fs.rename(targetPath, newName)
      renameOpenFile(targetPath, newPath)
      await refreshTree()
      setRenamingPath(null)
      selectTreePaths([newPath])
      setError(null)
      focusTreeContent()
    } catch (err) {
      setError(getErrorMessage(err, t('explorer.renameFailed')))
      requestAnimationFrame(() => {
        treeContentRef.current
          ?.querySelector<HTMLInputElement>('.file-tree-input')
          ?.focus()
      })
      throw err
    }
  }

  const handleRenameCancel = useCallback(() => {
    setRenamingPath(null)
    focusTreeContent()
  }, [focusTreeContent])

  const handleContextMenu = (e: React.MouseEvent, node: FileTreeNode) => {
    e.preventDefault()
    e.stopPropagation()
    const normalized = normalizeNodePath(node.path)
    if (!selectedPaths.has(normalized)) {
      setSelectedPaths(new Set([normalized]))
      lastSelectedPathRef.current = normalized
      focusedPathRef.current = normalized
    } else {
      focusedPathRef.current = normalized
    }
    focusTreeContent()
    setCreateMenu(null)
    setTemplateMenu(null)
    setContextMenu({ x: e.clientX, y: e.clientY, node })
  }

  const handleRootContextMenu = (e: React.MouseEvent) => {
    if (!workspaceRoot) return
    e.preventDefault()
    setCreateMenu(null)
    setTemplateMenu(null)
    setContextMenu({ x: e.clientX, y: e.clientY, node: null })
  }

  const handleContentClick = () => {
    setSelectedPaths(new Set())
    lastSelectedPathRef.current = null
    focusedPathRef.current = null
    closeAllMenus()
  }

  useEffect(() => {
    if (!isAnyMenuOpen) return

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node
      if (createMenuRef.current?.contains(target)) return
      if (templateMenuRef.current?.contains(target)) return
      if (contextMenuRef.current?.contains(target)) return
      closeAllMenus()
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeAllMenus()
    }

    const handleScroll = () => closeAllMenus()

    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    window.addEventListener('scroll', handleScroll, true)

    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('scroll', handleScroll, true)
    }
  }, [isAnyMenuOpen, closeAllMenus])

  useEffect(() => {
    return () => {
      if (typeaheadRef.current.timeoutId != null) {
        window.clearTimeout(typeaheadRef.current.timeoutId)
      }
    }
  }, [])

  const resetTypeahead = useCallback(() => {
    if (typeaheadRef.current.timeoutId != null) {
      window.clearTimeout(typeaheadRef.current.timeoutId)
      typeaheadRef.current.timeoutId = null
    }
    typeaheadRef.current.query = ''
  }, [])

  const handleTreeKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (isEditableKeyboardTarget(e.target)) return
      if (pendingDeleteTargets || inlineInput || renamingPath || isAnyMenuOpen) return
      if (visibleNodes.length === 0) return

      const visiblePaths = visibleNodes.map((n) => normalizeNodePath(n.path))
      const currentPath =
        focusedPathRef.current && visiblePaths.includes(focusedPathRef.current)
          ? focusedPathRef.current
          : lastSelectedPathRef.current && visiblePaths.includes(lastSelectedPathRef.current)
            ? lastSelectedPathRef.current
            : (visiblePaths[0] ?? null)
      const currentIndex = currentPath ? visiblePaths.indexOf(currentPath) : -1

      const activateIndex = (index: number, range: boolean) => {
        if (index < 0 || index >= visibleNodes.length) return
        moveSelectionTo(visibleNodes[index].path, { range })
      }

      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        resetTypeahead()
        if (currentIndex < 0) {
          activateIndex(0, false)
          return
        }
        const delta = e.key === 'ArrowDown' ? 1 : -1
        const nextIndex = Math.max(0, Math.min(visibleNodes.length - 1, currentIndex + delta))
        activateIndex(nextIndex, e.shiftKey)
        return
      }

      if (e.key === 'Home' || e.key === 'End') {
        e.preventDefault()
        resetTypeahead()
        activateIndex(e.key === 'Home' ? 0 : visibleNodes.length - 1, e.shiftKey)
        return
      }

      if (e.key === 'ArrowRight') {
        e.preventDefault()
        resetTypeahead()
        if (currentIndex < 0) {
          activateIndex(0, false)
          return
        }
        const node = visibleNodes[currentIndex]
        if (!node.isDirectory) return
        const normalized = normalizeNodePath(node.path)
        if (!expandedDirs.has(normalized)) {
          setDirExpanded(node.path, true)
          return
        }
        if (node.children && node.children.length > 0) {
          moveSelectionTo(node.children[0].path)
        }
        return
      }

      if (e.key === 'ArrowLeft') {
        e.preventDefault()
        resetTypeahead()
        if (currentIndex < 0) {
          activateIndex(0, false)
          return
        }
        const node = visibleNodes[currentIndex]
        const normalized = normalizeNodePath(node.path)
        if (node.isDirectory && expandedDirs.has(normalized)) {
          setDirExpanded(node.path, false)
          return
        }
        const parent = parentDirPath(normalized)
        if (parent && visiblePaths.includes(normalizeNodePath(parent))) {
          moveSelectionTo(parent)
        }
        return
      }

      if (e.key === 'Enter') {
        e.preventDefault()
        resetTypeahead()
        if (currentIndex < 0) return
        const node = visibleNodes[currentIndex]
        moveSelectionTo(node.path)
        if (node.isDirectory) {
          handleToggleExpand(node.path)
        } else {
          void handleOpenFile(node.path)
        }
        return
      }

      if (e.key === 'F2') {
        if (selectedPaths.size !== 1) return
        const selectedPath = [...selectedPaths][0]
        const node = visibleNodes.find((n) => normalizeNodePath(n.path) === selectedPath)
        if (!node) return
        e.preventDefault()
        resetTypeahead()
        startRename(node)
        return
      }

      if (e.key === 'Delete') {
        if (selectedPaths.size === 0) return
        e.preventDefault()
        resetTypeahead()
        requestDelete(null)
        return
      }

      if ((e.ctrlKey || e.metaKey) && !e.altKey) {
        const key = e.key.toLowerCase()
        if (key === 'c') {
          if (getDeleteTargets(null).length === 0) return
          e.preventDefault()
          resetTypeahead()
          copyTargetsToClipboard(null, 'copy')
          return
        }
        if (key === 'x') {
          if (getDeleteTargets(null).length === 0) return
          e.preventDefault()
          resetTypeahead()
          copyTargetsToClipboard(null, 'cut')
          return
        }
        if (key === 'v') {
          if (!explorerClipboard || explorerClipboard.paths.length === 0 || !workspaceRoot) return
          e.preventDefault()
          resetTypeahead()
          const destDir = resolveCreateParentFromSelection(
            selectedPaths,
            lastSelectedPathRef.current,
            rootedTree,
            workspaceRoot
          )
          void pasteClipboard(destDir)
          return
        }
      }

      // タイプサーチ（印字可能文字）
      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault()
        const nextQuery = (typeaheadRef.current.query + e.key).toLowerCase()
        typeaheadRef.current.query = nextQuery
        if (typeaheadRef.current.timeoutId != null) {
          window.clearTimeout(typeaheadRef.current.timeoutId)
        }
        typeaheadRef.current.timeoutId = window.setTimeout(() => {
          typeaheadRef.current.query = ''
          typeaheadRef.current.timeoutId = null
        }, TYPEAHEAD_RESET_MS)

        const startFrom = currentIndex >= 0 ? currentIndex + 1 : 0
        const order = [
          ...visibleNodes.slice(startFrom),
          ...visibleNodes.slice(0, startFrom)
        ]
        const match = order.find((n) => n.name.toLowerCase().startsWith(nextQuery))
        if (match) moveSelectionTo(match.path)
      }
    },
    [
      pendingDeleteTargets,
      inlineInput,
      renamingPath,
      isAnyMenuOpen,
      visibleNodes,
      expandedDirs,
      moveSelectionTo,
      setDirExpanded,
      handleToggleExpand,
      selectedPaths,
      startRename,
      requestDelete,
      resetTypeahead,
      getDeleteTargets,
      copyTargetsToClipboard,
      explorerClipboard,
      workspaceRoot,
      rootedTree,
      pasteClipboard
    ]
  )

  if (!workspaceRoot) {
    return (
      <div className="file-tree-empty">
        <p>{t('explorer.noFolder')}</p>
        <p className="hint">{t('explorer.openFolderHint')}</p>
      </div>
    )
  }

  const parentDir = resolveCreateParentDir(contextMenu?.node ?? null, workspaceRoot)

  const deleteTargets = contextMenu ? getDeleteTargets(contextMenu.node) : []
  const chatAttachTargets = contextMenu ? getChatAttachTargets(contextMenu.node) : []
  const canRename =
    contextMenu?.node &&
    deleteTargets.length === 1 &&
    !contextMenu.node.isPreview &&
    !isWorkspaceRootPath(contextMenu.node.path)
  const canDelete = deleteTargets.length > 0 && deleteTargets.every((n) => !n.isPreview)
  const canCopyOrCut = canDelete
  const canPaste = Boolean(explorerClipboard && explorerClipboard.paths.length > 0)
  const canAddToChat = chatAttachTargets.length > 0
  const canShowInOsExplorer = Boolean(contextMenu?.node && !contextMenu.node.isPreview)
  const canOpenWithDefaultApp = Boolean(
    contextMenu?.node && !contextMenu.node.isPreview && !contextMenu.node.isDirectory
  )
  const isRootDropTarget = dropTargetPath === normalizeNodePath(workspaceRoot)

  return (
    <div className="file-tree">
      <div className="panel-header file-tree-header">
        <div className="file-tree-toolbar">
          <button className="btn-icon" title={t('explorer.expandAll')} onClick={handleExpandAll}>
            <ExpandAllIcon />
          </button>
          <button className="btn-icon" title={t('explorer.collapseAll')} onClick={handleCollapseAll}>
            <CollapseAllIcon />
          </button>
          <button
            className="btn-icon"
            title={t('explorer.newMenu')}
            onClick={(e) => {
              e.stopPropagation()
              const rect = (e.currentTarget as HTMLButtonElement).getBoundingClientRect()
              openCreateMenu(getToolbarCreateParentDir(), rect.left, rect.bottom + 4)
            }}
          >
            <NewFileIcon />
          </button>
          <button
            className="btn-icon"
            title={t('explorer.newFolder')}
            onClick={() => startCreate('create-folder', getToolbarCreateParentDir())}
          >
            <NewFolderIcon />
          </button>
          <button className="btn-icon" title={t('explorer.refresh')} onClick={() => void refreshTree()}>
            <RefreshIcon />
          </button>
        </div>
      </div>

      {error && <div className="file-tree-error">{error}</div>}

      <div
        ref={treeContentRef}
        className={`file-tree-content${isRootDropTarget ? ' drop-target' : ''}`}
        role="tree"
        aria-label={t('sidebar.explorer')}
        tabIndex={0}
        onKeyDown={handleTreeKeyDown}
        onContextMenu={handleRootContextMenu}
        onClick={handleContentClick}
        onDragOver={(e) => handleDragOverTarget(e, workspaceRoot)}
        onDragLeave={(e) => handleDragLeaveTarget(e, workspaceRoot)}
        onDrop={(e) => void handleDropOnTarget(e, workspaceRoot)}
      >
        {rootedTree.map((node) => (
          <div key={node.path} onClick={(e) => e.stopPropagation()}>
            <FileTreeItem
              node={node}
              depth={0}
              expandedDirs={expandedDirs}
              selectedPaths={selectedPaths}
              dropTargetPath={dropTargetPath}
              onToggleExpand={handleToggleExpand}
              onItemClick={handleItemClick}
              onContextMenu={handleContextMenu}
              onDragStart={handleNodeDragStart}
              onDragEnd={handleNodeDragEnd}
              onDragOverTarget={handleDragOverTarget}
              onDragLeaveTarget={handleDragLeaveTarget}
              onDropOnTarget={(e, destDir) => void handleDropOnTarget(e, destDir)}
              renamingPath={renamingPath}
              onRenameSubmit={handleRenameSubmit}
              onRenameCancel={handleRenameCancel}
              createInput={inlineInput}
              onCreateSubmit={handleCreateSubmit}
              onCreateCancel={handleCreateCancel}
            />
          </div>
        ))}
      </div>

      {contextMenu && (
        <div
          ref={contextMenuRef}
          className="file-tree-context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
          onMouseLeave={handleContextMenuMouseLeave}
        >
          <button
            type="button"
            className={`context-menu-has-submenu${
              createMenu && createMenu.parentDir === parentDir ? ' active' : ''
            }`}
            onMouseEnter={(e) => openCreateSubmenu(parentDir, e.currentTarget)}
          >
            {t('explorer.newMenu')}
          </button>
          <button
            onMouseEnter={closeCreateSubmenu}
            onClick={() => startCreate('create-folder', parentDir)}
          >
            {t('explorer.newFolder')}
          </button>
          {(canCopyOrCut || canPaste) && (
            <>
              <div className="context-menu-separator" />
              {canCopyOrCut && (
                <button
                  onMouseEnter={closeCreateSubmenu}
                  onClick={() => copyTargetsToClipboard(contextMenu.node, 'cut')}
                >
                  {t('menu.cut')}
                </button>
              )}
              {canCopyOrCut && (
                <button
                  onMouseEnter={closeCreateSubmenu}
                  onClick={() => copyTargetsToClipboard(contextMenu.node, 'copy')}
                >
                  {t('menu.copy')}
                </button>
              )}
              {canPaste && (
                <button
                  onMouseEnter={closeCreateSubmenu}
                  onClick={() => void pasteClipboard(parentDir)}
                >
                  {t('menu.paste')}
                </button>
              )}
            </>
          )}
          {contextMenu.node && (
            <>
              <div className="context-menu-separator" />
              {canAddToChat && (
                <button
                  onMouseEnter={closeCreateSubmenu}
                  onClick={() => addTargetsToChat(contextMenu.node)}
                >
                  {chatAttachTargets.length > 1
                    ? t('explorer.addToChatMany', { count: chatAttachTargets.length })
                    : t('explorer.addToChat')}
                </button>
              )}
              {contextMenu.node.isDirectory && !contextMenu.node.isPreview && (
                <button
                  onMouseEnter={closeCreateSubmenu}
                  onClick={() => {
                    const path = contextMenu.node!.path
                    setContextMenu(null)
                    useAppStore.getState().openSearchPanel({ rootPath: path, replace: false })
                  }}
                >
                  {t('explorer.searchInFolder')}
                </button>
              )}
              {canOpenWithDefaultApp && (
                <button
                  onMouseEnter={closeCreateSubmenu}
                  onClick={() => void openWithDefaultApp(contextMenu.node!)}
                >
                  {t('explorer.openWithDefaultApp')}
                </button>
              )}
              {canShowInOsExplorer && (
                <button
                  onMouseEnter={closeCreateSubmenu}
                  onClick={() => void showItemInFolder(contextMenu.node!)}
                >
                  {t('explorer.showInOsExplorer')}
                </button>
              )}
              {canRename && (
                <button
                  onMouseEnter={closeCreateSubmenu}
                  onClick={() => startRename(contextMenu.node!)}
                >
                  {t('explorer.rename')}
                </button>
              )}
              {canDelete && (
                <button
                  className="danger"
                  onMouseEnter={closeCreateSubmenu}
                  onClick={() => requestDelete(contextMenu.node)}
                >
                  {deleteTargets.length > 1
                    ? t('explorer.deleteMany', { count: deleteTargets.length })
                    : t('common.delete')}
                </button>
              )}
            </>
          )}
        </div>
      )}

      {createMenu && (
        <div
          ref={createMenuRef}
          className="file-tree-context-menu"
          style={{ left: createMenu.x, top: createMenu.y }}
          onClick={(e) => e.stopPropagation()}
          onMouseLeave={handleCreateMenuMouseLeave}
        >
          <button onClick={() => startCreate('create-file', createMenu.parentDir)}>
            {t('explorer.newEmptyFile')}
          </button>
          <button onClick={() => void importFromFile(createMenu.parentDir)}>
            {t('explorer.newFromFile')}
          </button>
          <button
            type="button"
            className={`context-menu-has-submenu${
              templateMenu && templateMenu.parentDir === createMenu.parentDir ? ' active' : ''
            }`}
            onMouseEnter={(e) => openTemplateSubmenu(createMenu.parentDir, e.currentTarget)}
          >
            {t('explorer.newFromTemplate')}
          </button>
          <div className="context-menu-separator" />
          <button
            onClick={() => {
              setCreateMenu(null)
              setTemplateMenu(null)
              setContextMenu(null)
              setTemplateManagerOpen(true)
            }}
          >
            {t('explorer.manageTemplates')}
          </button>
        </div>
      )}

      {templateMenu && createMenu && templateMenu.parentDir === createMenu.parentDir && (
        <div
          ref={templateMenuRef}
          className="file-tree-context-menu file-tree-context-submenu"
          style={{ left: templateMenu.x, top: templateMenu.y }}
          onClick={(e) => e.stopPropagation()}
          onMouseLeave={handleTemplateMenuMouseLeave}
        >
          {docTemplates.map((template) => (
            <button
              key={template.id}
              onClick={() => void createFromTemplate(templateMenu.parentDir, template.id)}
            >
              {template.labelKey ? t(template.labelKey) : (template.label ?? template.id)}
            </button>
          ))}
        </div>
      )}

      <TemplateManagerDialog
        open={templateManagerOpen && !!workspaceRoot}
        workspaceRoot={workspaceRoot ?? ''}
        onClose={() => setTemplateManagerOpen(false)}
        onSaved={() => {
          void listEffectiveDocTemplates(workspaceRoot, locale).then(setDocTemplates)
        }}
      />

      <ConfirmDialog
        open={pendingDeleteTargets !== null && pendingDeleteTargets.length > 0}
        title={t('common.delete')}
        message={
          pendingDeleteTargets && pendingDeleteTargets.length === 1
            ? t('explorer.deleteConfirmOne', {
                name: pendingDeleteTargets[0].name,
                kind: pendingDeleteTargets[0].isDirectory ? t('common.folder') : t('common.file')
              })
            : t('explorer.deleteConfirmMany', {
                count: pendingDeleteTargets?.length ?? 0
              })
        }
        confirmLabel={t('common.delete')}
        danger
        onConfirm={() => void confirmPendingDelete()}
        onCancel={cancelPendingDelete}
      />
    </div>
  )
}
