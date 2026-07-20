import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import { marked } from 'marked'
import { useI18n } from '@/i18n'
import type { HelpDoc, HelpDocMeta, HelpSearchHit } from '@/types'
import { CloseIcon } from './icons/ToolbarIcons'
import {
  HELP_DEFAULT_HEIGHT,
  HELP_DEFAULT_WIDTH,
  HelpResizeHandle,
  clampHelpSize,
  commandLabelKey,
  isHelpCommandId,
  resolveRelativeHelpId,
  type HelpCommandId
} from './help-shared'

marked.setOptions({
  gfm: true,
  breaks: true
})

export type { HelpCommandId }

interface HelpDialogProps {
  open: boolean
  initialDocId?: string
  onClose: () => void
  onCommand: (command: HelpCommandId) => void
  onOpenAsk: () => void
  showAiHelp?: boolean
}

export function HelpDialog({
  open,
  initialDocId = 'index.md',
  onClose,
  onCommand,
  onOpenAsk,
  showAiHelp = false
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
          <div className="help-header-actions">
            {showAiHelp && (
              <button type="button" className="btn-secondary help-header-ask" onClick={onOpenAsk}>
                {t('help.openAiHelp')}
              </button>
            )}
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
