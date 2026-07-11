import { useRef, useCallback, useState, useMemo, useEffect } from 'react'
import Editor, { DiffEditor } from '@monaco-editor/react'
import { KeyCode, KeyMod, type editor } from 'monaco-editor'
import { useAppStore } from '@/stores/app-store'
import { isMarkdownFile } from '@/utils/language'
import { toWorkspaceRelativePath } from '@/utils/workspace-actions'
import { getColorTheme } from '@/utils/color-theme'
import { MarkdownPreview } from './MarkdownPreview'
import { buildWorkspaceIndex } from '@/utils/project-index'
import {
  buildSelectionDragPayload,
  rememberCopiedSelection,
  toChatSelectionRef,
  writeSelectionClipboard
} from '@/utils/chat-selection-drag'

type MarkdownViewMode = 'edit' | 'preview' | 'split'

const editorOptions: editor.IStandaloneEditorConstructionOptions = {
  fontSize: 14,
  fontFamily: "'Cascadia Code', 'Consolas', 'Monaco', monospace",
  scrollBeyondLastLine: false,
  automaticLayout: true,
  tabSize: 2,
  renderWhitespace: 'selection',
  bracketPairColorization: { enabled: true }
}

export function CodeEditor() {
  const activeFilePath = useAppStore((s) => s.activeFilePath)
  const openFiles = useAppStore((s) => s.openFiles)
  const workspaceRoot = useAppStore((s) => s.workspaceRoot)
  const pendingWorkspacePreview = useAppStore((s) => s.pendingWorkspacePreview)
  const monacoTheme = useAppStore((s) => getColorTheme(s.settings.colorTheme).monacoTheme)
  const updateFileContent = useAppStore((s) => s.updateFileContent)
  const setEditorSelection = useAppStore((s) => s.setEditorSelection)
  const setCursorPosition = useAppStore((s) => s.setCursorPosition)
  const setActiveFile = useAppStore((s) => s.setActiveFile)
  const setFileTree = useAppStore((s) => s.setFileTree)
  const applyPreviewFile = useAppStore((s) => s.applyPreviewFile)
  const rejectPreviewFile = useAppStore((s) => s.rejectPreviewFile)
  const applyWorkspacePreview = useAppStore((s) => s.applyWorkspacePreview)
  const revertWorkspacePreview = useAppStore((s) => s.revertWorkspacePreview)
  const editorSelection = useAppStore((s) => s.editorSelection)
  const requestChatComposerInsert = useAppStore((s) => s.requestChatComposerInsert)
  const editorRevealRequest = useAppStore((s) => s.editorRevealRequest)
  const clearEditorRevealRequest = useAppStore((s) => s.clearEditorRevealRequest)

  const [markdownViewMode, setMarkdownViewMode] = useState<MarkdownViewMode>('split')
  const [isApplying, setIsApplying] = useState(false)
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null)
  const selectionPayloadRef = useRef<ReturnType<typeof buildSelectionDragPayload> | null>(null)

  const activeFile = openFiles.find((f) => f.path === activeFilePath) ?? null
  const isMarkdown = activeFile ? isMarkdownFile(activeFile.path) : false
  const isPreview = Boolean(activeFile?.isPreview)
  const previewFiles = openFiles.filter((f) => f.isPreview)
  const previewIndex = previewFiles.findIndex((f) => f.path === activeFilePath)
  const hasMultiplePreviews = previewFiles.length > 1

  const activeSelectionPayload = useMemo(() => {
    if (!editorSelection || !activeFilePath || isPreview) return null
    return buildSelectionDragPayload({
      path: activeFilePath,
      startLine: editorSelection.startLine,
      endLine: editorSelection.endLine,
      endColumn: editorSelection.endColumn,
      text: editorSelection.text,
      workspaceRoot
    })
  }, [editorSelection, activeFilePath, isPreview, workspaceRoot])

  selectionPayloadRef.current = activeSelectionPayload

  const addSelectionToChat = useCallback(() => {
    const payload = selectionPayloadRef.current
    if (!payload) return
    requestChatComposerInsert(payload.mention, toChatSelectionRef(payload))
  }, [requestChatComposerInsert])

  const copySelectionChatRef = useCallback(async () => {
    const payload = selectionPayloadRef.current
    if (!payload) return
    rememberCopiedSelection(payload)
    try {
      await navigator.clipboard.writeText(payload.mention)
    } catch {
      // ignore clipboard failures
    }
  }, [])

  const refreshWorkspace = async () => {
    if (!workspaceRoot) return
    const tree = await window.compass.fs.readDir(workspaceRoot)
    setFileTree(tree)
    void buildWorkspaceIndex(workspaceRoot)
  }

  const handleEditorMount = useCallback(
    (ed: editor.IStandaloneCodeEditor) => {
      editorRef.current = ed

      ed.onDidChangeCursorPosition((e) => {
        setCursorPosition(e.position.lineNumber, e.position.column)
      })

      ed.onDidChangeCursorSelection((e) => {
        const sel = e.selection
        const model = ed.getModel()
        if (!model) return

        const text = model.getValueInRange(sel)
        if (text) {
          setEditorSelection({
            startLine: sel.startLineNumber,
            startColumn: sel.startColumn,
            endLine: sel.endLineNumber,
            endColumn: sel.endColumn,
            text
          })
        } else {
          setEditorSelection(null)
        }
      })

      ed.addAction({
        id: 'compass.addSelectionToChat',
        label: 'チャットに追加',
        contextMenuGroupId: '9_cutcopypaste',
        contextMenuOrder: 1.6,
        keybindings: [KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KeyL],
        precondition: 'editorHasSelection',
        run: () => {
          addSelectionToChat()
        }
      })

      ed.addAction({
        id: 'compass.copySelectionChatRef',
        label: 'チャット参照をコピー',
        contextMenuGroupId: '9_cutcopypaste',
        contextMenuOrder: 1.7,
        precondition: 'editorHasSelection',
        run: () => {
          void copySelectionChatRef()
        }
      })

      const applyPendingReveal = () => {
        const request = useAppStore.getState().editorRevealRequest
        const path = useAppStore.getState().activeFilePath
        if (!request || !path) return
        if (
          request.path.replace(/\\/g, '/').toLowerCase() !==
          path.replace(/\\/g, '/').toLowerCase()
        ) {
          return
        }
        const selection = {
          startLineNumber: request.line,
          startColumn: request.column,
          endLineNumber: request.line,
          endColumn: request.endColumn
        }
        ed.revealLineInCenter(request.line)
        ed.setSelection(selection)
        ed.focus()
        useAppStore.getState().clearEditorRevealRequest()
      }
      requestAnimationFrame(applyPendingReveal)

      const domNode = ed.getDomNode()
      const onDragStart = (event: DragEvent) => {
        const payload = selectionPayloadRef.current
        if (!payload || !event.dataTransfer) return
        writeSelectionClipboard(event.dataTransfer, payload)
        event.dataTransfer.effectAllowed = 'copyMove'
      }

      const onCopy = (event: ClipboardEvent) => {
        const payload = selectionPayloadRef.current
        if (!payload || !event.clipboardData) return
        // text/plain = コード本文（他エディタ向け）、MIME = Compass チャット用メタデータ
        writeSelectionClipboard(event.clipboardData, payload)
        event.preventDefault()
      }

      domNode?.addEventListener('dragstart', onDragStart)
      domNode?.addEventListener('copy', onCopy)
      ed.onDidDispose(() => {
        domNode?.removeEventListener('dragstart', onDragStart)
        domNode?.removeEventListener('copy', onCopy)
      })
    },
    [setCursorPosition, setEditorSelection, addSelectionToChat, copySelectionChatRef]
  )

  useEffect(() => {
    const runFind = () => {
      const ed = editorRef.current
      if (!ed) return
      void ed.getAction('actions.find')?.run()
    }
    const runReplace = () => {
      const ed = editorRef.current
      if (!ed) return
      void ed.getAction('editor.action.startFindReplaceAction')?.run()
    }
    window.addEventListener('compass:find-in-file', runFind)
    window.addEventListener('compass:replace-in-file', runReplace)
    return () => {
      window.removeEventListener('compass:find-in-file', runFind)
      window.removeEventListener('compass:replace-in-file', runReplace)
    }
  }, [])

  useEffect(() => {
    if (!editorRevealRequest || !activeFilePath) return
    if (
      editorRevealRequest.path.replace(/\\/g, '/').toLowerCase() !==
      activeFilePath.replace(/\\/g, '/').toLowerCase()
    ) {
      return
    }

    const ed = editorRef.current
    if (!ed) return

    const { line, column, endColumn } = editorRevealRequest
    const selection = {
      startLineNumber: line,
      startColumn: column,
      endLineNumber: line,
      endColumn
    }
    ed.revealLineInCenter(line)
    ed.setSelection(selection)
    ed.focus()
    clearEditorRevealRequest()
  }, [editorRevealRequest, activeFilePath, clearEditorRevealRequest])

  const handleChange = (value: string | undefined) => {
    if (activeFilePath && value !== undefined && !isPreview) {
      updateFileContent(activeFilePath, value)
    }
  }

  const handleApplyCurrent = async () => {
    if (!activeFilePath || isApplying) return
    setIsApplying(true)
    try {
      await applyPreviewFile(activeFilePath)
      await refreshWorkspace()
    } finally {
      setIsApplying(false)
    }
  }

  const handleRejectCurrent = () => {
    if (!activeFilePath) return
    rejectPreviewFile(activeFilePath)
  }

  const handleApplyAll = async () => {
    if (isApplying) return
    setIsApplying(true)
    try {
      await applyWorkspacePreview()
      await refreshWorkspace()
    } finally {
      setIsApplying(false)
    }
  }

  const handleRejectAll = () => {
    revertWorkspacePreview()
  }

  const goToPreview = (offset: number) => {
    if (previewFiles.length === 0) return
    const baseIndex = previewIndex >= 0 ? previewIndex : 0
    const nextIndex = (baseIndex + offset + previewFiles.length) % previewFiles.length
    setActiveFile(previewFiles[nextIndex].path)
  }

  if (!activeFile) {
    return (
      <div className="editor-empty">
        <div className="editor-empty-content">
          <p>ファイルを選択してください</p>
        </div>
      </div>
    )
  }

  if (isPreview) {
    return (
      <div className="editor-container preview-mode">
        <div className="editor-diff-header">
          <div className="editor-diff-header-left">
            <span className="editor-diff-badge">
              {activeFile.isNewPreview ? '新規ファイル（プレビュー）' : '変更プレビュー'}
            </span>
            <span className="editor-diff-filename" title={activeFile.path}>
              {workspaceRoot
                ? toWorkspaceRelativePath(workspaceRoot, activeFile.path)
                : activeFile.path.replace(/\\/g, '/')}
            </span>
            <span className="editor-diff-hint">左: 現在 · 右: 提案</span>
          </div>

          <div className="editor-diff-header-right">
            {hasMultiplePreviews && (
              <div className="editor-preview-nav">
                <button
                  type="button"
                  className="btn-secondary btn-compact"
                  onClick={() => goToPreview(-1)}
                  disabled={isApplying}
                  title="前の変更"
                >
                  ←
                </button>
                <span className="editor-preview-count">
                  {previewIndex + 1} / {previewFiles.length}
                </span>
                <button
                  type="button"
                  className="btn-secondary btn-compact"
                  onClick={() => goToPreview(1)}
                  disabled={isApplying}
                  title="次の変更"
                >
                  →
                </button>
              </div>
            )}
            <button
              type="button"
              className="btn-reject"
              onClick={handleRejectCurrent}
              disabled={isApplying}
            >
              拒否
            </button>
            <button
              type="button"
              className="btn-apply"
              onClick={() => void handleApplyCurrent()}
              disabled={isApplying}
            >
              {isApplying ? '適用中...' : '採用'}
            </button>
          </div>
        </div>

        {pendingWorkspacePreview && previewFiles.length > 1 && (
          <div className="editor-preview-bulk-bar">
            <span>他 {previewFiles.length - 1} 件の変更があります</span>
            <div className="editor-preview-bulk-actions">
              <button
                type="button"
                className="btn-secondary btn-compact"
                onClick={handleRejectAll}
                disabled={isApplying}
              >
                すべて拒否
              </button>
              <button
                type="button"
                className="btn-apply btn-compact"
                onClick={() => void handleApplyAll()}
                disabled={isApplying}
              >
                すべて採用
              </button>
            </div>
          </div>
        )}

        <div className="editor-body">
          <DiffEditor
            height="100%"
            language={activeFile.language}
            original={activeFile.previewOriginal ?? ''}
            modified={activeFile.content}
            theme={monacoTheme}
            options={{
              ...editorOptions,
              readOnly: true,
              renderSideBySide: true,
              minimap: { enabled: true }
            }}
          />
        </div>
      </div>
    )
  }

  const showEditor = !isMarkdown || markdownViewMode === 'edit' || markdownViewMode === 'split'
  const showPreviewPane = isMarkdown && (markdownViewMode === 'preview' || markdownViewMode === 'split')

  return (
    <div className="editor-container">
      {isMarkdown && (
        <div className="editor-view-toolbar">
          <button
            className={markdownViewMode === 'edit' ? 'active' : ''}
            onClick={() => setMarkdownViewMode('edit')}
          >
            編集
          </button>
          <button
            className={markdownViewMode === 'preview' ? 'active' : ''}
            onClick={() => setMarkdownViewMode('preview')}
          >
            プレビュー
          </button>
          <button
            className={markdownViewMode === 'split' ? 'active' : ''}
            onClick={() => setMarkdownViewMode('split')}
          >
            分割
          </button>
        </div>
      )}

      <div className={`editor-body ${markdownViewMode === 'split' ? 'split' : ''}`}>
        {showEditor && (
          <div className={`editor-pane ${markdownViewMode === 'split' ? 'half' : 'full'}`}>
            <Editor
              height="100%"
              language={activeFile.language}
              value={activeFile.content}
              theme={monacoTheme}
              onChange={handleChange}
              onMount={handleEditorMount}
              options={{
                ...editorOptions,
                minimap: { enabled: markdownViewMode !== 'split' },
                wordWrap: isMarkdown ? 'on' : 'off'
              }}
            />
          </div>
        )}

        {showPreviewPane && (
          <div className={`preview-pane ${markdownViewMode === 'split' ? 'half' : 'full'}`}>
            <MarkdownPreview content={activeFile.content} />
          </div>
        )}
      </div>
    </div>
  )
}
