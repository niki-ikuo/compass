import { useAppStore } from '@/stores/app-store'

function isCurrentWorkspace(workspaceRoot: string): boolean {
  const current = useAppStore.getState().workspaceRoot
  if (!current) return false
  return current.replace(/[/\\]+$/, '').replace(/\\/g, '/').toLowerCase() ===
    workspaceRoot.replace(/[/\\]+$/, '').replace(/\\/g, '/').toLowerCase()
}

export async function buildWorkspaceIndex(workspaceRoot: string): Promise<void> {
  const { setIndexStatus, setIndexMeta } = useAppStore.getState()
  setIndexStatus('indexing')
  try {
    const result = await window.compass.index.build(workspaceRoot)
    if (!isCurrentWorkspace(workspaceRoot)) return
    setIndexMeta(result)
    setIndexStatus('ready')
  } catch {
    if (!isCurrentWorkspace(workspaceRoot)) return
    setIndexStatus('error')
  }
}

export async function ensureWorkspaceIndex(workspaceRoot: string): Promise<void> {
  const { setIndexStatus, setIndexMeta } = useAppStore.getState()
  try {
    const result = await window.compass.index.ensureFresh(workspaceRoot)
    if (!isCurrentWorkspace(workspaceRoot)) return
    setIndexMeta(result)
    setIndexStatus('ready')
  } catch {
    if (!isCurrentWorkspace(workspaceRoot)) return
    setIndexStatus('error')
  }
}
