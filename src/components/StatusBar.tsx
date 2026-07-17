import { useEffect, useRef, useState } from 'react'
import { useAppStore } from '@/stores/app-store'
import { getFileName, getLanguageFromPath } from '@/utils/language'
import { FILE_ENCODINGS, getEncodingLabel } from '@/utils/file-encoding'
import { buildWorkspaceIndex } from '@/utils/project-index'
import { getLlmProvider } from '@/utils/llm-providers'
import type { FileEncoding } from '@/types'
import { useI18n, type MessageKey } from '@/i18n'
import { isMediaOpenFile } from '@/utils/media-context'

export function StatusBar() {
  const { t } = useI18n()
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
  const isMedia = activeFile ? isMediaOpenFile(activeFile) : false
  const isBrowser = activeFile?.viewKind === 'browser'
  const language = activeFilePath
    ? isBrowser
      ? t('browser.label')
      : isMedia
        ? activeFile?.viewKind === 'pdf'
          ? t('editor.pdfLabel')
          : t('editor.imageLabel')
        : getLanguageFromPath(activeFilePath)
    : ''
  const encodingLabel = activeFile && !isMedia && !isBrowser ? getEncodingLabel(activeFile.encoding) : ''
  const provider = getLlmProvider(settings.providerId)
  const providerLabel = t(`provider.${provider.id}.label` as MessageKey)

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
    if (provider.requiresApiKey && !settings.apiKey) return t('status.apiUnset')
    if (apiConnected === true) return t('status.connected')
    return t('status.idle')
  }

  const indexStatusLabel = () => {
    if (indexStatus === 'indexing') return t('status.indexing')
    if (indexStatus === 'ready' && indexMeta) {
      return t('status.indexFiles', { count: indexMeta.fileCount })
    }
    if (indexStatus === 'error') return t('status.indexError')
    return workspaceRoot ? t('status.indexMissing') : ''
  }

  const handleRebuildIndex = (): void => {
    if (!workspaceRoot || indexStatus === 'indexing') return
    void buildWorkspaceIndex(workspaceRoot)
  }

  const handleReopen = async (encoding: FileEncoding): Promise<void> => {
    if (!activeFile || activeFile.isPreview) return
    if (activeFile.isDirty) {
      const ok = window.confirm(t('status.encodingConfirm'))
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
        {activeFilePath ? getFileName(activeFilePath) : t('status.noFile')}
      </span>
      <span className="status-item">
        {isBrowser
          ? activeFile?.browserUrl && activeFile.browserUrl !== 'about:blank'
            ? activeFile.browserUrl
            : t('browser.newTab')
          : `Ln ${cursorPosition.line}, Col ${cursorPosition.column}`}
      </span>
      {language && <span className="status-item">{language}</span>}
      {activeFile && !isMedia && !isBrowser && (
        <div className="status-encoding" ref={menuRef}>
          <button
            type="button"
            className="status-encoding-button"
            onClick={() => setMenuOpen((open) => !open)}
            disabled={activeFile.isPreview}
            title={t('status.encoding')}
          >
            {encodingLabel}
          </button>
          {menuOpen && (
            <div className="status-encoding-menu">
              <div className="status-encoding-section">{t('status.reopenWithEncoding')}</div>
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
              <div className="status-encoding-section">{t('status.saveWithEncoding')}</div>
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
          title={t('status.rebuildIndex')}
        >
          {indexLabel}
        </button>
      )}
      <span
        className="status-item status-llm"
        title={`${providerLabel} / ${settings.model}`}
      >
        {providerLabel}: {settings.model}
      </span>
      <span className="status-item status-right">{connectionStatus()}</span>
    </div>
  )
}
