import { FileTree } from './FileTree'
import { SearchPanel } from './SearchPanel'
import { useAppStore } from '@/stores/app-store'
import { useI18n } from '@/i18n'
import { ExplorerIcon, SearchIcon } from './icons/ToolbarIcons'

export function LeftSidebar() {
  const { t } = useI18n()
  const leftSidebarView = useAppStore((s) => s.leftSidebarView)
  const setLeftSidebarView = useAppStore((s) => s.setLeftSidebarView)
  const workspaceRoot = useAppStore((s) => s.workspaceRoot)
  const openSearchPanel = useAppStore((s) => s.openSearchPanel)

  const explorerActive = leftSidebarView === 'explorer'
  const searchActive = leftSidebarView === 'search'

  return (
    <div className="left-sidebar">
      <div className="left-sidebar-views" role="tablist" aria-label={t('sidebar.views')}>
        <button
          type="button"
          role="tab"
          className={`left-sidebar-view-btn${explorerActive ? ' active' : ''}`}
          aria-selected={explorerActive}
          title={t('sidebar.explorer')}
          aria-label={t('sidebar.explorer')}
          onClick={() => setLeftSidebarView('explorer')}
        >
          <ExplorerIcon />
          <span>{t('sidebar.explorer')}</span>
        </button>
        <button
          type="button"
          role="tab"
          className={`left-sidebar-view-btn${searchActive ? ' active' : ''}`}
          aria-selected={searchActive}
          disabled={!workspaceRoot}
          title={workspaceRoot ? t('sidebar.search') : t('menu.searchDisabled')}
          aria-label={t('sidebar.search')}
          onClick={() => openSearchPanel()}
        >
          <SearchIcon />
          <span>{t('sidebar.search')}</span>
        </button>
      </div>
      <div className="left-sidebar-body">
        <div
          className="left-sidebar-panel"
          hidden={!explorerActive}
          aria-hidden={!explorerActive}
        >
          <FileTree />
        </div>
        <div className="left-sidebar-panel" hidden={!searchActive} aria-hidden={!searchActive}>
          <SearchPanel />
        </div>
      </div>
    </div>
  )
}
