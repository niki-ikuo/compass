import { useAppStore } from '@/stores/app-store'
import { buildWorkspaceIndex } from '@/utils/project-index'
import { useI18n, t as tSync } from '@/i18n'

export function PreviewBar() {
  const { t } = useI18n()
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
  if (fileCount > 0) parts.push(t('preview.files', { count: fileCount }))
  if (dirCount > 0) parts.push(t('preview.mkdir', { count: dirCount }))
  if (deleteCount > 0) parts.push(t('preview.delete', { count: deleteCount }))

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
        state.updateLastAssistantMessage(
          `${last.content}\n\n${tSync('chat.applied', { count: itemCount })}`
        )
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : tSync('chat.applyFailed')
      const state = useAppStore.getState()
      const session = state.getActiveChatSession()
      const last = session?.messages[session.messages.length - 1]
      if (last?.role === 'assistant') {
        state.updateLastAssistantMessage(
          `${last.content}\n\n${tSync('chat.fileOpError', { message })}`
        )
      }
    }
  }

  return (
    <div className="preview-bar">
      <div className="preview-bar-info">
        <span className="preview-bar-badge">{t('editor.previewTab')}</span>
        <span>{t('preview.barHint', { summary: parts.join(' · ') })}</span>
      </div>
      <div className="preview-bar-actions">
        <button className="btn-apply" onClick={() => void handleApply()}>
          {t('preview.applyAll')}
        </button>
        <button className="btn-reject" onClick={() => revertWorkspacePreview()}>
          {t('editor.reject')}
        </button>
      </div>
    </div>
  )
}
