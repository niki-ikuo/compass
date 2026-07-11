import { useEffect, useRef, useState } from 'react'
import { useAppStore } from '@/stores/app-store'
import { getFileName, getLanguageFromPath } from '@/utils/language'
import { FILE_ENCODINGS, getEncodingLabel } from '@/utils/file-encoding'
import { buildWorkspaceIndex } from '@/utils/project-index'
import type { FileEncoding } from '@/types'

export function StatusBar() {
  const activeFilePath = useAppStore((s) => s.activeFilePath)
  const openFiles = useAppStore((s) => s.openFiles)
  const cursorPosition = useAppStore((s) => s.cursorPosition)
  const apiConnected = useAppStore((s) => s.apiConnected)
  const settings = useAppStore((s) => s.settings)
  const workspaceRoot = useAppStore((s) => s.workspaceRoot)
  const indexStatus = useAppStore((s) => s.indexStatus)
  const indexMeta = useAppStore((s) => s.indexMeta)
  const reopenFileWithEncoding = useAppStore((s) => s.reopenFileWithEncoding)
  const setFileEncoding = useAppStore((s) => s.setFileEncoding)

  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  const activeFile = openFiles.find((f) => f.path === activeFilePath) ?? null
  const language = activeFilePath ? getLanguageFromPath(activeFilePath) : ''
  const encodingLabel = activeFile ? getEncodingLabel(activeFile.encoding) : ''

  useEffect(() => {
    if (!menuOpen) return
    const onPointerDown = (event: MouseEvent): void => {
      if (!menuRef.current?.contains(event.target as Node)) {
        setMenuOpen(false)
      }
    }
    window.addEventListener('mousedown', onPointerDown)
    return () => window.removeEventListener('mousedown', onPointerDown)
  }, [menuOpen])

  const connectionStatus = () => {
    if (!settings.apiKey) return 'API未設定'
    if (apiConnected === true) return '接続済み'
    return '待機中'
  }

  const indexStatusLabel = () => {
    if (indexStatus === 'indexing') return 'インデックス更新中...'
    if (indexStatus === 'ready' && indexMeta) {
      return `Index: ${indexMeta.fileCount}ファイル`
    }
    if (indexStatus === 'error') return 'Index: エラー（再試行）'
    return workspaceRoot ? 'Index: 未作成' : ''
  }

  const handleRebuildIndex = (): void => {
    if (!workspaceRoot || indexStatus === 'indexing') return
    void buildWorkspaceIndex(workspaceRoot)
  }

  const handleReopen = async (encoding: FileEncoding): Promise<void> => {
    if (!activeFile || activeFile.isPreview) return
    if (activeFile.isDirty) {
      const ok = window.confirm(
        '未保存の変更があります。別の文字コードで開き直すと破棄されます。続行しますか？'
      )
      if (!ok) return
    }
    setMenuOpen(false)
    await reopenFileWithEncoding(activeFile.path, encoding)
  }

  const handleSaveAs = async (encoding: FileEncoding): Promise<void> => {
    if (!activeFile || activeFile.isPreview) return
    setMenuOpen(false)
    setFileEncoding(activeFile.path, encoding)
    await window.compass.fs.writeFile(activeFile.path, activeFile.content, encoding)
    useAppStore.getState().markFileSaved(activeFile.path)
  }

  const indexLabel = indexStatusLabel()

  return (
    <div className="status-bar">
      <span className="status-item">
        {activeFilePath ? getFileName(activeFilePath) : 'ファイルなし'}
      </span>
      <span className="status-item">
        Ln {cursorPosition.line}, Col {cursorPosition.column}
      </span>
      {language && <span className="status-item">{language}</span>}
      {activeFile && (
        <div className="status-encoding" ref={menuRef}>
          <button
            type="button"
            className="status-encoding-button"
            onClick={() => setMenuOpen((open) => !open)}
            disabled={activeFile.isPreview}
            title="文字コード"
          >
            {encodingLabel}
          </button>
          {menuOpen && (
            <div className="status-encoding-menu">
              <div className="status-encoding-section">エンコード付きで再度開く</div>
              {FILE_ENCODINGS.map((item) => (
                <button
                  key={`reopen-${item.id}`}
                  type="button"
                  className={
                    item.id === activeFile.encoding
                      ? 'status-encoding-option is-active'
                      : 'status-encoding-option'
                  }
                  onClick={() => void handleReopen(item.id)}
                >
                  {item.label}
                </button>
              ))}
              <div className="status-encoding-section">エンコードして保存</div>
              {FILE_ENCODINGS.map((item) => (
                <button
                  key={`save-${item.id}`}
                  type="button"
                  className={
                    item.id === activeFile.encoding
                      ? 'status-encoding-option is-active'
                      : 'status-encoding-option'
                  }
                  onClick={() => void handleSaveAs(item.id)}
                >
                  {item.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      {indexLabel && (
        <button
          type="button"
          className="status-item status-index-button"
          onClick={handleRebuildIndex}
          disabled={!workspaceRoot || indexStatus === 'indexing'}
          title="クリックでインデックスを再構築"
        >
          {indexLabel}
        </button>
      )}
      <span className="status-item status-right">{connectionStatus()}</span>
    </div>
  )
}
