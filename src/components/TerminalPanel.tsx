import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { useAppStore } from '@/stores/app-store'
import { generateId } from '@/utils/code-blocks'
import { getColorTheme } from '@/utils/color-theme'
import { TERMINAL_LAYOUT_LIMITS } from '@/components/ResizableLayout'
import type { TerminalShell } from '@/types'
import { useI18n, t as translate } from '@/i18n'
import { ChevronDownIcon, CloseIcon, PlusIcon } from './icons/ToolbarIcons'

interface TerminalTab {
  id: string
  title: string
  shellId: string
}

interface TerminalTabContextMenuState {
  x: number
  y: number
  id: string
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
        '.terminal-new-btn',
        '.terminal-shell-dropdown-btn',
        '.terminal-shell-menu',
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
 * Keep xterm's helper textarea on-screen and writable so Windows IME can attach.
 * Near-zero opacity often breaks Japanese composition in Electron.
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
  }

  textarea.style.width = '12px'
  textarea.style.height = '18px'
  textarea.style.opacity = '1'
  textarea.style.color = 'transparent'
  textarea.style.caretColor = 'transparent'
  textarea.style.background = 'transparent'
  textarea.style.border = 'none'
  textarea.style.zIndex = '10'
  textarea.style.pointerEvents = 'auto'
  textarea.tabIndex = 0
  textarea.readOnly = false
  textarea.disabled = false
  return textarea
}

function focusXterm(
  terminal: Terminal | null,
  isActive: () => boolean,
  skipIfComposing?: () => boolean
): void {
  if (!terminal || !isActive()) return
  if (skipIfComposing?.()) return
  blurMonacoEditors()
  prepareXtermTextarea(terminal)
  terminal.focus()
}

function scheduleFocusXterm(
  terminal: Terminal | null,
  isActive: () => boolean,
  skipIfComposing?: () => boolean
): void {
  for (const delay of [0, 16, 50, 120, 250]) {
    window.setTimeout(() => focusXterm(terminal, isActive, skipIfComposing), delay)
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
  const composingRef = useRef(false)
  const onTitleRef = useRef(onTitle)
  const onExitedRef = useRef(onExited)
  const activeRef = useRef(active)
  const colorThemeId = useAppStore((s) => s.settings.colorTheme)
  const terminalTheme = getColorTheme(colorThemeId).terminal

  onTitleRef.current = onTitle
  onExitedRef.current = onExited
  activeRef.current = active

  const isComposing = useCallback(() => composingRef.current, [])

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
      // xterm handles keys via onData; IME commits via compositionend (deduped below).
      disableStdin: false,
      fontFamily:
        "'Cascadia Code', 'Consolas', 'Yu Gothic UI', 'Meiryo UI', 'MS Gothic', monospace",
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

    // compositionend and xterm onData both fire on IME confirm — send once.
    let lastImeCommit = ''
    let lastImeCommitUntil = 0

    const onDataDisposable = terminal.onData((data) => {
      if (lastImeCommit && data === lastImeCommit && Date.now() < lastImeCommitUntil) {
        lastImeCommit = ''
        return
      }
      sendInput(data)
    })

    terminal.attachCustomKeyEventHandler((event) => {
      if (event.type !== 'keydown') return true

      const imeOwned =
        composingRef.current ||
        event.isComposing ||
        event.key === 'Process' ||
        event.keyCode === 229
      if (imeOwned) return false

      const hasSelection = terminal.hasSelection()
      if (isTerminalCopyShortcut(event, hasSelection)) {
        copyTerminalSelection(terminal)
        return false
      }
      if (isTerminalPasteShortcut(event)) {
        void navigator.clipboard.readText().then((text) => {
          if (!text || !activeRef.current || !inputArmedRef.current) return
          sendInput(normalizeClipboardTextForPty(text))
        })
        return false
      }
      return true
    })

    const textarea = prepareXtermTextarea(terminal)

    const onCompositionStart = (): void => {
      composingRef.current = true
      prepareXtermTextarea(terminal)
    }

    const onCompositionEnd = (event: CompositionEvent): void => {
      composingRef.current = false
      // Empty data = cancelled composition; do not fall back to stale textarea value.
      const text = event.data || ''
      if (text) {
        lastImeCommit = text
        lastImeCommitUntil = Date.now() + 300
        sendInput(text)
      }
      window.setTimeout(() => {
        if (textarea) textarea.value = ''
      }, 0)
    }

    if (textarea) {
      textarea.addEventListener('compositionstart', onCompositionStart)
      textarea.addEventListener('compositionend', onCompositionEnd)
    }

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
        scheduleFocusXterm(
          terminal,
          () => isCurrentMount() && activeRef.current,
          () => composingRef.current
        )
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
      composingRef.current = false
      if (textarea) {
        textarea.removeEventListener('compositionstart', onCompositionStart)
        textarea.removeEventListener('compositionend', onCompositionEnd)
      }
      resizeObserver.disconnect()
      releaseIpcSubscriptions()
      onDataDisposable.dispose()
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
      composingRef.current = false
      return
    }

    inputArmedRef.current = true
    fitTerminal()
    scheduleFocusXterm(terminalRef.current, () => activeRef.current, isComposing)
  }, [active, fitTerminal, focusToken, isComposing])

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

    // Clipboard only — capturing character keydowns breaks Windows IME.
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
    window.addEventListener('copy', handleCopy, true)
    window.addEventListener('paste', handlePaste, true)
    return () => {
      document.removeEventListener('mousedown', handleMouseDown, true)
      window.removeEventListener('copy', handleCopy, true)
      window.removeEventListener('paste', handlePaste, true)
    }
  }, [active, tabId])

  return (
    <div
      className={`terminal-instance${active ? ' is-active' : ' is-hidden'}`}
      ref={containerRef}
      style={{ ['--terminal-bg' as string]: terminalTheme.background }}
      onMouseDown={(event) => {
        if (!activeRef.current) return
        event.stopPropagation()
        inputArmedRef.current = true
        focusXterm(terminalRef.current, () => activeRef.current, isComposing)
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
  const newTerminalMenuRequestId = useAppStore((s) => s.newTerminalMenuRequestId)
  const terminalHeight = useAppStore((s) => s.panelLayout.terminalHeight)
  const setTerminalHeight = useAppStore((s) => s.setTerminalHeight)
  const setShowTerminal = useAppStore((s) => s.setShowTerminal)
  const defaultShellId = useAppStore((s) => s.settings.defaultShellId)
  const colorThemeId = useAppStore((s) => s.settings.colorTheme)
  const terminalBg = getColorTheme(colorThemeId).terminal.background

  const [focusToken, setFocusToken] = useState(0)
  const [shells, setShells] = useState<TerminalShell[]>([])
  const [tabs, setTabs] = useState<TerminalTab[]>([])
  const [activeTabId, setActiveTabId] = useState<string | null>(null)
  const [tabContextMenu, setTabContextMenu] = useState<TerminalTabContextMenuState | null>(null)
  const [shellMenuOpen, setShellMenuOpen] = useState(false)
  const [highlightedShellId, setHighlightedShellId] = useState('')
  const tabCounterRef = useRef(0)
  const autoCreateRequestedRef = useRef(false)
  const tabContextMenuRef = useRef<HTMLDivElement>(null)
  const terminalTabsRef = useRef<HTMLDivElement>(null)
  const shellMenuRef = useRef<HTMLDivElement>(null)
  const newTerminalBtnRef = useRef<HTMLButtonElement>(null)
  const shellDropdownBtnRef = useRef<HTMLButtonElement>(null)

  const closeTabContextMenu = () => setTabContextMenu(null)

  const resolveDefaultShellId = useCallback((): string => {
    if (defaultShellId && shells.some((shell) => shell.id === defaultShellId)) {
      return defaultShellId
    }
    return shells[0]?.id ?? 'powershell'
  }, [defaultShellId, shells])

  const openTerminalTabsKey = tabs.map((tab) => `${tab.id}:${tab.title}`).join('|')

  useLayoutEffect(() => {
    const el = terminalTabsRef.current
    if (!el || !activeTabId) return
    const activeTab = el.querySelector<HTMLElement>('.terminal-tab.active')
    activeTab?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' })
  }, [activeTabId, openTerminalTabsKey])

  useEffect(() => {
    if (showTerminal) {
      setFocusToken((token) => token + 1)
    } else {
      setShellMenuOpen(false)
    }
  }, [showTerminal])

  useEffect(() => {
    void window.compass.terminal.listShells().then((available) => {
      setShells(available)
    })
  }, [defaultShellId])

  const createTab = useCallback(
    (shellId?: string) => {
      if (!workspaceRoot) return
      tabCounterRef.current += 1
      const id = generateId()
      const preferred = shellId ?? resolveDefaultShellId()
      const tab: TerminalTab = {
        id,
        title: t('terminal.tabTitle', { n: tabCounterRef.current }),
        shellId: preferred
      }
      setTabs((prev) => [...prev, tab])
      setActiveTabId(id)
      setShowTerminal(true)
    },
    [workspaceRoot, resolveDefaultShellId, setShowTerminal, t]
  )

  const openShellMenu = useCallback(() => {
    if (!workspaceRoot || shells.length === 0) return
    setShowTerminal(true)
    setHighlightedShellId(resolveDefaultShellId())
    setShellMenuOpen(true)
  }, [workspaceRoot, shells.length, resolveDefaultShellId, setShowTerminal])

  const closeShellMenu = useCallback(() => {
    setShellMenuOpen(false)
  }, [])

  const selectShellAndCreate = useCallback(
    (shellId: string) => {
      closeShellMenu()
      createTab(shellId)
    },
    [closeShellMenu, createTab]
  )

  useEffect(() => {
    if (!workspaceRoot) {
      setTabs([])
      setActiveTabId(null)
      setShellMenuOpen(false)
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
    // パネル非表示中は自動作成しない（全タブ閉鎖後にすぐ開き直すのを防ぐ）
    if (!showTerminal) {
      autoCreateRequestedRef.current = false
      return
    }
    // 初期シェル設定を反映するため、シェル一覧が揃うまで待つ
    if (shells.length === 0) return
    if (autoCreateRequestedRef.current) return
    autoCreateRequestedRef.current = true
    createTab()
  }, [workspaceRoot, tabs.length, createTab, shells.length, showTerminal])

  const lastNewTerminalMenuRequestIdRef = useRef(0)
  useEffect(() => {
    if (newTerminalMenuRequestId === 0) return
    if (newTerminalMenuRequestId === lastNewTerminalMenuRequestIdRef.current) return
    if (!workspaceRoot || shells.length === 0) return
    lastNewTerminalMenuRequestIdRef.current = newTerminalMenuRequestId
    // ショートカットは「＋」と同じく既定シェルで新しいターミナルを開く
    createTab()
  }, [newTerminalMenuRequestId, workspaceRoot, shells.length, createTab])

  const closeTabs = useCallback(
    (tabIds: string[], options?: { activateId?: string }) => {
      if (tabIds.length === 0) return
      closeTabContextMenu()
      const idSet = new Set(tabIds)
      for (const id of tabIds) {
        void window.compass.terminal.kill(id)
      }
      setTabs((prev) => {
        const next = prev.filter((tab) => !idSet.has(tab.id))
        setActiveTabId((current) => {
          if (options?.activateId && next.some((tab) => tab.id === options.activateId)) {
            return options.activateId
          }
          if (current && idSet.has(current)) {
            return next[next.length - 1]?.id ?? null
          }
          return current
        })
        // すべてのターミナルタブを閉じたら領域も閉じる
        if (next.length === 0) {
          setShowTerminal(false)
        }
        return next
      })
    },
    [setShowTerminal]
  )

  const closeTab = useCallback(
    (tabId: string) => {
      closeTabs([tabId])
    },
    [closeTabs]
  )

  useEffect(() => {
    if (!tabContextMenu) return

    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null
      if (target && tabContextMenuRef.current?.contains(target)) return
      closeTabContextMenu()
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeTabContextMenu()
    }
    const onScroll = (event: Event) => {
      // タブをアクティブ化したときの scrollIntoView でメニューが即閉じるのを防ぐ
      const target = event.target
      if (target instanceof Node && terminalTabsRef.current?.contains(target)) return
      closeTabContextMenu()
    }

    window.addEventListener('mousedown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('scroll', onScroll, true)
    return () => {
      window.removeEventListener('mousedown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('scroll', onScroll, true)
    }
  }, [tabContextMenu])

  useEffect(() => {
    if (!shellMenuOpen) return

    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null
      if (target && shellMenuRef.current?.contains(target)) return
      closeShellMenu()
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        closeShellMenu()
        shellDropdownBtnRef.current?.focus()
        return
      }
      if (shells.length === 0) return
      const currentIndex = Math.max(
        0,
        shells.findIndex((shell) => shell.id === highlightedShellId)
      )
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        const next = shells[(currentIndex + 1) % shells.length]
        setHighlightedShellId(next.id)
        return
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault()
        const prev = shells[(currentIndex - 1 + shells.length) % shells.length]
        setHighlightedShellId(prev.id)
        return
      }
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        const shell = shells.find((s) => s.id === highlightedShellId) ?? shells[0]
        selectShellAndCreate(shell.id)
      }
    }

    window.addEventListener('mousedown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('mousedown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [shellMenuOpen, shells, highlightedShellId, closeShellMenu, selectShellAndCreate])

  useLayoutEffect(() => {
    if (!shellMenuOpen) return
    const item = shellMenuRef.current?.querySelector<HTMLElement>(
      `[data-shell-id="${highlightedShellId}"]`
    )
    item?.focus()
  }, [shellMenuOpen, highlightedShellId])

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
      <div
        className="terminal-panel"
        style={{ height: terminalHeight, ['--terminal-bg' as string]: terminalBg }}
      >
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
    <div
      className="terminal-panel"
      style={{ height: terminalHeight, ['--terminal-bg' as string]: terminalBg }}
    >
      <VerticalResizeHandle onDrag={handleResize} />
      <div className="terminal-panel-header">
        <div className="terminal-tabs" ref={terminalTabsRef}>
          {tabs.map((tab) => (
            <div
              key={tab.id}
              className={`terminal-tab${activeTabId === tab.id ? ' active' : ''}`}
              onClick={() => {
                setActiveTabId(tab.id)
                setFocusToken((token) => token + 1)
              }}
              onContextMenu={(e) => {
                e.preventDefault()
                e.stopPropagation()
                setActiveTabId(tab.id)
                setFocusToken((token) => token + 1)
                setTabContextMenu({ x: e.clientX, y: e.clientY, id: tab.id })
              }}
            >
              <span>{tab.title}</span>
              <button
                type="button"
                className="terminal-tab-close"
                onPointerDown={(e) => {
                  if (e.button !== 0) return
                  e.preventDefault()
                  e.stopPropagation()
                  closeTab(tab.id)
                }}
                onClick={(e) => {
                  e.stopPropagation()
                  closeTab(tab.id)
                }}
                aria-label={t('terminal.closeTab')}
              >
                <CloseIcon />
              </button>
            </div>
          ))}
        </div>

        {tabContextMenu && (
          <div
            ref={tabContextMenuRef}
            className="file-tree-context-menu"
            style={{ left: tabContextMenu.x, top: tabContextMenu.y }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => closeTabs([tabContextMenu.id])}
            >
              {t('editor.closeTab')}
            </button>
            <button
              type="button"
              disabled={tabs.length <= 1}
              onClick={() => {
                if (tabs.length <= 1) return
                const others = tabs
                  .filter((tab) => tab.id !== tabContextMenu.id)
                  .map((tab) => tab.id)
                closeTabs(others, { activateId: tabContextMenu.id })
              }}
            >
              {t('editor.closeOtherTabs')}
            </button>
            <button
              type="button"
              onClick={() => {
                closeTabs(tabs.map((tab) => tab.id))
              }}
            >
              {t('editor.closeAllTabs')}
            </button>
          </div>
        )}

        <div className="terminal-panel-actions">
          {shells.length > 0 && (
            <div className="terminal-new-wrap" ref={shellMenuRef}>
              <button
                ref={newTerminalBtnRef}
                type="button"
                className="terminal-new-btn"
                onClick={() => {
                  closeShellMenu()
                  createTab()
                }}
                title={`${t('terminal.new')} (${t('menu.newTerminalShortcut')})`}
                aria-label={t('terminal.new')}
              >
                <PlusIcon />
              </button>
              <button
                ref={shellDropdownBtnRef}
                type="button"
                className={`terminal-shell-dropdown-btn${shellMenuOpen ? ' open' : ''}`}
                onClick={() => {
                  if (shellMenuOpen) {
                    closeShellMenu()
                  } else {
                    openShellMenu()
                  }
                }}
                title={t('terminal.selectShell')}
                aria-label={t('terminal.selectShell')}
                aria-haspopup="menu"
                aria-expanded={shellMenuOpen}
              >
                <ChevronDownIcon />
              </button>
              {shellMenuOpen && (
                <div className="terminal-shell-menu" role="menu">
                  {shells.map((shell) => (
                    <button
                      key={shell.id}
                      type="button"
                      role="menuitem"
                      data-shell-id={shell.id}
                      className={`terminal-shell-menu-item${
                        shell.id === highlightedShellId ? ' highlighted' : ''
                      }`}
                      onMouseEnter={() => setHighlightedShellId(shell.id)}
                      onClick={() => selectShellAndCreate(shell.id)}
                    >
                      <span className="terminal-shell-menu-check" aria-hidden="true">
                        {shell.id === resolveDefaultShellId() ? '✓' : ''}
                      </span>
                      <span>{shell.label}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
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
            onExited={() => closeTab(tab.id)}
          />
        ))}
      </div>
    </div>
  )
}
