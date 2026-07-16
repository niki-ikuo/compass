import { useAppStore } from '@/stores/app-store'
import { buildWorkspaceIndex } from '@/utils/project-index'
import { getApplyErrorTone } from '@/utils/apply-error'
import { useI18n, t as tSync } from '@/i18n'

export function PreviewBar() {
  const { t } = useI18n()
  const pendingWorkspacePreview = useAppStore((s) => s.pendingWorkspacePreview)
  const pendingAgentApprovalId = useAppStore((s) => s.pendingAgentApprovalId)
  const lastApplyError = useAppStore((s) => s.lastApplyError)
  const activeChatId = useAppStore((s) => s.activeChatId)
  const workspaceRoot = useAppStore((s) => s.workspaceRoot)
  const setFileTree = useAppStore((s) => s.setFileTree)
  const applyWorkspacePreview = useAppStore((s) => s.applyWorkspacePreview)
  const revertWorkspacePreview = useAppStore((s) => s.revertWorkspacePreview)
  const sendApplyFailureToAgent = useAppStore((s) => s.sendApplyFailureToAgent)
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

  const showAskAgent = Boolean(lastApplyError && pendingAgentApprovalId)
  const applyErrorTone = getApplyErrorTone(lastApplyError)
  const isWarning = applyErrorTone === 'warning'

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
        const hint = state.pendingAgentApprovalId
          ? isWarning
            ? tSync('chat.patchMismatchAskAgentHint')
            : tSync('chat.applyFailedAskAgentHint')
          : isWarning
            ? tSync('chat.patchMismatchRetryHint')
            : tSync('chat.applyRetryHint')
        state.updateLastAssistantMessage(
          `${last.content}\n\n${
            isWarning ? tSync('chat.patchMismatchError', { message }) : tSync('chat.fileOpError', { message })
          }\n${hint}`
        )
      }
    }
  }

  return (
    <div
      className={`preview-bar${
        lastApplyError ? ` preview-bar-${applyErrorTone}` : ''
      }`}
    >
      <div className="preview-bar-info">
        <span className="preview-bar-badge">{t('editor.previewTab')}</span>
        {lastApplyError ? (
          <span>
            {isWarning
              ? t('chat.patchMismatchError', { message: lastApplyError })
              : t('chat.fileOpError', { message: lastApplyError })}{' '}
            {showAskAgent
              ? isWarning
                ? t('chat.patchMismatchAskAgentHint')
                : t('chat.applyFailedAskAgentHint')
              : isWarning
                ? t('chat.patchMismatchRetryHint')
                : t('chat.applyRetryHint')}
          </span>
        ) : (
          <span>{t('preview.barHint', { summary: parts.join(' · ') })}</span>
        )}
      </div>
      <div className="preview-bar-actions">
        <button className="btn-apply" onClick={() => void handleApply()}>
          {lastApplyError ? t('chat.retryApply') : t('preview.applyAll')}
        </button>
        {showAskAgent ? (
          <button
            className="btn-secondary"
            type="button"
            onClick={() => sendApplyFailureToAgent()}
          >
            {t('chat.askAgentToFix')}
          </button>
        ) : null}
        <button className="btn-reject" onClick={() => revertWorkspacePreview()}>
          {t('editor.reject')}
        </button>
      </div>
    </div>
  )
}
