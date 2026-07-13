import { useRef, useCallback, useState, useMemo, useEffect } from 'react'
import Editor, { DiffEditor } from '@monaco-editor/react'
import { KeyCode, KeyMod, type editor } from 'monaco-editor'
import type { Monaco } from '@monaco-editor/react'
import { useAppStore } from '@/stores/app-store'
import { isMarkdownFile } from '@/utils/language'
import { toWorkspaceRelativePath } from '@/utils/workspace-actions'
import { getColorTheme } from '@/utils/color-theme'
import {
  cancelPendingInlineCompletion,
  ensureInlineCompletionsRegistered
} from '@/utils/inline-completions'
import { MarkdownPreview } from './MarkdownPreview'
import { buildWorkspaceIndex } from '@/utils/project-index'
import {
  buildSelectionDragPayload,
  rememberCopiedSelection,
  toChatSelectionRef,
  writeSelectionClipboard
} from '@/utils/chat-selection-drag'
import { useI18n } from '@/i18n'

type MarkdownViewMode = 'edit' | 'preview' | 'split'

const editorOptionsBase: editor.IStandaloneEditorConstructionOptions = {
  fontSize: 14,
  fontFamily: "'Cascadia Code', 'Consolas', 'Monaco', monospace",
  scrollBeyondLastLine: false,
  automaticLayout: true,
  tabSize: 2,
  renderWhitespace: 'selection',
  bracketPairColorization: { enabled: true },
  // インライン補完表示中に Suggest ウィジェットが勝つとゴーストが消えるため、自動サジェストは抑止
  quickSuggestions: false,
  suggestOnTriggerCharacters: false,
  wordBasedSuggestions: 'off',
  parameterHints: { enabled: true },
  suggest: {
    preview: false,
    showInlineDetails: false
  },
  inlineSuggest: {
    enabled: true,
    mode: 'prefix',
    showToolbar: 'onHover',
    suppressSuggestions: true,
    // DevTools や他パネルにフォーカスが移ってもゴーストを消さない
    keepOnBlur: true
  }
}

export function CodeEditor() {
  const { t } = useI18n()
  const activeFilePath = useAppStore((s) => s.activeFilePath)
  const openFiles = useAppStore((s) => s.openFiles)
  const workspaceRoot = useAppStore((s) => s.workspaceRoot)
  const pendingWorkspacePreview = useAppStore((s) => s.pendingWorkspacePreview)
  const monacoTheme = useAppStore((s) => getColorTheme(s.settings.colorTheme).monacoTheme)
  const inlineCompletionsEnabled = useAppStore((s) => s.settings.inlineCompletionsEnabled)
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

  const mergedEditorOptions = useMemo(
    () => ({
      ...editorOptionsBase,
      inlineSuggest: {
        ...editorOptionsBase.inlineSuggest,
        enabled: inlineCompletionsEnabled !== false
      },
      minimap: { enabled: !isMarkdown || markdownViewMode !== 'split' },
      wordWrap: (isMarkdown ? 'on' : 'off') as 'on' | 'off'
    }),
    [inlineCompletionsEnabled, isMarkdown, markdownViewMode]
  )

  useEffect(() => {
    if (inlineCompletionsEnabled === false) {
      cancelPendingInlineCompletion()
    }
  }, [inlineCompletionsEnabled])

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

  const handleEditorBeforeMount = useCallback((monaco: Monaco) => {
    ensureInlineCompletionsRegistered(monaco)
  }, [])

  const handleEditorMount = useCallback(
    (ed: editor.IStandaloneCodeEditor, monaco: Monaco) => {
      editorRef.current = ed
      ensureInlineCompletionsRegistered(monaco)

      // 手動トリガー（Alt+\）— 自動補完が遅い/出ないときの確認用
      ed.addAction({
        id: 'compass.triggerInlineSuggest',
        label: t('editor.triggerInlineSuggest'),
        keybindings: [KeyMod.Alt | KeyCode.Backslash],
        run: () => {
          void ed.getAction('editor.action.inlineSuggest.trigger')?.run()
        }
      })

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
        label: t('editor.addToChat'),
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
        label: t('editor.copyChatRef'),
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
    [setCursorPosition, setEditorSelection, addSelectionToChat, copySelectionChatRef, t]
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
          <p>{t('editor.selectFile')}</p>
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
              {activeFile.isNewPreview ? t('editor.newFilePreview') : t('editor.changePreview')}
            </span>
            <span className="editor-diff-filename" title={activeFile.path}>
              {workspaceRoot
                ? toWorkspaceRelativePath(workspaceRoot, activeFile.path)
                : activeFile.path.replace(/\\/g, '/')}
            </span>
            <span className="editor-diff-hint">{t('editor.diffHint')}</span>
          </div>

          <div className="editor-diff-header-right">
            {hasMultiplePreviews && (
              <div className="editor-preview-nav">
                <button
                  type="button"
                  className="btn-secondary btn-compact"
                  onClick={() => goToPreview(-1)}
                  disabled={isApplying}
                  title={t('editor.prevChange')}
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
                  title={t('editor.nextChange')}
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
              {t('editor.reject')}
            </button>
            <button
              type="button"
              className="btn-apply"
              onClick={() => void handleApplyCurrent()}
              disabled={isApplying}
            >
              {isApplying ? t('editor.applying') : t('editor.accept')}
            </button>
          </div>
        </div>

        {pendingWorkspacePreview && previewFiles.length > 1 && (
          <div className="editor-preview-bulk-bar">
            <span>{t('editor.otherChanges', { count: previewFiles.length - 1 })}</span>
            <div className="editor-preview-bulk-actions">
              <button
                type="button"
                className="btn-secondary btn-compact"
                onClick={handleRejectAll}
                disabled={isApplying}
              >
                {t('editor.rejectAll')}
              </button>
              <button
                type="button"
                className="btn-apply btn-compact"
                onClick={() => void handleApplyAll()}
                disabled={isApplying}
              >
                {t('editor.acceptAll')}
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
              ...mergedEditorOptions,
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
            {t('editor.editTab')}
          </button>
          <button
            className={markdownViewMode === 'preview' ? 'active' : ''}
            onClick={() => setMarkdownViewMode('preview')}
          >
            {t('editor.previewTab')}
          </button>
          <button
            className={markdownViewMode === 'split' ? 'active' : ''}
            onClick={() => setMarkdownViewMode('split')}
          >
            {t('editor.splitTab')}
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
              beforeMount={handleEditorBeforeMount}
              onMount={handleEditorMount}
              options={mergedEditorOptions}
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
