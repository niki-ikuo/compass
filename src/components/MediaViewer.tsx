import { useEffect, useMemo } from 'react'
import { getFileName } from '@/utils/language'
import { useI18n } from '@/i18n'

function base64ToBlobUrl(base64: string, mimeType: string): string {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return URL.createObjectURL(new Blob([bytes], { type: mimeType }))
}

interface MediaViewerProps {
  path: string
  viewKind: 'image' | 'pdf'
  mimeType: string
  base64: string
}

export function MediaViewer({ path, viewKind, mimeType, base64 }: MediaViewerProps) {
  const { t } = useI18n()
  const fileName = getFileName(path)

  const objectUrl = useMemo(
    () => base64ToBlobUrl(base64, mimeType),
    [base64, mimeType]
  )

  useEffect(() => {
    return () => {
      URL.revokeObjectURL(objectUrl)
    }
  }, [objectUrl])

  return (
    <div className="media-viewer">
      <div className="media-viewer-toolbar">
        <span className="media-viewer-label">
          {viewKind === 'pdf' ? t('editor.pdfLabel') : t('editor.imageLabel')}
        </span>
        <span className="media-viewer-filename" title={path}>
          {fileName}
        </span>
      </div>
      <div className={`media-viewer-body${viewKind === 'pdf' ? ' is-pdf' : ''}`}>
        {viewKind === 'image' ? (
          <img className="media-viewer-image" src={objectUrl} alt={fileName} />
        ) : (
          <iframe className="media-viewer-pdf" src={objectUrl} title={fileName} />
        )}
      </div>
    </div>
  )
}
