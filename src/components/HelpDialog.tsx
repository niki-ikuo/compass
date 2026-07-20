import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import { marked } from 'marked'
import { useI18n } from '@/i18n'
import type { HelpDoc, HelpDocMeta, HelpSearchHit } from '@/types'
import { CloseIcon } from './icons/ToolbarIcons'

marked.setOptions({
  gfm: true,
  breaks: true
})

export type HelpCommandId =
  | 'Open Settings'
  | 'Open Provider'
  | 'Open Folder'
  | 'Focus Chat'

interface HelpDialogProps {
  open: boolean
  initialDocId?: string
  onClose: () => void
  onCommand: (command: HelpCommandId) => void
}

function isHelpCommandId(value: string): value is HelpCommandId {
  return (
    value === 'Open Settings' ||
    value === 'Open Provider' ||
    value === 'Open Folder' ||
    value === 'Focus Chat'
  )
}

function commandLabelKey(
  command: HelpCommandId
):
  | 'help.cmdOpenSettings'
  | 'help.cmdOpenProvider'
  | 'help.cmdOpenFolder'
  | 'help.cmdFocusChat' {
  switch (command) {
    case 'Open Settings':
      return 'help.cmdOpenSettings'
    case 'Open Provider':
      return 'help.cmdOpenProvider'
    case 'Open Folder':
      return 'help.cmdOpenFolder'
    case 'Focus Chat':
      return 'help.cmdFocusChat'
  }
}

function resolveRelativeHelpId(fromId: string, href: string): string {
  const raw = href.split('#')[0]?.trim() ?? ''
  if (!raw) return fromId.replace(/\\/g, '/')

  const from = fromId.replace(/\\/g, '/').replace(/^\/+/, '')
  if (!raw.includes('/') && !raw.startsWith('.')) {
    const slash = from.lastIndexOf('/')
    const dir = slash >= 0 ? from.slice(0, slash + 1) : ''
    return `${dir}${raw}`
  }

  const fromDir = from.includes('/') ? from.slice(0, from.lastIndexOf('/')) : ''
  const parts = [...(fromDir ? fromDir.split('/') : []), ...raw.split('/')]
  const stack: string[] = []
  for (const part of parts) {
    if (!part || part === '.') continue
    if (part === '..') {
      stack.pop()
      continue
    }
    stack.push(part)
  }
  return stack.join('/')
}

const HELP_DEFAULT_WIDTH = 960
const HELP_DEFAULT_HEIGHT = 720
const HELP_MIN_WIDTH = 560
const HELP_MIN_HEIGHT = 400

function clampHelpSize(width: number, height: number): { width: number; height: number } {
  const maxWidth = Math.max(HELP_MIN_WIDTH, Math.floor(window.innerWidth * 0.96))
  const maxHeight = Math.max(HELP_MIN_HEIGHT, Math.floor(window.innerHeight * 0.92))
  return {
    width: Math.min(maxWidth, Math.max(HELP_MIN_WIDTH, Math.round(width))),
    height: Math.min(maxHeight, Math.max(HELP_MIN_HEIGHT, Math.round(height)))
  }
}

function HelpResizeHandle({
  onResize
}: {
  onResize: (deltaWidth: number, deltaHeight: number) => void
}) {
  const { t } = useI18n()
  const [active, setActive] = useState(false)
  const lastPosRef = useRef({ x: 0, y: 0 })

  const handleMouseDown = (event: MouseEvent<HTMLDivElement>): void => {
    event.preventDefault()
    event.stopPropagation()
    setActive(true)
    lastPosRef.current = { x: event.clientX, y: event.clientY }
    document.body.classList.add('is-resizing-help')
  }

  useEffect(() => {
    if (!active) return

    const handleMouseMove = (event: globalThis.MouseEvent): void => {
      const deltaWidth = event.clientX - lastPosRef.current.x
      const deltaHeight = event.clientY - lastPosRef.current.y
      lastPosRef.current = { x: event.clientX, y: event.clientY }
      onResize(deltaWidth, deltaHeight)
    }

    const handleMouseUp = (): void => {
      setActive(false)
      document.body.classList.remove('is-resizing-help')
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
      document.body.classList.remove('is-resizing-help')
    }
  }, [active, onResize])

  return (
    <div
      className={`help-resize-handle${active ? ' active' : ''}`}
      onMouseDown={handleMouseDown}
      title={t('help.resize')}
      aria-label={t('help.resize')}
      role="separator"
      aria-orientation="horizontal"
    />
  )
}

export function HelpDialog({
  open,
  initialDocId = 'index.md',
  onClose,
  onCommand
}: HelpDialogProps) {
  const { t, locale } = useI18n()
  const searchRef = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  const [docs, setDocs] = useState<HelpDocMeta[]>([])
  const [hits, setHits] = useState<HelpSearchHit[]>([])
  const [doc, setDoc] = useState<HelpDoc | null>(null)
  const [activeId, setActiveId] = useState(initialDocId)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [size, setSize] = useState(() =>
    typeof window === 'undefined'
      ? { width: HELP_DEFAULT_WIDTH, height: HELP_DEFAULT_HEIGHT }
      : clampHelpSize(HELP_DEFAULT_WIDTH, HELP_DEFAULT_HEIGHT)
  )

  const handleResize = useCallback((deltaWidth: number, deltaHeight: number) => {
    setSize((current) =>
      clampHelpSize(current.width + deltaWidth, current.height + deltaHeight)
    )
  }, [])

  useEffect(() => {
    if (!open) return
    const onWindowResize = (): void => {
      setSize((current) => clampHelpSize(current.width, current.height))
    }
    window.addEventListener('resize', onWindowResize)
    return () => window.removeEventListener('resize', onWindowResize)
  }, [open])

  const loadDoc = useCallback(
    async (id: string) => {
      setLoading(true)
      setError(null)
      try {
        const next = await window.compass.help.get(id, locale)
        setDoc(next)
        setActiveId(next.id)
      } catch (err) {
        setError(err instanceof Error ? err.message : t('help.loadFailed'))
        setDoc(null)
      } finally {
        setLoading(false)
      }
    },
    [t, locale]
  )

  useEffect(() => {
    if (!open) return

    setQuery('')
    setHits([])
    setActiveId(initialDocId)
    void loadDoc(initialDocId)
    void window.compass.help.list(locale).then(setDocs).catch(() => setDocs([]))

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [open, initialDocId, loadDoc, onClose, locale])

  useEffect(() => {
    if (!open) return
    const q = query.trim()
    if (!q) {
      setHits([])
      return
    }

    let cancelled = false
    const timer = window.setTimeout(() => {
      void window.compass.help.search(q, locale).then((result) => {
        if (!cancelled) setHits(result)
      })
    }, 120)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [open, query, locale])

  const html = useMemo(() => {
    if (!doc) return ''
    try {
      return marked.parse(doc.body) as string
    } catch {
      return t('markdown.previewFailed')
    }
  }, [doc, t])

  const sidebarItems = query.trim() ? hits : docs

  const handleContentClick = (event: MouseEvent<HTMLDivElement>): void => {
    const target = (event.target as HTMLElement).closest('a')
    if (!target) return
    const href = target.getAttribute('href')
    if (!href) return

    if (/^https?:\/\//i.test(href)) {
      event.preventDefault()
      void window.compass.shell.openExternal(href)
      return
    }

    if (href.toLowerCase().includes('.md')) {
      event.preventDefault()
      const resolved = resolveRelativeHelpId(activeId, href)
      setQuery('')
      void loadDoc(resolved)
    }
  }

  if (!open) return null

  return (
    <div className="modal-overlay" onMouseDown={onClose}>
      <div
        className="modal help-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="help-dialog-title"
        style={{ width: size.width, height: size.height }}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="modal-header">
          <h2 id="help-dialog-title">{t('help.title')}</h2>
          <button
            type="button"
            className="btn-icon"
            onClick={onClose}
            title={t('common.close')}
            aria-label={t('common.close')}
          >
            <CloseIcon />
          </button>
        </div>

        <div className="help-layout">
          <aside className="help-sidebar">
            <input
              ref={searchRef}
              className="help-search-input"
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t('help.searchPlaceholder')}
              aria-label={t('help.searchPlaceholder')}
            />
            <div className="help-sidebar-list" role="listbox" aria-label={t('help.topics')}>
              {sidebarItems.length === 0 ? (
                <p className="help-sidebar-empty">
                  {query.trim() ? t('help.noResults') : t('help.empty')}
                </p>
              ) : (
                sidebarItems.map((item) => {
                  const id = item.id
                  const title = item.title
                  const snippet = 'snippet' in item ? item.snippet : undefined
                  return (
                    <button
                      key={id}
                      type="button"
                      role="option"
                      aria-selected={id === activeId}
                      className={`help-sidebar-item${id === activeId ? ' active' : ''}`}
                      onClick={() => {
                        void loadDoc(id)
                      }}
                    >
                      <span className="help-sidebar-item-title">{title}</span>
                      {snippet && <span className="help-sidebar-item-snippet">{snippet}</span>}
                    </button>
                  )
                })
              )}
            </div>
          </aside>

          <section className="help-content">
            {loading && <p className="help-status">{t('help.loading')}</p>}
            {error && <p className="help-error">{error}</p>}
            {!loading && !error && doc && (
              <>
                <div className="markdown-preview help-markdown" onClick={handleContentClick}>
                  <div className="markdown-body" dangerouslySetInnerHTML={{ __html: html }} />
                </div>

                {(doc.related.length > 0 || doc.commands.length > 0) && (
                  <div className="help-footer">
                    {doc.related.length > 0 && (
                      <div className="help-related">
                        <div className="help-footer-label">{t('help.related')}</div>
                        <div className="help-related-links">
                          {doc.related.map((relatedId) => {
                            const meta = docs.find((d) => d.id === relatedId)
                            return (
                              <button
                                key={relatedId}
                                type="button"
                                className="help-related-link"
                                onClick={() => void loadDoc(relatedId)}
                              >
                                {meta?.title ?? relatedId}
                              </button>
                            )
                          })}
                        </div>
                      </div>
                    )}
                    {doc.commands.length > 0 && (
                      <div className="help-commands">
                        <div className="help-footer-label">{t('help.actions')}</div>
                        <div className="help-command-buttons">
                          {doc.commands.filter(isHelpCommandId).map((command) => (
                            <button
                              key={command}
                              type="button"
                              className="btn-secondary"
                              onClick={() => {
                                onCommand(command)
                                onClose()
                              }}
                            >
                              {t(commandLabelKey(command))}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </section>
        </div>
        <HelpResizeHandle onResize={handleResize} />
      </div>
    </div>
  )
}
