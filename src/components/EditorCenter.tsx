import { useRef } from 'react'
import { useAppStore } from '@/stores/app-store'
import { TabBar } from './TabBar'
import { PreviewBar } from './PreviewBar'
import { AiApplyUndoBar } from './AiApplyUndoBar'
import { CodeEditor } from './Editor'
import { TerminalPanel } from './TerminalPanel'

export function EditorCenter() {
  const showTerminal = useAppStore((s) => s.showTerminal)
  const wasShownRef = useRef(showTerminal)

  if (showTerminal) {
    wasShownRef.current = true
  }

  return (
    <div className="editor-center">
      <div className="editor-main">
        <TabBar />
        <CodeEditor />
        <PreviewBar />
        <AiApplyUndoBar />
      </div>
      {wasShownRef.current && (
        <div className={showTerminal ? '' : 'terminal-panel-hidden'}>
          <TerminalPanel />
        </div>
      )}
    </div>
  )
}
