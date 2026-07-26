import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAppStore } from '@/stores/app-store'
import { openWorkspaceFile } from '@/utils/open-workspace-file'
import type { WorkspaceOutlineEntry, WorkspaceOutlineHeading } from '@/types'
import { useI18n } from '@/i18n'

function toAbsolutePath(workspaceRoot: string, relativePath: string): string {
  const root = workspaceRoot.replace(/\\/g, '/').replace(/\/+$/, '')
  const rel = relativePath.replace(/\\/g, '/').replace(/^\.\//, '')
  return `${root}/${rel}`
}

function HeadingRow({
  filePath,
  heading,
  onOpen
}: {
  filePath: string
  heading: WorkspaceOutlineHeading
  onOpen: (path: string, heading: WorkspaceOutlineHeading) => void
}) {
  return (
    <button
      type="button"
      className={`workspace-outline-heading level-${heading.level}`}
      title={`${heading.text} (L${heading.line})`}
      onClick={() => onOpen(filePath, heading)}
    >
      <span className="workspace-outline-heading-mark">{'#'.repeat(heading.level)}</span>
      <span className="workspace-outline-heading-text">{heading.text}</span>
      <span className="workspace-outline-heading-line">L{heading.line}</span>
    </button>
  )
}

function FileOutlineGroup({
  file,
  absolutePath,
  expanded,
  onToggle,
  onOpenHeading
}: {
  file: WorkspaceOutlineEntry
  absolutePath: string
  expanded: boolean
  onToggle: () => void
  onOpenHeading: (path: string, heading: WorkspaceOutlineHeading) => void
}) {
  return (
    <div className="workspace-outline-file">
      <button type="button" className="workspace-outline-file-header" onClick={onToggle}>
        <span className="workspace-outline-file-chevron">{expanded ? '▾' : '▸'}</span>
        <span className="workspace-outline-file-name" title={file.path}>
          {file.path}
        </span>
        <span className="workspace-outline-file-count">{file.headings.length}</span>
      </button>
      {expanded && (
        <div className="workspace-outline-headings">
          {file.headings.map((heading) => (
            <HeadingRow
              key={`${heading.line}-${heading.level}-${heading.text}`}
              filePath={absolutePath}
              heading={heading}
              onOpen={onOpenHeading}
            />
          ))}
        </div>
      )}
    </div>
  )
}

export function WorkspaceOutline() {
  const { t } = useI18n()
  const workspaceRoot = useAppStore((s) => s.workspaceRoot)
  const openFiles = useAppStore((s) => s.openFiles)
  const revealInEditor = useAppStore((s) => s.revealInEditor)
  const indexStatus = useAppStore((s) => s.indexStatus)

  const [files, setFiles] = useState<WorkspaceOutlineEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState('')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const loadOutline = useCallback(async () => {
    if (!workspaceRoot) {
      setFiles([])
      setError(null)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const outline = await window.compass.index.getOutline(workspaceRoot)
      const next = outline?.files ?? []
      setFiles(next)
      setExpanded((prev) => {
        if (prev.size > 0) {
          const keep = new Set<string>()
          for (const file of next) {
            if (prev.has(file.path)) keep.add(file.path)
          }
          return keep.size > 0 ? keep : new Set(next.slice(0, 8).map((f) => f.path))
        }
        return new Set(next.slice(0, 8).map((f) => f.path))
      })
    } catch (err) {
      setFiles([])
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [workspaceRoot])

  useEffect(() => {
    void loadOutline()
  }, [loadOutline, indexStatus])

  useEffect(() => {
    if (!workspaceRoot) return
    const unsub = window.compass.index.onUpdated((result) => {
      if (result.workspaceRoot === workspaceRoot) void loadOutline()
    })
    return unsub
  }, [workspaceRoot, loadOutline])

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase()
    if (!q) return files
    return files
      .map((file) => {
        const pathMatch = file.path.toLowerCase().includes(q)
        const headings = pathMatch
          ? file.headings
          : file.headings.filter((h) => h.text.toLowerCase().includes(q))
        if (!pathMatch && headings.length === 0) return null
        return { ...file, headings: pathMatch ? file.headings : headings }
      })
      .filter((f): f is WorkspaceOutlineEntry => f !== null)
  }, [files, filter])

  const handleOpenHeading = useCallback(
    async (path: string, heading: WorkspaceOutlineHeading) => {
      const alreadyOpen = openFiles.some(
        (f) => f.path.replace(/\\/g, '/') === path.replace(/\\/g, '/')
      )
      if (!alreadyOpen) {
        await openWorkspaceFile(path)
      }
      revealInEditor(path, heading.line, 1, Math.max(2, heading.text.length + 1))
    },
    [openFiles, revealInEditor]
  )

  if (!workspaceRoot) {
    return (
      <div className="workspace-outline-panel">
        <div className="workspace-outline-empty">{t('outline.noWorkspace')}</div>
      </div>
    )
  }

  return (
    <div className="workspace-outline-panel">
      <div className="workspace-outline-toolbar">
        <input
          type="search"
          className="search-input"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder={t('outline.filterPlaceholder')}
          aria-label={t('outline.filterPlaceholder')}
        />
      </div>
      <div className="workspace-outline-body">
        {loading && files.length === 0 ? (
          <div className="workspace-outline-empty">{t('outline.loading')}</div>
        ) : error ? (
          <div className="workspace-outline-empty">{error}</div>
        ) : filtered.length === 0 ? (
          <div className="workspace-outline-empty">{t('outline.empty')}</div>
        ) : (
          filtered.map((file) => {
            const absolutePath = toAbsolutePath(workspaceRoot, file.path)
            const isExpanded = expanded.has(file.path)
            return (
              <FileOutlineGroup
                key={file.path}
                file={file}
                absolutePath={absolutePath}
                expanded={isExpanded}
                onToggle={() =>
                  setExpanded((prev) => {
                    const next = new Set(prev)
                    if (next.has(file.path)) next.delete(file.path)
                    else next.add(file.path)
                    return next
                  })
                }
                onOpenHeading={handleOpenHeading}
              />
            )
          })
        )}
      </div>
    </div>
  )
}
