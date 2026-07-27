import { useState } from 'react'
import { getFileName } from '@/utils/language'
import { formatByteSize } from '@/utils/binary-file'
import { formatUiPath } from '@/utils/display-path'
import { useI18n } from '@/i18n'
import { useAppStore } from '@/stores/app-store'

interface BinaryFileViewerProps {
  path: string
  size?: number
}

export function BinaryFileViewer({ path, size }: BinaryFileViewerProps) {
  const { t } = useI18n()
  const workspaceRoot = useAppStore((s) => s.workspaceRoot)
  const [opening, setOpening] = useState(false)
  const fileName = getFileName(path)
  const pathTitle = formatUiPath(path, { workspaceRoot, maxChars: 10_000 }).title
  const sizeLabel =
    typeof size === 'number' && Number.isFinite(size) ? formatByteSize(size) : null

  const openWithDefaultApp = async (): Promise<void> => {
    setOpening(true)
    try {
      await window.compass.shell.openPath(path)
    } catch (err) {
      window.alert(err instanceof Error ? err.message : t('explorer.openWithDefaultAppFailed'))
    } finally {
      setOpening(false)
    }
  }

  return (
    <div className="binary-file-viewer">
      <div className="binary-file-viewer-toolbar">
        <span className="binary-file-viewer-label">{t('editor.binaryLabel')}</span>
        <span className="binary-file-viewer-filename" title={pathTitle}>
          {fileName}
        </span>
      </div>
      <div className="binary-file-viewer-body">
        <div className="binary-file-viewer-card">
          <h2 className="binary-file-viewer-title">{t('editor.binaryUnsupportedTitle')}</h2>
          <p className="binary-file-viewer-message">{t('editor.binaryUnsupportedMessage')}</p>
          {sizeLabel ? (
            <p className="binary-file-viewer-meta">
              {t('editor.binaryFileSize', { size: sizeLabel })}
            </p>
          ) : null}
          <button
            type="button"
            className="btn-primary"
            disabled={opening}
            onClick={() => void openWithDefaultApp()}
          >
            {t('explorer.openWithDefaultApp')}
          </button>
        </div>
      </div>
    </div>
  )
}
