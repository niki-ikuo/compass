import { FileTree } from './FileTree'
import { SearchPanel } from './SearchPanel'
import { WorkspaceOutline } from './WorkspaceOutline'
import { GitPanel } from './GitPanel'
import { useAppStore } from '@/stores/app-store'
import { useI18n } from '@/i18n'
import { ExplorerIcon, GitIcon, OutlineIcon, SearchIcon } from './icons/ToolbarIcons'

export function LeftSidebar() {
  const { t } = useI18n()
  const leftSidebarView = useAppStore((s) => s.leftSidebarView)
  const setLeftSidebarView = useAppStore((s) => s.setLeftSidebarView)
  const workspaceRoot = useAppStore((s) => s.workspaceRoot)
  const openSearchPanel = useAppStore((s) => s.openSearchPanel)
  const openOutlinePanel = useAppStore((s) => s.openOutlinePanel)
  const openGitPanel = useAppStore((s) => s.openGitPanel)

  const explorerActive = leftSidebarView === 'explorer'
  const searchActive = leftSidebarView === 'search'
  const outlineActive = leftSidebarView === 'outline'
  const gitActive = leftSidebarView === 'git'

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
          className={`left-sidebar-view-btn${outlineActive ? ' active' : ''}`}
          aria-selected={outlineActive}
          disabled={!workspaceRoot}
          title={workspaceRoot ? t('sidebar.outline') : t('outline.noWorkspace')}
          aria-label={t('sidebar.outline')}
          onClick={() => openOutlinePanel()}
        >
          <OutlineIcon />
          <span>{t('sidebar.outline')}</span>
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
        <button
          type="button"
          role="tab"
          className={`left-sidebar-view-btn${gitActive ? ' active' : ''}`}
          aria-selected={gitActive}
          disabled={!workspaceRoot}
          title={workspaceRoot ? t('sidebar.git') : t('git.noWorkspace')}
          aria-label={t('sidebar.git')}
          onClick={() => openGitPanel()}
        >
          <GitIcon />
          <span>{t('sidebar.git')}</span>
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
        <div className="left-sidebar-panel" hidden={!outlineActive} aria-hidden={!outlineActive}>
          <WorkspaceOutline />
        </div>
        <div className="left-sidebar-panel" hidden={!searchActive} aria-hidden={!searchActive}>
          <SearchPanel />
        </div>
        <div className="left-sidebar-panel" hidden={!gitActive} aria-hidden={!gitActive}>
          <GitPanel />
        </div>
      </div>
    </div>
  )
}
