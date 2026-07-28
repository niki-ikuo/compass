import { useCallback, useEffect, useRef, useState } from 'react'
import { DiffEditor } from '@monaco-editor/react'
import type { editor } from 'monaco-editor'
import { useAppStore } from '@/stores/app-store'
import { getColorTheme } from '@/utils/color-theme'
import { formatUiPath, UI_PATH_MAX_CHARS_WIDE } from '@/utils/display-path'
import { getFileName, getLanguageFromPath } from '@/utils/language'
import { pathToFileUrl } from '@/utils/browser-tab'
import { useI18n } from '@/i18n'
import type { OpenFile } from '@/types'

const compareEditorOptions = {
  fontSize: 14,
  fontFamily: "'Cascadia Code', 'Consolas', 'Monaco', monospace",
  scrollBeyondLastLine: false,
  automaticLayout: true,
  tabSize: 2,
  renderWhitespace: 'selection' as const,
  bracketPairColorization: { enabled: true },
  unusualLineTerminators: 'auto' as const,
  mouseWheelZoom: false,
  originalEditable: true,
  readOnly: false,
  renderSideBySide: true,
  enableSplitViewResizing: true,
  scrollbar: {
    alwaysConsumeMouseWheel: false
  }
}

interface CompareViewerProps {
  file: OpenFile
}

export function CompareViewer({ file }: CompareViewerProps) {
  const { t } = useI18n()
  const workspaceRoot = useAppStore((s) => s.workspaceRoot)
  const monacoTheme = useAppStore((s) => getColorTheme(s.settings.colorTheme).monacoTheme)
  const editorMinimapEnabled = useAppStore((s) => s.settings.editorMinimapEnabled !== false)
  const updateCompareSideContent = useAppStore((s) => s.updateCompareSideContent)
  const swapCompareSides = useAppStore((s) => s.swapCompareSides)

  const diffEditorRef = useRef<editor.IStandaloneDiffEditor | null>(null)
  const applyingExternalRef = useRef(false)
  const [sideBySide, setSideBySide] = useState(true)

  const leftPath = file.compareLeftPath ?? ''
  const rightPath = file.compareRightPath ?? ''
  const leftContent = file.compareLeftContent ?? ''
  const rightContent = file.compareRightContent ?? file.content
  const leftLanguage = getLanguageFromPath(leftPath)
  const rightLanguage = getLanguageFromPath(rightPath)

  const syncFromStore = useCallback(() => {
    const diff = diffEditorRef.current
    if (!diff) return
    const original = diff.getOriginalEditor()
    const modified = diff.getModifiedEditor()
    applyingExternalRef.current = true
    try {
      if (original.getValue() !== leftContent) {
        original.setValue(leftContent)
      }
      if (modified.getValue() !== rightContent) {
        modified.setValue(rightContent)
      }
    } finally {
      applyingExternalRef.current = false
    }
  }, [leftContent, rightContent])

  useEffect(() => {
    syncFromStore()
  }, [syncFromStore])

  useEffect(() => {
    const diff = diffEditorRef.current
    if (!diff) return
    diff.updateOptions({ renderSideBySide: sideBySide })
  }, [sideBySide])

  const handleMount = (diffEditor: editor.IStandaloneDiffEditor) => {
    diffEditorRef.current = diffEditor
    const original = diffEditor.getOriginalEditor()
    const modified = diffEditor.getModifiedEditor()

    original.onDidChangeModelContent(() => {
      if (applyingExternalRef.current) return
      updateCompareSideContent(file.path, 'left', original.getValue())
    })
    modified.onDidChangeModelContent(() => {
      if (applyingExternalRef.current) return
      updateCompareSideContent(file.path, 'right', modified.getValue())
    })
  }

  const leftLabel = formatUiPath(leftPath, {
    workspaceRoot,
    maxChars: UI_PATH_MAX_CHARS_WIDE
  })
  const rightLabel = formatUiPath(rightPath, {
    workspaceRoot,
    maxChars: UI_PATH_MAX_CHARS_WIDE
  })

  return (
    <div className="editor-container compare-editor">
      <div className="editor-compare-header">
        <div className="editor-compare-header-left">
          <span className="editor-compare-badge">{t('editor.compareBadge')}</span>
          <span className="editor-compare-side" title={leftLabel.title}>
            {file.compareLeftDirty ? '● ' : ''}
            {getFileName(leftPath)}
          </span>
          <button
            type="button"
            className="btn-secondary btn-compact"
            onClick={() => swapCompareSides(file.path)}
            title={t('editor.compareSwap')}
          >
            ↔
          </button>
          <span className="editor-compare-side" title={rightLabel.title}>
            {file.compareRightDirty ? '● ' : ''}
            {getFileName(rightPath)}
          </span>
        </div>
        <div className="editor-compare-header-right">
          <button
            type="button"
            className={`btn-secondary btn-compact${sideBySide ? ' is-active' : ''}`}
            onClick={() => setSideBySide(true)}
          >
            {t('editor.compareSideBySide')}
          </button>
          <button
            type="button"
            className={`btn-secondary btn-compact${!sideBySide ? ' is-active' : ''}`}
            onClick={() => setSideBySide(false)}
          >
            {t('editor.compareInline')}
          </button>
        </div>
      </div>
      <div className="editor-body">
        <DiffEditor
          key={`${file.path}:${leftPath}:${rightPath}`}
          height="100%"
          language={rightLanguage || leftLanguage}
          original={leftContent}
          modified={rightContent}
          originalModelPath={`${pathToFileUrl(leftPath)}.compare-left`}
          modifiedModelPath={`${pathToFileUrl(rightPath)}.compare-right`}
          theme={monacoTheme}
          options={{
            ...compareEditorOptions,
            renderSideBySide: sideBySide,
            minimap: { enabled: editorMinimapEnabled }
          }}
          onMount={handleMount}
        />
      </div>
    </div>
  )
}
