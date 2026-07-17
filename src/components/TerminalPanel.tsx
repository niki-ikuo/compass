import { useCallback, useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { useAppStore } from '@/stores/app-store'
import { generateId } from '@/utils/code-blocks'
import { getColorTheme } from '@/utils/color-theme'
import { TERMINAL_LAYOUT_LIMITS } from '@/components/ResizableLayout'
import type { TerminalShell } from '@/types'
import { useI18n, t as translate } from '@/i18n'
import { PlusIcon, CloseIcon } from './icons/ToolbarIcons'

interface TerminalTab {
  id: string
  title: string
  shellId: string
}

interface TerminalInstanceProps {
  tabId: string
  shellId: string
  cwd: string
  active: boolean
  focusToken: number
  onTitle: (title: string) => void
  onExited: () => void
}

/** Mount generation — only used to ignore async results from disposed effects. */
let nextMountGeneration = 0

function normalizeClipboardTextForPty(text: string): string {
  return text.replace(/\r?\n/g, '\r')
}

function copyTerminalSelection(terminal: Terminal | null): boolean {
  if (!terminal?.hasSelection()) return false
  const text = terminal.getSelection()
  if (!text) return false
  void navigator.clipboard.writeText(text).catch(() => {
    // Clipboard may be unavailable in some environments; ignore failures.
  })
  return true
}

function isTerminalCopyShortcut(event: KeyboardEvent, hasSelection: boolean): boolean {
  const { key, ctrlKey, altKey, metaKey, shiftKey } = event
  if (altKey) return false
  if (key !== 'c' && key !== 'C') return false
  // macOS: Cmd+C copies when there is a selection
  if (metaKey && !ctrlKey) return hasSelection
  if (!ctrlKey || metaKey) return false
  // Windows/Linux: Ctrl+Shift+C always copies; Ctrl+C copies when selected
  return shiftKey || hasSelection
}

function isTerminalPasteShortcut(event: KeyboardEvent): boolean {
  const { key, ctrlKey, altKey, metaKey, shiftKey } = event
  if (altKey) return false
  if (key !== 'v' && key !== 'V') return false
  // macOS: Cmd+V; Windows/Linux: Ctrl+Shift+V (Ctrl+V uses the paste event)
  if (metaKey && !ctrlKey) return true
  return Boolean(ctrlKey && !metaKey && shiftKey)
}

function encodeTerminalKey(event: KeyboardEvent): string | null {
  if (event.isComposing) return null

  const { key, ctrlKey, altKey, metaKey, shiftKey } = event

  if (ctrlKey && !altKey && !metaKey) {
    // Ctrl+C is handled in the keydown path when a selection exists (copy).
    if ((key === 'c' || key === 'C') && !shiftKey) return '\x03'
    if (key === 'd' || key === 'D') return '\x04'
    if (key === 'z' || key === 'Z') return '\x1a'
    if (key === 'l' || key === 'L') return '\x0c'
  }

  switch (key) {
    case 'Enter':
      return '\r'
    case 'Backspace':
      return '\x7f'
    case 'Delete':
      return '\x1b[3~'
    case 'Tab':
      return shiftKey ? '\x1b[Z' : '\t'
    case 'Escape':
      return '\x1b'
    case 'ArrowUp':
      return '\x1b[A'
    case 'ArrowDown':
      return '\x1b[B'
    case 'ArrowRight':
      return '\x1b[C'
    case 'ArrowLeft':
      return '\x1b[D'
    case 'Home':
      return '\x1b[H'
    case 'End':
      return '\x1b[F'
    case 'PageUp':
      return '\x1b[5~'
    case 'PageDown':
      return '\x1b[6~'
    default:
      if (key.length === 1 && !ctrlKey && !metaKey) {
        return key
      }
      return null
  }
}

function shouldIgnoreTerminalKeyTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable || Boolean(target.closest('[contenteditable="true"]'))) {
    return true
  }
  return Boolean(
    target.closest(
      [
        '.monaco-editor',
        '.chat-input',
        '.chat-panel textarea',
        '.modal',
        '.modal-body input',
        '.file-tree',
        '.search-panel',
        '.terminal-tab',
        '.terminal-shell-select',
        '.menu-bar'
      ].join(', ')
    )
  )
}

function blurMonacoEditors(): void {
  document.querySelectorAll('.monaco-editor textarea').forEach((node) => {
    if (node instanceof HTMLTextAreaElement) {
      node.blur()
    }
  })
}

/**
 * Electron cannot focus xterm's helper textarea while it is off-screen
 * (`left: -9999em`) or zero-sized. Move it on-screen before focus(); afterwards
 * xterm may reposition it to the cursor for IME.
 */
function prepareXtermTextarea(terminal: Terminal): HTMLTextAreaElement | null {
  const textarea = terminal.textarea ?? null
  if (!textarea) return null

  const left = textarea.style.left
  const offscreen =
    left.includes('-9999') ||
    textarea.offsetWidth === 0 ||
    textarea.offsetHeight === 0 ||
    textarea.getClientRects().length === 0

  if (offscreen) {
    textarea.style.left = '0px'
    textarea.style.top = '0px'
    textarea.style.width = '20px'
    textarea.style.height = '20px'
  }

  if (textarea.style.opacity === '0' || textarea.style.opacity === '') {
    textarea.style.opacity = '0.01'
  }
  if (textarea.style.zIndex === '-5' || textarea.style.zIndex === '') {
    textarea.style.zIndex = '10'
  }
  textarea.style.pointerEvents = 'auto'
  textarea.tabIndex = 0
  textarea.readOnly = false
  textarea.disabled = false
  return textarea
}

function focusXterm(terminal: Terminal | null, isActive: () => boolean): void {
  if (!terminal || !isActive()) return
  blurMonacoEditors()
  prepareXtermTextarea(terminal)
  terminal.focus()
}

function scheduleFocusXterm(terminal: Terminal | null, isActive: () => boolean): void {
  for (const delay of [0, 16, 50, 120, 250]) {
    window.setTimeout(() => focusXterm(terminal, isActive), delay)
  }
}

function TerminalInstance({
  tabId,
  shellId,
  cwd,
  active,
  focusToken,
  onTitle,
  onExited
}: TerminalInstanceProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const terminalRef = useRef<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const sessionRef = useRef(0)
  const ptyReadyRef = useRef(false)
  const pendingInputRef = useRef<string[]>([])
  const sendInputRef = useRef<(data: string) => void>(() => {})
  const inputArmedRef = useRef(false)
  const onTitleRef = useRef(onTitle)
  const onExitedRef = useRef(onExited)
  const activeRef = useRef(active)
  const colorThemeId = useAppStore((s) => s.settings.colorTheme)
  const terminalTheme = getColorTheme(colorThemeId).terminal

  onTitleRef.current = onTitle
  onExitedRef.current = onExited
  activeRef.current = active

  const fitTerminal = useCallback(() => {
    const fitAddon = fitAddonRef.current
    const terminal = terminalRef.current
    if (!fitAddon || !terminal) return
    try {
      fitAddon.fit()
      void window.compass.terminal.resize(tabId, terminal.cols, terminal.rows)
    } catch {
      // ignore fit errors during hidden layout
    }
  }, [tabId])

  useEffect(() => {
    if (!containerRef.current || !cwd) return

    const mountGeneration = ++nextMountGeneration
    sessionRef.current = mountGeneration
    let cancelled = false
    let wroteDeadPtyWarning = false

    const terminal = new Terminal({
      cursorBlink: true,
      cursorStyle: 'block',
      cursorInactiveStyle: 'outline',
      // Input is handled by our keydown → PTY path. xterm is display-only.
      disableStdin: true,
      fontFamily: "'Cascadia Code', 'Consolas', 'Monaco', monospace",
      fontSize: 13,
      theme: getColorTheme(useAppStore.getState().settings.colorTheme).terminal
    })
    const fitAddon = new FitAddon()
    terminal.loadAddon(fitAddon)
    terminal.open(containerRef.current)
    prepareXtermTextarea(terminal)
    fitAddon.fit()
    terminalRef.current = terminal
    fitAddonRef.current = fitAddon

    const isCurrentMount = (): boolean => sessionRef.current === mountGeneration

    const sendInput = (data: string): void => {
      if (!isCurrentMount() || data.length === 0) return
      if (!ptyReadyRef.current) {
        pendingInputRef.current.push(data)
        return
      }
      void window.compass.terminal.write(tabId, data).then(async (ok) => {
        if (ok || !isCurrentMount()) return
        // PTY missing (unexpected exit) — try one recreate
        const recreated = await window.compass.terminal.create(tabId, cwd, shellId)
        if (!isCurrentMount()) return
        if (recreated.ok) {
          if (recreated.replay) terminal.reset()
          if (recreated.replay) terminal.write(recreated.replay)
          const retried = await window.compass.terminal.write(tabId, data)
          if (retried || !isCurrentMount() || wroteDeadPtyWarning) return
        }
        if (wroteDeadPtyWarning) return
        wroteDeadPtyWarning = true
        terminal.writeln(translate('terminal.disconnected'))
      })
    }

    sendInputRef.current = sendInput

    const flushPendingInput = (): void => {
      if (!ptyReadyRef.current) return
      const pending = pendingInputRef.current.splice(0)
      for (const chunk of pending) {
        void window.compass.terminal.write(tabId, chunk)
      }
    }

    let dataUnsub: (() => void) | undefined
    let exitUnsub: (() => void) | undefined

    const releaseIpcSubscriptions = (): void => {
      dataUnsub?.()
      exitUnsub?.()
      dataUnsub = undefined
      exitUnsub = undefined
    }

    const setup = async () => {
      const result = await window.compass.terminal.create(tabId, cwd, shellId)
      if (!isCurrentMount()) return

      if (!result.ok) {
        if (cancelled) return
        terminal.writeln(`\x1b[31m${result.error}\x1b[0m`)
        terminal.writeln(translate('terminal.retryHint'))
        return
      }

      // Replay buffered output after StrictMode remount / reconnect
      if (result.replay) {
        terminal.write(result.replay)
      }

      ptyReadyRef.current = true
      flushPendingInput()

      const unsubData = window.compass.terminal.onData((id, data) => {
        if (id === tabId && isCurrentMount()) terminal.write(data)
      })
      const unsubExit = window.compass.terminal.onExit((id) => {
        if (id !== tabId || !isCurrentMount() || cancelled) return
        ptyReadyRef.current = false
        onExitedRef.current()
      })
      if (!isCurrentMount() || cancelled) {
        unsubData()
        unsubExit()
        return
      }

      dataUnsub = unsubData
      exitUnsub = unsubExit

      void window.compass.terminal.listShells().then((shells) => {
        if (!isCurrentMount() || cancelled) return
        onTitleRef.current(
          shells.find((s) => s.id === result.shellId)?.label ?? translate('terminal.defaultTitle')
        )
      })

      fitTerminal()
      void window.compass.terminal.resize(tabId, terminal.cols, terminal.rows)
      if (activeRef.current) {
        scheduleFocusXterm(terminal, () => isCurrentMount() && activeRef.current)
      }
    }

    void setup()

    const resizeObserver = new ResizeObserver(() => {
      fitTerminal()
    })
    resizeObserver.observe(containerRef.current)

    return () => {
      cancelled = true
      ptyReadyRef.current = false
      pendingInputRef.current = []
      sendInputRef.current = () => {}
      resizeObserver.disconnect()
      releaseIpcSubscriptions()
      terminal.dispose()
      terminalRef.current = null
      fitAddonRef.current = null
      // Do NOT kill the PTY here — StrictMode remounts and HMR must keep it alive.
      // PTY is killed only when the tab is closed (closeTab / killAll).
    }
  }, [tabId, shellId, cwd, fitTerminal])

  useEffect(() => {
    const terminal = terminalRef.current
    if (!terminal) return
    terminal.options.theme = terminalTheme
  }, [terminalTheme])

  useEffect(() => {
    if (!active) {
      inputArmedRef.current = false
      return
    }

    inputArmedRef.current = true
    fitTerminal()
    scheduleFocusXterm(terminalRef.current, () => activeRef.current)
  }, [active, fitTerminal, focusToken])

  useEffect(() => {
    if (!active) return

    const handleMouseDown = (event: MouseEvent): void => {
      const target = event.target
      if (containerRef.current?.contains(target as Node)) {
        inputArmedRef.current = true
        return
      }
      // Keep arming when interacting with terminal chrome (tabs, shell select, etc.).
      if (target instanceof HTMLElement && target.closest('.terminal-panel')) {
        return
      }
      // Any click outside the terminal panel yields input to the rest of the UI.
      inputArmedRef.current = false
    }

    /**
     * Sole input path: always forward keys to the PTY while this terminal is armed.
     * Do not defer to xterm onData — in Electron the helper textarea can show a
     * focused cursor without delivering key events to onData.
     */
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (!activeRef.current || !inputArmedRef.current) return
      if (event.defaultPrevented || event.isComposing) return
      if (shouldIgnoreTerminalKeyTarget(event.target)) return

      const terminal = terminalRef.current
      const hasSelection = Boolean(terminal?.hasSelection())

      if (isTerminalCopyShortcut(event, hasSelection)) {
        if (!copyTerminalSelection(terminal)) return
        event.preventDefault()
        event.stopPropagation()
        return
      }

      if (isTerminalPasteShortcut(event)) {
        event.preventDefault()
        event.stopPropagation()
        void navigator.clipboard.readText().then((text) => {
          if (!text || !activeRef.current || !inputArmedRef.current) return
          sendInputRef.current(normalizeClipboardTextForPty(text))
        })
        return
      }

      const encoded = encodeTerminalKey(event)
      if (!encoded) return

      event.preventDefault()
      event.stopPropagation()
      focusXterm(terminal, () => activeRef.current)
      sendInputRef.current(encoded)
    }

    const handleCopy = (event: ClipboardEvent): void => {
      if (!activeRef.current || !inputArmedRef.current) return
      if (shouldIgnoreTerminalKeyTarget(event.target)) return
      const terminal = terminalRef.current
      if (!terminal?.hasSelection()) return
      const text = terminal.getSelection()
      if (!text) return
      event.preventDefault()
      event.stopPropagation()
      event.clipboardData?.setData('text/plain', text)
    }

    const handlePaste = (event: ClipboardEvent): void => {
      if (!activeRef.current || !inputArmedRef.current) return
      if (shouldIgnoreTerminalKeyTarget(event.target)) return
      const text = event.clipboardData?.getData('text')
      if (!text) return
      event.preventDefault()
      event.stopPropagation()
      sendInputRef.current(normalizeClipboardTextForPty(text))
    }

    document.addEventListener('mousedown', handleMouseDown, true)
    window.addEventListener('keydown', handleKeyDown, true)
    window.addEventListener('copy', handleCopy, true)
    window.addEventListener('paste', handlePaste, true)
    return () => {
      document.removeEventListener('mousedown', handleMouseDown, true)
      window.removeEventListener('keydown', handleKeyDown, true)
      window.removeEventListener('copy', handleCopy, true)
      window.removeEventListener('paste', handlePaste, true)
    }
  }, [active, tabId])

  return (
    <div
      className={`terminal-instance${active ? ' is-active' : ' is-hidden'}`}
      ref={containerRef}
      onMouseDown={(event) => {
        if (!activeRef.current) return
        event.stopPropagation()
        inputArmedRef.current = true
        focusXterm(terminalRef.current, () => activeRef.current)
      }}
    />
  )
}

function VerticalResizeHandle({ onDrag }: { onDrag: (deltaY: number) => void }) {
  const [active, setActive] = useState(false)
  const lastYRef = useRef(0)

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault()
    setActive(true)
    lastYRef.current = e.clientY
    document.body.classList.add('is-resizing-terminal')
  }

  useEffect(() => {
    if (!active) return

    const handleMouseMove = (e: MouseEvent) => {
      const delta = lastYRef.current - e.clientY
      lastYRef.current = e.clientY
      onDrag(delta)
    }

    const handleMouseUp = () => {
      setActive(false)
      document.body.classList.remove('is-resizing-terminal')
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [active, onDrag])

  return (
    <div className={`terminal-resize-handle${active ? ' active' : ''}`} onMouseDown={handleMouseDown} />
  )
}

export function TerminalPanel() {
  const { t } = useI18n()
  const workspaceRoot = useAppStore((s) => s.workspaceRoot)
  const showTerminal = useAppStore((s) => s.showTerminal)
  const terminalHeight = useAppStore((s) => s.panelLayout.terminalHeight)
  const setTerminalHeight = useAppStore((s) => s.setTerminalHeight)
  const setShowTerminal = useAppStore((s) => s.setShowTerminal)
  const defaultShellId = useAppStore((s) => s.settings.defaultShellId)

  const [focusToken, setFocusToken] = useState(0)
  const [shells, setShells] = useState<TerminalShell[]>([])
  const [selectedShellId, setSelectedShellId] = useState<string>('')
  const [tabs, setTabs] = useState<TerminalTab[]>([])
  const [activeTabId, setActiveTabId] = useState<string | null>(null)
  const tabCounterRef = useRef(0)
  const autoCreateRequestedRef = useRef(false)

  useEffect(() => {
    if (showTerminal) {
      setFocusToken((token) => token + 1)
    }
  }, [showTerminal])

  useEffect(() => {
    void window.compass.terminal.listShells().then((available) => {
      setShells(available)
      if (available.length === 0) return
      setSelectedShellId((current) => {
        if (defaultShellId && available.some((shell) => shell.id === defaultShellId)) {
          return defaultShellId
        }
        if (current && available.some((shell) => shell.id === current)) return current
        return available[0].id
      })
    })
  }, [defaultShellId])

  const createTab = useCallback(
    (shellId?: string) => {
      if (!workspaceRoot) return
      tabCounterRef.current += 1
      const id = generateId()
      const preferred =
        shellId ??
        selectedShellId ??
        (defaultShellId && shells.some((shell) => shell.id === defaultShellId)
          ? defaultShellId
          : undefined) ??
        shells[0]?.id ??
        'powershell'
      const tab: TerminalTab = {
        id,
        title: t('terminal.tabTitle', { n: tabCounterRef.current }),
        shellId: preferred
      }
      setTabs((prev) => [...prev, tab])
      setActiveTabId(id)
    },
    [workspaceRoot, selectedShellId, defaultShellId, shells, t]
  )

  useEffect(() => {
    if (!workspaceRoot) {
      setTabs([])
      setActiveTabId(null)
      void window.compass.terminal.killAll()
      return
    }

    void window.compass.terminal.setCwd(workspaceRoot)
  }, [workspaceRoot])

  useEffect(() => {
    if (!workspaceRoot) {
      autoCreateRequestedRef.current = false
      return
    }
    if (tabs.length > 0) {
      autoCreateRequestedRef.current = false
      return
    }
    // 初期シェル設定を反映するため、シェル一覧と選択状態が揃うまで待つ
    if (shells.length === 0 || !selectedShellId) return
    if (autoCreateRequestedRef.current) return
    autoCreateRequestedRef.current = true
    createTab()
  }, [workspaceRoot, tabs.length, createTab, shells.length, selectedShellId])

  const closeTab = useCallback(
    (tabId: string, options?: { hidePanelWhenEmpty?: boolean }) => {
      void window.compass.terminal.kill(tabId)
      setTabs((prev) => {
        const next = prev.filter((tab) => tab.id !== tabId)
        if (activeTabId === tabId) {
          setActiveTabId(next[next.length - 1]?.id ?? null)
        }
        if (next.length === 0 && options?.hidePanelWhenEmpty) {
          setShowTerminal(false)
        }
        return next
      })
    },
    [activeTabId, setShowTerminal]
  )

  const handleShellChange = (shellId: string) => {
    setSelectedShellId(shellId)
  }

  const handleResize = useCallback(
    (deltaY: number) => {
      const next = Math.min(
        TERMINAL_LAYOUT_LIMITS.max,
        Math.max(TERMINAL_LAYOUT_LIMITS.min, terminalHeight + deltaY)
      )
      setTerminalHeight(next)
    },
    [terminalHeight, setTerminalHeight]
  )

  const updateTabTitle = useCallback((tabId: string, title: string) => {
    setTabs((prev) => prev.map((tab) => (tab.id === tabId ? { ...tab, title } : tab)))
  }, [])

  if (!workspaceRoot) {
    return (
      <div className="terminal-panel" style={{ height: terminalHeight }}>
        <div className="terminal-panel-header">
          <span className="terminal-panel-title">{t('terminal.defaultTitle')}</span>
          <button
            type="button"
            className="terminal-panel-btn"
            onClick={() => setShowTerminal(false)}
            title={t('common.close')}
            aria-label={t('common.close')}
          >
            <CloseIcon />
          </button>
        </div>
        <div className="terminal-empty">{t('menu.terminalDisabled')}</div>
      </div>
    )
  }

  return (
    <div className="terminal-panel" style={{ height: terminalHeight }}>
      <VerticalResizeHandle onDrag={handleResize} />
      <div className="terminal-panel-header">
        <div className="terminal-tabs">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={`terminal-tab${activeTabId === tab.id ? ' active' : ''}`}
              onClick={() => {
                setActiveTabId(tab.id)
                setFocusToken((token) => token + 1)
              }}
            >
              <span>{tab.title}</span>
              <span
                className="terminal-tab-close"
                role="button"
                tabIndex={-1}
                onClick={(e) => {
                  e.stopPropagation()
                  closeTab(tab.id, { hidePanelWhenEmpty: true })
                }}
                aria-label={t('terminal.closeTab')}
              >
                <CloseIcon />
              </span>
            </button>
          ))}
          <button
            type="button"
            className="terminal-tab-add"
            onClick={() => createTab()}
            title={t('terminal.new')}
            aria-label={t('terminal.new')}
          >
            <PlusIcon />
          </button>
        </div>

        <div className="terminal-panel-actions">
          {shells.length > 0 && (
            <select
              className="terminal-shell-select"
              value={selectedShellId}
              onChange={(e) => handleShellChange(e.target.value)}
              title={t('terminal.selectShell')}
            >
              {shells.map((shell) => (
                <option key={shell.id} value={shell.id}>
                  {shell.label}
                </option>
              ))}
            </select>
          )}
          <button
            type="button"
            className="terminal-panel-btn"
            onClick={() => setShowTerminal(false)}
            title={t('terminal.closePanel')}
            aria-label={t('terminal.closePanel')}
          >
            <CloseIcon />
          </button>
        </div>
      </div>

      <div className="terminal-body">
        {tabs.map((tab) => (
          <TerminalInstance
            key={tab.id}
            tabId={tab.id}
            shellId={tab.shellId}
            cwd={workspaceRoot}
            active={showTerminal && activeTabId === tab.id}
            focusToken={focusToken}
            onTitle={(title) => updateTabTitle(tab.id, title)}
            onExited={() => closeTab(tab.id, { hidePanelWhenEmpty: true })}
          />
        ))}
      </div>
    </div>
  )
}
