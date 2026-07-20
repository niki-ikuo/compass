import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { marked } from 'marked'
import { useI18n } from '@/i18n'
import { useAppStore } from '@/stores/app-store'
import { getLlmProvider } from '@/utils/llm-providers'
import { CloseIcon } from './icons/ToolbarIcons'
import {
  HELP_ASK_DEFAULT_HEIGHT,
  HELP_ASK_DEFAULT_WIDTH,
  HelpResizeHandle,
  clampHelpSize,
  commandLabelKey,
  isHelpCommandId,
  type HelpCommandId
} from './help-shared'

marked.setOptions({
  gfm: true,
  breaks: true
})

interface HelpAskDialogProps {
  open: boolean
  onClose: () => void
  onCommand: (command: HelpCommandId) => void
  onOpenArticle: (docId: string) => void
  onOpenHelp: () => void
}

export function HelpAskDialog({
  open,
  onClose,
  onCommand,
  onOpenArticle,
  onOpenHelp
}: HelpAskDialogProps) {
  const { t, locale } = useI18n()
  const askInputRef = useRef<HTMLTextAreaElement>(null)
  const settings = useAppStore((s) => s.settings)
  const [askQuestion, setAskQuestion] = useState('')
  const [askAnswer, setAskAnswer] = useState('')
  const [askError, setAskError] = useState<string | null>(null)
  const [askSources, setAskSources] = useState<Array<{ id: string; title: string }>>([])
  const [askCommands, setAskCommands] = useState<HelpCommandId[]>([])
  const [askLoading, setAskLoading] = useState(false)
  const [size, setSize] = useState(() =>
    typeof window === 'undefined'
      ? { width: HELP_ASK_DEFAULT_WIDTH, height: HELP_ASK_DEFAULT_HEIGHT }
      : clampHelpSize(HELP_ASK_DEFAULT_WIDTH, HELP_ASK_DEFAULT_HEIGHT)
  )

  const aiReady = useMemo(() => {
    const provider = getLlmProvider(settings.providerId)
    return provider.requiresApiKey ? Boolean(settings.apiKey.trim()) : Boolean(settings.apiBaseUrl.trim())
  }, [settings.providerId, settings.apiKey, settings.apiBaseUrl])

  const askAnswerHtml = useMemo(() => {
    if (!askAnswer) return ''
    try {
      return marked.parse(askAnswer) as string
    } catch {
      return t('markdown.previewFailed')
    }
  }, [askAnswer, t])

  const handleResize = useCallback((deltaWidth: number, deltaHeight: number) => {
    setSize((current) =>
      clampHelpSize(current.width + deltaWidth, current.height + deltaHeight)
    )
  }, [])

  const resetAsk = useCallback(() => {
    setAskQuestion('')
    setAskAnswer('')
    setAskError(null)
    setAskSources([])
    setAskCommands([])
    setAskLoading(false)
    void window.compass.help.cancelAsk()
  }, [])

  useEffect(() => {
    if (!open) return
    const onWindowResize = (): void => {
      setSize((current) => clampHelpSize(current.width, current.height))
    }
    window.addEventListener('resize', onWindowResize)
    return () => window.removeEventListener('resize', onWindowResize)
  }, [open])

  useEffect(() => {
    if (!open) return

    resetAsk()
    const timer = window.setTimeout(() => askInputRef.current?.focus(), 0)

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown, true)
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('keydown', handleKeyDown, true)
    }
  }, [open, onClose, resetAsk])

  useEffect(() => {
    if (open) return
    void window.compass.help.cancelAsk()
  }, [open])

  const handleAsk = useCallback(
    async (event?: FormEvent) => {
      event?.preventDefault()
      const question = askQuestion.trim()
      if (!question || askLoading || !aiReady) return

      setAskLoading(true)
      setAskError(null)
      setAskAnswer('')
      setAskSources([])
      setAskCommands([])

      try {
        const result = await window.compass.help.ask({
          question,
          locale
        })
        if (result.cancelled) return
        if (result.error) {
          setAskError(result.error)
          setAskSources(result.sources)
          setAskCommands(result.commands.filter(isHelpCommandId))
          return
        }
        setAskAnswer(result.answer)
        setAskSources(result.sources)
        setAskCommands(result.commands.filter(isHelpCommandId))
      } catch (err) {
        setAskError(err instanceof Error ? err.message : t('help.aiAskFailed'))
      } finally {
        setAskLoading(false)
      }
    },
    [askQuestion, askLoading, aiReady, locale, t]
  )

  const handleStopAsk = useCallback(() => {
    void window.compass.help.cancelAsk()
    setAskLoading(false)
  }, [])

  if (!open) return null

  return (
    <div className="modal-overlay" onMouseDown={onClose}>
      <div
        className="modal help-ask-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="help-ask-dialog-title"
        style={{ width: size.width, height: size.height }}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="modal-header">
          <h2 id="help-ask-dialog-title">{t('help.aiTitle')}</h2>
          <div className="help-header-actions">
            <button type="button" className="btn-secondary help-header-ask" onClick={onOpenHelp}>
              {t('help.openBrowseHelp')}
            </button>
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

        <div className="help-ask-body">
          {!aiReady ? (
            <div className="help-ask-locked">
              <p>{t('help.aiNeedApi')}</p>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => {
                  onCommand('Open Settings')
                  onClose()
                }}
              >
                {t('help.cmdOpenSettings')}
              </button>
            </div>
          ) : (
            <form className="help-ask-form" onSubmit={(event) => void handleAsk(event)}>
              <textarea
                ref={askInputRef}
                className="help-ask-input"
                rows={3}
                value={askQuestion}
                onChange={(event) => setAskQuestion(event.target.value)}
                placeholder={t('help.aiPlaceholder')}
                aria-label={t('help.aiTitle')}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault()
                    void handleAsk()
                  }
                }}
              />
              <div className="help-ask-actions">
                {askLoading ? (
                  <button type="button" className="btn-secondary" onClick={handleStopAsk}>
                    {t('help.aiStop')}
                  </button>
                ) : (
                  <button type="submit" className="btn-primary" disabled={!askQuestion.trim()}>
                    {t('help.aiAsk')}
                  </button>
                )}
              </div>
            </form>
          )}

          {askLoading && <p className="help-status">{t('help.aiThinking')}</p>}
          {askError && <p className="help-error">{askError}</p>}
          {askAnswer && (
            <div className="help-ask-answer markdown-preview">
              <div className="markdown-body" dangerouslySetInnerHTML={{ __html: askAnswerHtml }} />
            </div>
          )}
          {askSources.length > 0 && (
            <div className="help-ask-sources">
              <div className="help-footer-label">{t('help.aiSources')}</div>
              <div className="help-related-links">
                {askSources.map((source) => (
                  <button
                    key={source.id}
                    type="button"
                    className="help-related-link"
                    onClick={() => onOpenArticle(source.id)}
                  >
                    {source.title}
                  </button>
                ))}
              </div>
            </div>
          )}
          {askCommands.length > 0 && (
            <div className="help-ask-commands">
              <div className="help-footer-label">{t('help.actions')}</div>
              <div className="help-command-buttons">
                {askCommands.map((command) => (
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

        <HelpResizeHandle onResize={handleResize} />
      </div>
    </div>
  )
}
