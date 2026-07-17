import { useCallback, useEffect, useRef, useState } from 'react'
import { SettingsIcon, ExplorerIcon, ChatIcon, TerminalIcon, SearchIcon } from './icons/ToolbarIcons'
import { useAppStore } from '@/stores/app-store'
import type { LeftSidebarView } from '@/types'
import { useI18n } from '@/i18n'

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
  const { t } = useI18n()
  const [openMenu, setOpenMenu] = useState<MenuId | null>(null)
  const barRef = useRef<HTMLDivElement>(null)
  const workspaceRoot = useAppStore((s) => s.workspaceRoot)
  const openSearchPanel = useAppStore((s) => s.openSearchPanel)
  const openBrowserTab = useAppStore((s) => s.openBrowserTab)

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
    { label: t('menu.openFolder'), shortcut: 'Ctrl+O', action: onOpenFolder },
    { label: t('menu.closeFolder'), shortcut: 'Ctrl+Shift+W', action: onCloseFolder },
    { label: t('menu.save'), shortcut: 'Ctrl+S', action: onSave },
    { separator: true, label: '', action: () => {} },
    { label: t('menu.settings'), shortcut: 'Ctrl+,', action: onOpenSettings },
    { separator: true, label: '', action: () => {} },
    { label: t('menu.quit'), shortcut: 'Alt+F4', action: () => void window.compass.shell.quit() }
  ]

  const editItems: MenuItem[] = [
    { label: t('menu.undo'), shortcut: 'Ctrl+Z', action: () => void window.compass.shell.edit('undo') },
    { label: t('menu.redo'), shortcut: 'Ctrl+Y', action: () => void window.compass.shell.edit('redo') },
    { separator: true, label: '', action: () => {} },
    { label: t('menu.cut'), shortcut: 'Ctrl+X', action: () => void window.compass.shell.edit('cut') },
    { label: t('menu.copy'), shortcut: 'Ctrl+C', action: () => void window.compass.shell.edit('copy') },
    { label: t('menu.paste'), shortcut: 'Ctrl+V', action: () => void window.compass.shell.edit('paste') },
    { separator: true, label: '', action: () => {} },
    {
      label: t('menu.selectAll'),
      shortcut: 'Ctrl+A',
      action: () => void window.compass.shell.edit('selectAll')
    },
    { separator: true, label: '', action: () => {} },
    {
      label: t('menu.findInFile'),
      shortcut: 'Ctrl+F',
      action: () => window.dispatchEvent(new CustomEvent('compass:find-in-file'))
    },
    {
      label: t('menu.replaceInFile'),
      shortcut: 'Ctrl+H',
      action: () => window.dispatchEvent(new CustomEvent('compass:replace-in-file'))
    },
    {
      label: t('menu.findInFiles'),
      shortcut: 'Ctrl+Shift+F',
      action: () => {
        if (!workspaceRoot) return
        openSearchPanel({ replace: false })
      }
    },
    {
      label: t('menu.replaceInFiles'),
      shortcut: 'Ctrl+Shift+H',
      action: () => {
        if (!workspaceRoot) return
        openSearchPanel({ replace: true })
      }
    }
  ]

  const viewItems: MenuItem[] = [
    { label: t('menu.reload'), shortcut: 'Ctrl+R', action: () => void window.compass.shell.view('reload') },
    {
      label: t('menu.toggleDevTools'),
      shortcut: 'F12',
      action: () => void window.compass.shell.view('toggleDevTools')
    },
    { separator: true, label: '', action: () => {} },
    {
      label: t('menu.resetZoom'),
      shortcut: 'Ctrl+0',
      action: () => void window.compass.shell.view('resetZoom')
    },
    { label: t('menu.zoomIn'), shortcut: 'Ctrl++', action: () => void window.compass.shell.view('zoomIn') },
    { label: t('menu.zoomOut'), shortcut: 'Ctrl+-', action: () => void window.compass.shell.view('zoomOut') },
    { separator: true, label: '', action: () => {} },
    { label: t('menu.newBrowserTab'), shortcut: 'Ctrl+Shift+B', action: () => openBrowserTab() },
    { label: t('menu.terminal'), shortcut: 'Ctrl+`', action: workspaceRoot ? onToggleTerminal : () => {} }
  ]

  const helpItems: MenuItem[] = [
    { label: t('menu.about'), action: () => void window.compass.shell.showAbout() }
  ]

  const explorerActive = showFileTree && leftSidebarView === 'explorer'
  const searchActive = showFileTree && leftSidebarView === 'search'

  return (
    <div className="menu-bar" ref={barRef}>
      <div className="menu-bar-menus">
        <MenuDropdown
          id="file"
          label={t('menu.file')}
          items={fileItems}
          openMenu={openMenu}
          onOpen={setOpenMenu}
          onClose={closeMenu}
        />
        <MenuDropdown
          id="edit"
          label={t('menu.edit')}
          items={editItems}
          openMenu={openMenu}
          onOpen={setOpenMenu}
          onClose={closeMenu}
        />
        <MenuDropdown
          id="view"
          label={t('menu.view')}
          items={viewItems}
          openMenu={openMenu}
          onOpen={setOpenMenu}
          onClose={closeMenu}
        />
        <MenuDropdown
          id="help"
          label={t('menu.help')}
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
          title={t('menu.settings')}
          aria-label={t('menu.settings')}
        >
          <SettingsIcon />
        </button>
        <button
          type="button"
          className={`menu-bar-btn${explorerActive ? ' active' : ''}`}
          onClick={onToggleFileTree}
          title={t('menu.toggleExplorer')}
          aria-label={t('menu.toggleExplorer')}
        >
          <ExplorerIcon />
        </button>
        <button
          type="button"
          className={`menu-bar-btn${searchActive ? ' active' : ''}`}
          onClick={onOpenSearch}
          disabled={!workspaceRoot}
          title={workspaceRoot ? t('menu.searchShortcut') : t('menu.searchDisabled')}
          aria-label={t('menu.toggleSearch')}
        >
          <SearchIcon />
        </button>
        <button
          type="button"
          className={`menu-bar-btn${showTerminal ? ' active' : ''}`}
          onClick={onToggleTerminal}
          disabled={!workspaceRoot}
          title={workspaceRoot ? t('menu.toggleTerminal') : t('menu.terminalDisabled')}
          aria-label={t('menu.toggleTerminal')}
        >
          <TerminalIcon />
        </button>
        <button
          type="button"
          className={`menu-bar-btn${showChat ? ' active' : ''}`}
          onClick={onToggleChat}
          title={t('menu.toggleChat')}
          aria-label={t('menu.toggleChat')}
        >
          <ChatIcon />
        </button>
      </div>
    </div>
  )
}
