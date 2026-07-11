import { useAppStore } from '@/stores/app-store'
import { getFileName } from '@/utils/language'

export function TabBar() {
  const openFiles = useAppStore((s) => s.openFiles)
  const activeFilePath = useAppStore((s) => s.activeFilePath)
  const setActiveFile = useAppStore((s) => s.setActiveFile)
  const closeFile = useAppStore((s) => s.closeFile)

  if (openFiles.length === 0) return null

  return (
    <div className="tab-bar">
      {openFiles.map((file) => (
        <div
          key={file.path}
          className={`tab ${file.path === activeFilePath ? 'active' : ''}${file.isPreview ? ' preview-tab' : ''}`}
          onClick={() => setActiveFile(file.path)}
        >
          <span className="tab-name">
            {file.isPreview && <span className="tab-preview-badge">P</span>}
            {file.isDirty && !file.isPreview && <span className="dirty-dot">●</span>}
            {getFileName(file.path)}
          </span>
          <button
            className="tab-close"
            onClick={(e) => {
              e.stopPropagation()
              closeFile(file.path)
            }}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  )
}
