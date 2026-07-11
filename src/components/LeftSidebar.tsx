import { FileTree } from './FileTree'
import { SearchPanel } from './SearchPanel'
import { useAppStore } from '@/stores/app-store'

export function LeftSidebar() {
  const leftSidebarView = useAppStore((s) => s.leftSidebarView)

  if (leftSidebarView === 'search') {
    return <SearchPanel />
  }

  return <FileTree />
}
