import {
  createElement,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent
} from 'react'
import { useAppStore } from '@/stores/app-store'
import { normalizeBrowserUrl } from '@/utils/browser-tab'
import { useI18n } from '@/i18n'
import { ArrowLeftIcon, ArrowRightIcon, RefreshIcon, StopIcon } from './icons/ToolbarIcons'

interface ElectronWebView extends HTMLElement {
  src: string
  getURL: () => string
  getTitle: () => string
  canGoBack: () => boolean
  canGoForward: () => boolean
  goBack: () => void
  goForward: () => void
  reload: () => void
  stop: () => void
  loadURL: (url: string) => void
}

interface BrowserViewerProps {
  path: string
  initialUrl: string
}

export function BrowserViewer({ path, initialUrl }: BrowserViewerProps) {
  const { t } = useI18n()
  const updateBrowserTab = useAppStore((s) => s.updateBrowserTab)
  const webviewRef = useRef<ElectronWebView | null>(null)
  const [address, setAddress] = useState(initialUrl === 'about:blank' ? '' : initialUrl)
  const [loading, setLoading] = useState(false)
  const [canBack, setCanBack] = useState(false)
  const [canForward, setCanForward] = useState(false)

  useEffect(() => {
    const view = webviewRef.current
    if (!view) return

    const syncNav = () => {
      try {
        setCanBack(view.canGoBack())
        setCanForward(view.canGoForward())
        const url = view.getURL()
        if (url && url !== 'about:blank') {
          setAddress(url)
          updateBrowserTab(path, { browserUrl: url })
        }
      } catch {
        // webview 未準備
      }
    }

    const onStart = () => setLoading(true)
    const onStop = () => {
      setLoading(false)
      syncNav()
    }
    const onNavigate = () => syncNav()
    const onTitle = (event: Event) => {
      const title = (event as Event & { title?: string }).title || view.getTitle()
      if (title) updateBrowserTab(path, { browserTitle: title })
    }
    const onFail = () => setLoading(false)

    view.addEventListener('did-start-loading', onStart)
    view.addEventListener('did-stop-loading', onStop)
    view.addEventListener('did-navigate', onNavigate)
    view.addEventListener('did-navigate-in-page', onNavigate)
    view.addEventListener('page-title-updated', onTitle)
    view.addEventListener('did-fail-load', onFail)

    return () => {
      view.removeEventListener('did-start-loading', onStart)
      view.removeEventListener('did-stop-loading', onStop)
      view.removeEventListener('did-navigate', onNavigate)
      view.removeEventListener('did-navigate-in-page', onNavigate)
      view.removeEventListener('page-title-updated', onTitle)
      view.removeEventListener('did-fail-load', onFail)
    }
  }, [path, updateBrowserTab])

  const navigateTo = (raw: string) => {
    const url = normalizeBrowserUrl(raw)
    setAddress(url === 'about:blank' ? '' : url)
    updateBrowserTab(path, { browserUrl: url })
    const view = webviewRef.current
    if (!view) return
    try {
      view.loadURL(url)
    } catch {
      view.src = url
    }
  }

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault()
    navigateTo(address)
  }

  const handleAddressKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      const view = webviewRef.current
      try {
        const url = view?.getURL()
        if (url && url !== 'about:blank') setAddress(url)
      } catch {
        // ignore
      }
    }
  }

  return (
    <div className="browser-viewer">
      <div className="browser-toolbar">
        <div className="browser-nav">
          <button
            type="button"
            className="browser-nav-btn"
            disabled={!canBack}
            title={t('browser.back')}
            onClick={() => webviewRef.current?.goBack()}
          >
            <ArrowLeftIcon />
          </button>
          <button
            type="button"
            className="browser-nav-btn"
            disabled={!canForward}
            title={t('browser.forward')}
            onClick={() => webviewRef.current?.goForward()}
          >
            <ArrowRightIcon />
          </button>
          <button
            type="button"
            className="browser-nav-btn"
            title={loading ? t('browser.stop') : t('browser.reload')}
            onClick={() => {
              if (loading) webviewRef.current?.stop()
              else webviewRef.current?.reload()
            }}
          >
            {loading ? <StopIcon /> : <RefreshIcon />}
          </button>
        </div>
        <form className="browser-address-form" onSubmit={handleSubmit}>
          <input
            className="browser-address"
            type="text"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            onKeyDown={handleAddressKeyDown}
            placeholder={t('browser.addressPlaceholder')}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
          />
        </form>
        <button
          type="button"
          className="browser-go-btn"
          title={t('browser.go')}
          onClick={() => navigateTo(address)}
        >
          {t('browser.go')}
        </button>
      </div>
      {createElement('webview', {
        ref: (el: ElectronWebView | null) => {
          webviewRef.current = el
        },
        className: 'browser-webview',
        src: initialUrl || 'about:blank',
        allowpopups: 'true',
        partition: 'persist:compass-browser'
      })}
    </div>
  )
}
