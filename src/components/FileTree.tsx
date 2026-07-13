import { useEffect, useRef, useState, useMemo, useCallback } from 'react'
import type { FileTreeNode } from '@/types'
import { useAppStore } from '@/stores/app-store'
import { buildWorkspaceIndex } from '@/utils/project-index'
import { mergePreviewIntoTree } from '@/utils/preview-tree'
import {
  CHAT_CONTEXT_DRAG_MIME,
  serializeChatContextRef,
  toChatContextRef
} from '@/utils/chat-context-drag'
import {
  FILE_MOVE_DRAG_MIME,
  hasFileMoveDrag,
  parseFileMovePaths,
  serializeFileMovePaths
} from '@/utils/file-move-drag'
import { useI18n } from '@/i18n'
import { ConfirmDialog } from './ConfirmDialog'
import { restoreWorkbenchFocus } from '@/utils/workbench-focus'

type InputMode = 'create-file' | 'create-folder' | 'rename'

interface ContextMenuState {
  x: number
  y: number
  node: FileTreeNode | null
}

interface InlineInputState {
  mode: InputMode
  parentDir: string
  targetPath?: string
  defaultName: string
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

function getDefaultExpandedDirs(nodes: FileTreeNode[], depth = 0): Set<string> {
  const expanded = new Set<string>()
  for (const node of nodes) {
    if (node.isDirectory && depth < 2) {
      expanded.add(normalizeNodePath(node.path))
      if (node.children) {
        for (const path of getDefaultExpandedDirs(node.children, depth + 1)) {
          expanded.add(path)
        }
      }
    }
  }
  return expanded
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
  onRenameSubmit: (targetPath: string, newName: string) => void
  onRenameCancel: () => void
}

function InlineNameInput({
  defaultName,
  onSubmit,
  onCancel
}: {
  defaultName: string
  onSubmit: (name: string) => void
  onCancel: () => void
}) {
  const [value, setValue] = useState(defaultName)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  const handleSubmit = () => {
    const trimmed = value.trim()
    if (trimmed) onSubmit(trimmed)
    else onCancel()
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
          handleSubmit()
        }
        if (e.key === 'Escape') {
          e.preventDefault()
          onCancel()
        }
      }}
      onBlur={handleSubmit}
      onClick={(e) => e.stopPropagation()}
    />
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
  onRenameCancel
}: FileTreeItemProps) {
  const { t } = useI18n()
  const normalizedPath = normalizeNodePath(node.path)
  const isExpanded = expandedDirs.has(normalizedPath)
  const isSelected = selectedPaths.has(normalizedPath)
  const isRenaming = renamingPath === node.path
  const isDraggable = !isRenaming && !node.isPreview
  const isDropTarget =
    node.isDirectory && !node.isPreview && dropTargetPath === normalizedPath

  const handleClick = (e: React.MouseEvent) => {
    if (isRenaming) return
    onItemClick(node, e)
  }

  const handleExpandClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!isRenaming) onToggleExpand(node.path)
  }

  if (node.isDirectory) {
    const previewClass = node.isPreview
      ? ` preview preview-${node.previewKind ?? 'new-folder'}`
      : ''
    return (
      <div>
        <div
          className={`file-tree-item directory${previewClass}${isDraggable ? ' draggable' : ''}${isSelected ? ' selected' : ''}${isDropTarget ? ' drop-target' : ''}`}
          style={{ paddingLeft: depth * 12 + 8 }}
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
            {isExpanded ? '▾' : '▸'}
          </span>
          <span className="file-tree-icon">{isExpanded ? '📂' : '📁'}</span>
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
                  {node.previewKind === 'deleted' ? t('common.delete') : t('common.new')}
                </span>
              )}
            </span>
          )}
        </div>
        {isExpanded &&
          node.children?.map((child) => (
            <FileTreeItem
              key={child.path}
              node={child}
              depth={depth + 1}
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
            />
          ))}
      </div>
    )
  }

  const previewClass = node.isPreview ? ` preview preview-${node.previewKind ?? 'modified'}` : ''
  const fileParentDir = parentDirPath(node.path)

  return (
    <div
      className={`file-tree-item file${previewClass}${isDraggable ? ' draggable' : ''}${isSelected ? ' selected' : ''}`}
      style={{ paddingLeft: depth * 12 + 8 }}
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
      <span className="file-tree-icon">📄</span>
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
  const { t } = useI18n()
  const fileTree = useAppStore((s) => s.fileTree)
  const workspaceRoot = useAppStore((s) => s.workspaceRoot)
  const pendingWorkspacePreview = useAppStore((s) => s.pendingWorkspacePreview)
  const openFile = useAppStore((s) => s.openFile)
  const openPreviewFile = useAppStore((s) => s.openPreviewFile)
  const setActiveFile = useAppStore((s) => s.setActiveFile)
  const renameOpenFile = useAppStore((s) => s.renameOpenFile)
  const removePaths = useAppStore((s) => s.removePaths)

  const displayTree = useMemo(() => {
    if (!workspaceRoot || !pendingWorkspacePreview) return fileTree
    return mergePreviewIntoTree(fileTree, pendingWorkspacePreview.items, workspaceRoot)
  }, [fileTree, pendingWorkspacePreview, workspaceRoot])

  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const [inlineInput, setInlineInput] = useState<InlineInputState | null>(null)
  const [renamingPath, setRenamingPath] = useState<string | null>(null)
  const [pendingDeleteTargets, setPendingDeleteTargets] = useState<FileTreeNode[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(() => new Set())
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(() => new Set())
  const [dropTargetPath, setDropTargetPath] = useState<string | null>(null)
  const lastSelectedPathRef = useRef<string | null>(null)
  const treeInitializedRef = useRef(false)
  const draggingPathsRef = useRef<string[] | null>(null)

  useEffect(() => {
    treeInitializedRef.current = false
    setSelectedPaths(new Set())
    lastSelectedPathRef.current = null
    setExpandedDirs(new Set())
    setDropTargetPath(null)
    draggingPathsRef.current = null
  }, [workspaceRoot])

  useEffect(() => {
    if (!workspaceRoot || treeInitializedRef.current || displayTree.length === 0) return
    setExpandedDirs(getDefaultExpandedDirs(displayTree))
    treeInitializedRef.current = true
  }, [workspaceRoot, displayTree])

  const visibleNodes = useMemo(
    () => collectVisibleNodes(displayTree, expandedDirs),
    [displayTree, expandedDirs]
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

    const decoded = await window.compass.fs.readFile(path)
    openFile(path, decoded.content, decoded.encoding)
  }

  const handleToggleExpand = useCallback((path: string) => {
    const normalized = normalizeNodePath(path)
    setExpandedDirs((prev) => {
      const next = new Set(prev)
      if (next.has(normalized)) next.delete(normalized)
      else next.add(normalized)
      return next
    })
  }, [])

  const handleExpandAll = () => {
    setExpandedDirs(new Set(collectDirectoryPaths(displayTree)))
  }

  const handleCollapseAll = () => {
    setExpandedDirs(new Set())
  }

  const handleItemClick = useCallback(
    (node: FileTreeNode, e: React.MouseEvent) => {
      const normalized = normalizeNodePath(node.path)

      if (e.ctrlKey || e.metaKey) {
        setSelectedPaths((prev) => {
          const next = new Set(prev)
          if (next.has(normalized)) next.delete(normalized)
          else next.add(normalized)
          return next
        })
        lastSelectedPathRef.current = normalized
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
          return
        }
      }

      setSelectedPaths(new Set([normalized]))
      lastSelectedPathRef.current = normalized

      if (node.isDirectory) {
        handleToggleExpand(node.path)
      } else {
        void handleOpenFile(node.path)
      }
    },
    [handleToggleExpand, visibleNodes]
  )

  const getDeleteTargets = useCallback(
    (contextNode: FileTreeNode | null): FileTreeNode[] => {
      if (selectedPaths.size > 0) {
        const selectedNodes = visibleNodes.filter((n) =>
          selectedPaths.has(normalizeNodePath(n.path))
        )
        const topLevelPaths = filterTopLevelPaths([...selectedPaths])
        return selectedNodes.filter(
          (n) => topLevelPaths.includes(normalizeNodePath(n.path)) && !n.isPreview
        )
      }
      if (contextNode && !contextNode.isPreview) return [contextNode]
      return []
    },
    [selectedPaths, visibleNodes]
  )

  const getMoveSourcePaths = useCallback(
    (dragNode: FileTreeNode): string[] => {
      const normalized = normalizeNodePath(dragNode.path)
      if (selectedPaths.has(normalized) && selectedPaths.size > 1) {
        const selectedNodes = visibleNodes.filter(
          (n) => selectedPaths.has(normalizeNodePath(n.path)) && !n.isPreview
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
    [selectedPaths, visibleNodes]
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

  const cancelPendingDelete = useCallback(() => {
    setPendingDeleteTargets(null)
    restoreWorkbenchFocus()
  }, [])

  const confirmPendingDelete = useCallback(async () => {
    const targets = pendingDeleteTargets
    setPendingDeleteTargets(null)
    if (!targets || targets.length === 0) {
      restoreWorkbenchFocus()
      return
    }

    try {
      for (const target of targets) {
        await window.compass.fs.delete(target.path)
        removePaths(target.path)
      }
      setSelectedPaths(new Set())
      lastSelectedPathRef.current = null
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
      setError(err instanceof Error ? err.message : t('explorer.deleteFailed'))
      await refreshTree()
    } finally {
      restoreWorkbenchFocus()
    }
  }, [pendingDeleteTargets, removePaths, refreshTree, t])

  const handleNodeDragStart = useCallback(
    (e: React.DragEvent, node: FileTreeNode) => {
      if (node.isPreview) {
        e.preventDefault()
        return
      }

      const movePaths = getMoveSourcePaths(node)
      draggingPathsRef.current = movePaths

      const ref = toChatContextRef(node)
      e.dataTransfer.setData(CHAT_CONTEXT_DRAG_MIME, serializeChatContextRef(ref))
      e.dataTransfer.setData(FILE_MOVE_DRAG_MIME, serializeFileMovePaths(movePaths))
      e.dataTransfer.effectAllowed = 'copyMove'
    },
    [getMoveSourcePaths]
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
          lastSelectedPathRef.current = movedPaths[movedPaths.length - 1] ?? null
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
        setError(err instanceof Error ? err.message : t('explorer.moveFailed'))
        await refreshTree()
      }
    },
    [renameOpenFile, refreshTree, t]
  )

  const startCreate = (mode: 'create-file' | 'create-folder', parentDir: string) => {
    setContextMenu(null)
    setInlineInput({
      mode,
      parentDir,
      defaultName: mode === 'create-file' ? 'untitled.txt' : t('explorer.defaultNewFolder')
    })
    setError(null)
  }

  const startRename = (node: FileTreeNode) => {
    setContextMenu(null)
    setRenamingPath(node.path)
    setError(null)
  }

  const handleCreateSubmit = async (name: string) => {
    if (!inlineInput) return
    try {
      let createdPath: string
      if (inlineInput.mode === 'create-file') {
        createdPath = await window.compass.fs.createFile(inlineInput.parentDir, name)
        await refreshTree()
        await handleOpenFile(createdPath)
      } else {
        createdPath = await window.compass.fs.createDirectory(inlineInput.parentDir, name)
        await refreshTree()
      }
      setInlineInput(null)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('explorer.createFailed'))
    }
  }

  const handleRenameSubmit = async (targetPath: string, newName: string) => {
    try {
      const newPath = await window.compass.fs.rename(targetPath, newName)
      renameOpenFile(targetPath, newPath)
      await refreshTree()
      setRenamingPath(null)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('explorer.renameFailed'))
    }
  }

  const handleContextMenu = (e: React.MouseEvent, node: FileTreeNode) => {
    e.preventDefault()
    e.stopPropagation()
    const normalized = normalizeNodePath(node.path)
    if (!selectedPaths.has(normalized)) {
      setSelectedPaths(new Set([normalized]))
      lastSelectedPathRef.current = normalized
    }
    setContextMenu({ x: e.clientX, y: e.clientY, node })
  }

  const handleRootContextMenu = (e: React.MouseEvent) => {
    if (!workspaceRoot) return
    e.preventDefault()
    setContextMenu({ x: e.clientX, y: e.clientY, node: null })
  }

  const handleContentClick = () => {
    setSelectedPaths(new Set())
    lastSelectedPathRef.current = null
  }

  useEffect(() => {
    const closeMenu = () => setContextMenu(null)
    window.addEventListener('click', closeMenu)
    return () => window.removeEventListener('click', closeMenu)
  }, [])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Delete' || selectedPaths.size === 0 || pendingDeleteTargets) return
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        return
      }
      e.preventDefault()
      requestDelete(null)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [selectedPaths, requestDelete, pendingDeleteTargets])

  if (!workspaceRoot) {
    return (
      <div className="file-tree-empty">
        <p>{t('explorer.noFolder')}</p>
        <p className="hint">{t('explorer.openFolderHint')}</p>
      </div>
    )
  }

  const parentDir =
    contextMenu?.node?.isDirectory ? contextMenu.node.path : workspaceRoot

  const deleteTargets = contextMenu ? getDeleteTargets(contextMenu.node) : []
  const canRename = contextMenu?.node && deleteTargets.length === 1 && !contextMenu.node.isPreview
  const canDelete = deleteTargets.length > 0 && deleteTargets.every((n) => !n.isPreview)
  const isRootDropTarget = dropTargetPath === normalizeNodePath(workspaceRoot)

  return (
    <div className="file-tree">
      <div className="panel-header file-tree-header">
        <span>{t('explorer.title')}</span>
        <div className="file-tree-toolbar">
          <button className="btn-icon" title={t('explorer.expandAll')} onClick={handleExpandAll}>
            ⊞
          </button>
          <button className="btn-icon" title={t('explorer.collapseAll')} onClick={handleCollapseAll}>
            ⊟
          </button>
          <button
            className="btn-icon"
            title={t('explorer.newFile')}
            onClick={() => startCreate('create-file', workspaceRoot)}
          >
            📄+
          </button>
          <button
            className="btn-icon"
            title={t('explorer.newFolder')}
            onClick={() => startCreate('create-folder', workspaceRoot)}
          >
            📁+
          </button>
          <button className="btn-icon" title={t('explorer.refresh')} onClick={() => void refreshTree()}>
            ↻
          </button>
        </div>
      </div>

      {error && <div className="file-tree-error">{error}</div>}

      <div
        className={`file-tree-content${isRootDropTarget ? ' drop-target' : ''}`}
        onContextMenu={handleRootContextMenu}
        onClick={handleContentClick}
        onDragOver={(e) => handleDragOverTarget(e, workspaceRoot)}
        onDragLeave={(e) => handleDragLeaveTarget(e, workspaceRoot)}
        onDrop={(e) => void handleDropOnTarget(e, workspaceRoot)}
      >
        {inlineInput && (
          <div className="file-tree-create-bar" onClick={(e) => e.stopPropagation()}>
            <span className="file-tree-create-label">
              {inlineInput.mode === 'create-file' ? t('explorer.newFile') : t('explorer.newFolder')}
              {' · '}
              {inlineInput.parentDir === workspaceRoot
                ? t('common.root')
                : inlineInput.parentDir.replace(workspaceRoot, '').replace(/^[/\\]/, '')}
            </span>
            <div className="file-tree-item creating" style={{ paddingLeft: 8 }}>
              <span className="file-tree-expand file-tree-expand-spacer" />
              <span className="file-tree-icon">
                {inlineInput.mode === 'create-file' ? '📄' : '📁'}
              </span>
              <InlineNameInput
                defaultName={inlineInput.defaultName}
                onSubmit={handleCreateSubmit}
                onCancel={() => setInlineInput(null)}
              />
            </div>
          </div>
        )}

        {displayTree.map((node) => (
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
              onRenameCancel={() => setRenamingPath(null)}
            />
          </div>
        ))}
      </div>

      {contextMenu && (
        <div
          className="file-tree-context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <button onClick={() => startCreate('create-file', parentDir)}>
            {t('explorer.newFile')}
          </button>
          <button onClick={() => startCreate('create-folder', parentDir)}>
            {t('explorer.newFolder')}
          </button>
          {contextMenu.node && (
            <>
              <div className="context-menu-separator" />
              {contextMenu.node.isDirectory && !contextMenu.node.isPreview && (
                <button
                  onClick={() => {
                    const path = contextMenu.node!.path
                    setContextMenu(null)
                    useAppStore.getState().openSearchPanel({ rootPath: path, replace: false })
                  }}
                >
                  {t('explorer.searchInFolder')}
                </button>
              )}
              {canRename && (
                <button onClick={() => startRename(contextMenu.node!)}>
                  {t('explorer.rename')}
                </button>
              )}
              {canDelete && (
                <button className="danger" onClick={() => requestDelete(contextMenu.node)}>
                  {deleteTargets.length > 1
                    ? t('explorer.deleteMany', { count: deleteTargets.length })
                    : t('common.delete')}
                </button>
              )}
            </>
          )}
        </div>
      )}

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
