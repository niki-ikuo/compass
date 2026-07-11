import { useAppStore } from '@/stores/app-store'
import { buildWorkspaceIndex } from '@/utils/project-index'

export function PreviewBar() {
  const pendingWorkspacePreview = useAppStore((s) => s.pendingWorkspacePreview)
  const activeChatId = useAppStore((s) => s.activeChatId)
  const workspaceRoot = useAppStore((s) => s.workspaceRoot)
  const setFileTree = useAppStore((s) => s.setFileTree)
  const applyWorkspacePreview = useAppStore((s) => s.applyWorkspacePreview)
  const revertWorkspacePreview = useAppStore((s) => s.revertWorkspacePreview)
  const isActiveChatPreview =
    pendingWorkspacePreview && pendingWorkspacePreview.chatId === activeChatId

  if (!isActiveChatPreview || !pendingWorkspacePreview) return null

  const fileCount = pendingWorkspacePreview.items.filter((i) => i.type === 'writeFile').length
  const dirCount = pendingWorkspacePreview.items.filter((i) => i.type === 'mkdir').length
  const deleteCount = pendingWorkspacePreview.items.filter(
    (i) => i.type === 'deleteFile' || i.type === 'deleteDir'
  ).length
  const parts: string[] = []
  if (fileCount > 0) parts.push(`ファイル ${fileCount}件`)
  if (dirCount > 0) parts.push(`フォルダ作成 ${dirCount}件`)
  if (deleteCount > 0) parts.push(`削除 ${deleteCount}件`)

  const handleApply = async () => {
    if (!workspaceRoot) return
    try {
      const itemCount = pendingWorkspacePreview.items.length
      await applyWorkspacePreview()
      const tree = await window.compass.fs.readDir(workspaceRoot)
      setFileTree(tree)
      void buildWorkspaceIndex(workspaceRoot)
      const state = useAppStore.getState()
      const session = state.getActiveChatSession()
      const last = session?.messages[session.messages.length - 1]
      if (last?.role === 'assistant') {
        state.updateLastAssistantMessage(`${last.content}\n\n✅ ${itemCount} 件の変更を適用しました。`)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '適用に失敗しました'
      const state = useAppStore.getState()
      const session = state.getActiveChatSession()
      const last = session?.messages[session.messages.length - 1]
      if (last?.role === 'assistant') {
        state.updateLastAssistantMessage(`${last.content}\n\n⚠️ ファイル操作エラー: ${message}`)
      }
    }
  }

  return (
    <div className="preview-bar">
      <div className="preview-bar-info">
        <span className="preview-bar-badge">プレビュー</span>
        <span>AIの変更提案 ({parts.join(' · ')}) — エディタで差分を確認し、採用/拒否してください</span>
      </div>
      <div className="preview-bar-actions">
        <button className="btn-apply" onClick={() => void handleApply()}>
          すべて適用
        </button>
        <button className="btn-reject" onClick={() => revertWorkspacePreview()}>
          拒否
        </button>
      </div>
    </div>
  )
}
