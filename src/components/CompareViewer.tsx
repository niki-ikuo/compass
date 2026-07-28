import { useEffect, useRef, useState } from 'react'
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

/**
 * @monaco-editor/react の DiffEditor は original 変更時に常に setValue するため
 * カーソルが先頭へ飛ぶ。編集中は original/modified props を固定し、
 * 外部からの内容変更だけモデルへ選択位置を保ったまま反映する。
 */
function applyExternalModelValue(
  ed: editor.IStandaloneCodeEditor,
  next: string,
  markApplying: (v: boolean) => void
): void {
  if (ed.getValue() === next) return
  const model = ed.getModel()
  if (!model) return
  const selections = ed.getSelections()
  const position = ed.getPosition()
  markApplying(true)
  try {
    ed.executeEdits('', [
      {
        range: model.getFullModelRange(),
        text: next,
        forceMoveMarkers: true
      }
    ])
    ed.pushUndoStop()
    if (selections && selections.length > 0) {
      ed.setSelections(selections)
    } else if (position) {
      ed.setPosition(position)
    }
  } finally {
    markApplying(false)
  }
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
  const lastEmittedLeftRef = useRef<string | null>(null)
  const lastEmittedRightRef = useRef<string | null>(null)
  const [sideBySide, setSideBySide] = useState(true)

  const leftPath = file.compareLeftPath ?? ''
  const rightPath = file.compareRightPath ?? ''
  const leftContent = file.compareLeftContent ?? ''
  const rightContent = file.compareRightContent ?? file.content
  const leftLanguage = getLanguageFromPath(leftPath)
  const rightLanguage = getLanguageFromPath(rightPath)
  const editorKey = `${file.path}:${leftPath}:${rightPath}`

  // DiffEditor マウント／左右入替時だけ props を渡す（編集中の controlled 更新を避ける）
  const [seed, setSeed] = useState(() => ({
    key: editorKey,
    left: leftContent,
    right: rightContent
  }))
  if (seed.key !== editorKey) {
    setSeed({ key: editorKey, left: leftContent, right: rightContent })
    lastEmittedLeftRef.current = leftContent
    lastEmittedRightRef.current = rightContent
  }

  // 他タブなど外部からの内容変更のみ反映（自分の編集は lastEmitted でスキップ）
  useEffect(() => {
    const diff = diffEditorRef.current
    if (!diff) return

    if (lastEmittedLeftRef.current !== leftContent) {
      applyExternalModelValue(diff.getOriginalEditor(), leftContent, (v) => {
        applyingExternalRef.current = v
      })
      lastEmittedLeftRef.current = leftContent
    }
    if (lastEmittedRightRef.current !== rightContent) {
      applyExternalModelValue(diff.getModifiedEditor(), rightContent, (v) => {
        applyingExternalRef.current = v
      })
      lastEmittedRightRef.current = rightContent
    }
  }, [leftContent, rightContent])

  useEffect(() => {
    const diff = diffEditorRef.current
    if (!diff) return
    diff.updateOptions({ renderSideBySide: sideBySide })
  }, [sideBySide])

  const handleMount = (diffEditor: editor.IStandaloneDiffEditor) => {
    diffEditorRef.current = diffEditor
    lastEmittedLeftRef.current = diffEditor.getOriginalEditor().getValue()
    lastEmittedRightRef.current = diffEditor.getModifiedEditor().getValue()

    const original = diffEditor.getOriginalEditor()
    const modified = diffEditor.getModifiedEditor()

    original.onDidChangeModelContent(() => {
      if (applyingExternalRef.current) return
      const value = original.getValue()
      lastEmittedLeftRef.current = value
      updateCompareSideContent(file.path, 'left', value)
    })
    modified.onDidChangeModelContent(() => {
      if (applyingExternalRef.current) return
      const value = modified.getValue()
      lastEmittedRightRef.current = value
      updateCompareSideContent(file.path, 'right', value)
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
          key={editorKey}
          height="100%"
          language={rightLanguage || leftLanguage}
          original={seed.left}
          modified={seed.right}
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
