import { useCallback, useEffect, useRef, useState } from 'react'
import { SettingsIcon, ExplorerIcon, ChatIcon, TerminalIcon, SearchIcon } from './icons/ToolbarIcons'
import { useAppStore } from '@/stores/app-store'
import type { LeftSidebarView } from '@/types'

interface MenuBarProps {
  showFileTree: boolean
  showChat: boolean
  showTerminal: boolean
  leftSidebarView: LeftSidebarView
  onToggleFileTree: () => void
  onOpenSearch: () => void
  onToggleChat: () => void
  onToggleTerminal: () => void
  onOpenSettings: () => void
  onOpenFolder: () => void
  onCloseFolder: () => void
  onSave: () => void
}

type MenuId = 'file' | 'edit' | 'view' | 'help'

interface MenuItem {
  label: string
  shortcut?: string
  action: () => void
  separator?: boolean
}

function MenuDropdown({
  id,
  label,
  items,
  openMenu,
  onOpen,
  onClose
}: {
  id: MenuId
  label: string
  items: MenuItem[]
  openMenu: MenuId | null
  onOpen: (id: MenuId) => void
  onClose: () => void
}) {
  const isOpen = openMenu === id

  return (
    <div className={`menu-bar-item${isOpen ? ' open' : ''}`}>
      <button
        type="button"
        className="menu-bar-trigger"
        onClick={() => (isOpen ? onClose() : onOpen(id))}
        onMouseEnter={() => {
          if (openMenu !== null) onOpen(id)
        }}
        aria-expanded={isOpen}
        aria-haspopup="menu"
      >
        {label}
      </button>
      {isOpen && (
        <div className="menu-bar-dropdown" role="menu">
          {items.map((item, index) =>
            item.separator ? (
              <div key={`sep-${index}`} className="menu-bar-separator" role="separator" />
            ) : (
              <button
                key={item.label}
                type="button"
                role="menuitem"
                className="menu-bar-dropdown-item"
                onClick={() => {
                  item.action()
                  onClose()
                }}
              >
                <span>{item.label}</span>
                {item.shortcut && <span className="menu-bar-shortcut">{item.shortcut}</span>}
              </button>
            )
          )}
        </div>
      )}
    </div>
  )
}

export function MenuBar({
  showFileTree,
  showChat,
  showTerminal,
  leftSidebarView,
  onToggleFileTree,
  onOpenSearch,
  onToggleChat,
  onToggleTerminal,
  onOpenSettings,
  onOpenFolder,
  onCloseFolder,
  onSave
}: MenuBarProps) {
  const [openMenu, setOpenMenu] = useState<MenuId | null>(null)
  const barRef = useRef<HTMLDivElement>(null)
  const workspaceRoot = useAppStore((s) => s.workspaceRoot)
  const openSearchPanel = useAppStore((s) => s.openSearchPanel)

  const closeMenu = useCallback(() => setOpenMenu(null), [])

  useEffect(() => {
    if (openMenu === null) return

    const handlePointerDown = (event: MouseEvent) => {
      if (!barRef.current?.contains(event.target as Node)) {
        closeMenu()
      }
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeMenu()
    }

    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [openMenu, closeMenu])

  const fileItems: MenuItem[] = [
    { label: 'フォルダを開く', shortcut: 'Ctrl+O', action: onOpenFolder },
    { label: 'フォルダを閉じる', shortcut: 'Ctrl+Shift+W', action: onCloseFolder },
    { label: '保存', shortcut: 'Ctrl+S', action: onSave },
    { separator: true, label: '', action: () => {} },
    { label: '設定', shortcut: 'Ctrl+,', action: onOpenSettings },
    { separator: true, label: '', action: () => {} },
    { label: '終了', shortcut: 'Alt+F4', action: () => void window.compass.shell.quit() }
  ]

  const editItems: MenuItem[] = [
    { label: '元に戻す', shortcut: 'Ctrl+Z', action: () => void window.compass.shell.edit('undo') },
    { label: 'やり直し', shortcut: 'Ctrl+Y', action: () => void window.compass.shell.edit('redo') },
    { separator: true, label: '', action: () => {} },
    { label: '切り取り', shortcut: 'Ctrl+X', action: () => void window.compass.shell.edit('cut') },
    { label: 'コピー', shortcut: 'Ctrl+C', action: () => void window.compass.shell.edit('copy') },
    { label: '貼り付け', shortcut: 'Ctrl+V', action: () => void window.compass.shell.edit('paste') },
    { separator: true, label: '', action: () => {} },
    {
      label: 'すべて選択',
      shortcut: 'Ctrl+A',
      action: () => void window.compass.shell.edit('selectAll')
    },
    { separator: true, label: '', action: () => {} },
    {
      label: 'ファイル内検索',
      shortcut: 'Ctrl+F',
      action: () => window.dispatchEvent(new CustomEvent('compass:find-in-file'))
    },
    {
      label: 'ファイル内置換',
      shortcut: 'Ctrl+H',
      action: () => window.dispatchEvent(new CustomEvent('compass:replace-in-file'))
    },
    {
      label: 'フォルダ内を検索',
      shortcut: 'Ctrl+Shift+F',
      action: () => {
        if (!workspaceRoot) return
        openSearchPanel({ replace: false })
      }
    },
    {
      label: 'フォルダ内を置換',
      shortcut: 'Ctrl+Shift+H',
      action: () => {
        if (!workspaceRoot) return
        openSearchPanel({ replace: true })
      }
    }
  ]

  const viewItems: MenuItem[] = [
    { label: '再読み込み', shortcut: 'Ctrl+R', action: () => void window.compass.shell.view('reload') },
    {
      label: '開発者ツール',
      shortcut: 'F12',
      action: () => void window.compass.shell.view('toggleDevTools')
    },
    { separator: true, label: '', action: () => {} },
    {
      label: 'ズームリセット',
      shortcut: 'Ctrl+0',
      action: () => void window.compass.shell.view('resetZoom')
    },
    { label: '拡大', shortcut: 'Ctrl+=', action: () => void window.compass.shell.view('zoomIn') },
    { label: '縮小', shortcut: 'Ctrl+-', action: () => void window.compass.shell.view('zoomOut') },
    { separator: true, label: '', action: () => {} },
    { label: 'ターミナル', shortcut: 'Ctrl+`', action: workspaceRoot ? onToggleTerminal : () => {} }
  ]

  const helpItems: MenuItem[] = [
    { label: 'バージョン情報', action: () => void window.compass.shell.showAbout() }
  ]

  const explorerActive = showFileTree && leftSidebarView === 'explorer'
  const searchActive = showFileTree && leftSidebarView === 'search'

  return (
    <div className="menu-bar" ref={barRef}>
      <div className="menu-bar-menus">
        <MenuDropdown
          id="file"
          label="ファイル"
          items={fileItems}
          openMenu={openMenu}
          onOpen={setOpenMenu}
          onClose={closeMenu}
        />
        <MenuDropdown
          id="edit"
          label="編集"
          items={editItems}
          openMenu={openMenu}
          onOpen={setOpenMenu}
          onClose={closeMenu}
        />
        <MenuDropdown
          id="view"
          label="表示"
          items={viewItems}
          openMenu={openMenu}
          onOpen={setOpenMenu}
          onClose={closeMenu}
        />
        <MenuDropdown
          id="help"
          label="ヘルプ"
          items={helpItems}
          openMenu={openMenu}
          onOpen={setOpenMenu}
          onClose={closeMenu}
        />
      </div>

      <div className="menu-bar-controls">
        <button
          type="button"
          className="menu-bar-btn"
          onClick={onOpenSettings}
          title="設定"
          aria-label="設定"
        >
          <SettingsIcon />
        </button>
        <button
          type="button"
          className={`menu-bar-btn${explorerActive ? ' active' : ''}`}
          onClick={onToggleFileTree}
          title="エクスプローラの開閉"
          aria-label="エクスプローラの開閉"
        >
          <ExplorerIcon />
        </button>
        <button
          type="button"
          className={`menu-bar-btn${searchActive ? ' active' : ''}`}
          onClick={onOpenSearch}
          disabled={!workspaceRoot}
          title={workspaceRoot ? '検索 (Ctrl+Shift+F)' : 'フォルダを開くと検索が利用できます'}
          aria-label="検索"
        >
          <SearchIcon />
        </button>
        <button
          type="button"
          className={`menu-bar-btn${showTerminal ? ' active' : ''}`}
          onClick={onToggleTerminal}
          disabled={!workspaceRoot}
          title={workspaceRoot ? 'ターミナルの開閉' : 'フォルダを開くとターミナルが利用できます'}
          aria-label="ターミナルの開閉"
        >
          <TerminalIcon />
        </button>
        <button
          type="button"
          className={`menu-bar-btn${showChat ? ' active' : ''}`}
          onClick={onToggleChat}
          title="チャットの開閉"
          aria-label="チャットの開閉"
        >
          <ChatIcon />
        </button>
      </div>
    </div>
  )
}
