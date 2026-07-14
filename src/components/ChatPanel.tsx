import { useState, useRef, useEffect, useLayoutEffect } from 'react'
import { createPortal } from 'react-dom'
import { useAppStore } from '@/stores/app-store'
import { DiffPreview } from './DiffPreview'
import { ChatMessageContent } from './ChatMessageContent'
import { WorkspaceActionPreview } from './WorkspaceActionPreview'
import {
  ChatInputComposer,
  type ChatInputComposerHandle
} from './ChatInputComposer'
import type {
  ActionPreviewItem,
  AgentNeedContinueEvent,
  AgentToolStep,
  ChatMode,
  ChatSelectionRef
} from '@/types'
import { AgentStepTimeline } from './AgentStepTimeline'
import { AnimatedStatus } from './AnimatedEllipsis'
import {
  buildDisplayContentForActions,
  inferWorkspaceActionsFromCodeBlocks,
  normalizeWorkspaceActions,
  parseWorkspaceActionsFromContent,
  stripAllCompassActionsContent
} from '@/utils/workspace-actions'
import {
  hasChatContextDrag,
  parseChatContextRefs
} from '@/utils/chat-context-drag'
import { formatContextMention } from '@/utils/chat-mentions'
import {
  buildSelectionMention,
  hasChatSelectionDrag,
  normalizeSelectionLines,
  parseChatSelectionDrag,
  resolveSelectionFromClipboard,
  toChatSelectionRef
} from '@/utils/chat-selection-drag'
import { buildWorkspaceIndex, ensureWorkspaceIndex } from '@/utils/project-index'
import { getLlmProvider, getModelOptions, getProviderLabel } from '@/utils/llm-providers'
import { useI18n, getDateLocale } from '@/i18n'

function selectionRefKey(ref: ChatSelectionRef): string {
  return `${ref.path.replace(/\\/g, '/')}:${ref.startLine}-${ref.endLine}`
}

function parseWorkspaceActions(raw: string) {
  return parseWorkspaceActionsFromContent(raw)
}

const CHAT_MODE_OPTIONS: { id: ChatMode; label: string; titleKey: 'chat.askModeTitle' | 'chat.editModeTitle' | 'chat.agentModeTitle' }[] =
  [
    { id: 'ask', label: 'Ask', titleKey: 'chat.askModeTitle' },
    { id: 'edit', label: 'Edit', titleKey: 'chat.editModeTitle' },
    { id: 'agent', label: 'Agent', titleKey: 'chat.agentModeTitle' }
  ]

export function ChatPanel() {
  const { t } = useI18n()
  const [input, setInput] = useState('')
  const [sendMode, setSendMode] = useState<ChatMode>('edit')
  const [modeMenuOpen, setModeMenuOpen] = useState(false)
  const [agentStreamStatus, setAgentStreamStatus] = useState<string | null>(null)
  const [pendingContinue, setPendingContinue] = useState<AgentNeedContinueEvent | null>(null)
  const [pendingCode, setPendingCode] = useState<{ code: string; language: string } | null>(null)
  const [isDragOver, setIsDragOver] = useState(false)
  const [pinnedSelections, setPinnedSelections] = useState<ChatSelectionRef[]>([])
  const [historyOpen, setHistoryOpen] = useState(false)
  const [historyMenuPos, setHistoryMenuPos] = useState<{ top: number; right: number } | null>(
    null
  )
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputComposerRef = useRef<ChatInputComposerHandle>(null)
  const historyRef = useRef<HTMLDivElement>(null)
  const historyButtonRef = useRef<HTMLButtonElement>(null)
  const historyDropdownRef = useRef<HTMLDivElement>(null)
  const modePickerRef = useRef<HTMLDivElement>(null)
  const stopRequestedRef = useRef(false)
  const lastSentModeRef = useRef<ChatMode>('edit')

  const chatSessions = useAppStore((s) => s.chatSessions)
  const activeChatId = useAppStore((s) => s.activeChatId)
  const activeChat = useAppStore((s) => s.getActiveChatSession())
  const isChatLoading = useAppStore((s) => s.isChatLoading)
  const pendingWorkspacePreview = useAppStore((s) => s.pendingWorkspacePreview)
  const lastApplyError = useAppStore((s) => s.lastApplyError)
  const addChatMessage = useAppStore((s) => s.addChatMessage)
  const updateLastAssistantMessage = useAppStore((s) => s.updateLastAssistantMessage)
  const setChatLoading = useAppStore((s) => s.setChatLoading)
  const getActiveFile = useAppStore((s) => s.getActiveFile)
  const editorSelection = useAppStore((s) => s.editorSelection)
  const updateFileContent = useAppStore((s) => s.updateFileContent)
  const activeFilePath = useAppStore((s) => s.activeFilePath)
  const workspaceRoot = useAppStore((s) => s.workspaceRoot)
  const setPendingWorkspacePreview = useAppStore((s) => s.setPendingWorkspacePreview)
  const setPendingAgentApprovalId = useAppStore((s) => s.setPendingAgentApprovalId)
  const openPreviewFile = useAppStore((s) => s.openPreviewFile)
  const applyWorkspacePreview = useAppStore((s) => s.applyWorkspacePreview)
  const revertWorkspacePreview = useAppStore((s) => s.revertWorkspacePreview)
  const setFileTree = useAppStore((s) => s.setFileTree)
  const addChatContextRefs = useAppStore((s) => s.addChatContextRefs)
  const createChatSession = useAppStore((s) => s.createChatSession)
  const setActiveChatSession = useAppStore((s) => s.setActiveChatSession)
  const closeChatSession = useAppStore((s) => s.closeChatSession)
  const reopenChatSession = useAppStore((s) => s.reopenChatSession)
  const deleteChatSession = useAppStore((s) => s.deleteChatSession)
  const chatComposerInsertRequest = useAppStore((s) => s.chatComposerInsertRequest)
  const clearChatComposerInsertRequest = useAppStore((s) => s.clearChatComposerInsertRequest)
  const settings = useAppStore((s) => s.settings)
  const setSettings = useAppStore((s) => s.setSettings)
  const setApiConnected = useAppStore((s) => s.setApiConnected)

  const openChatSessions = chatSessions.filter((session) => session.isOpen)
  const historySessions = [...chatSessions]
    .filter((session) => session.messages.length > 0)
    .sort((a, b) => b.updatedAt - a.updatedAt)

  const chatMessages = activeChat?.messages ?? []
  const chatContextRefs = activeChat?.contextRefs ?? []
  const isEditSendMode = sendMode === 'edit'
  const isAskSendMode = sendMode === 'ask'
  const isActiveChatPreview = pendingWorkspacePreview?.chatId === activeChatId
  const activeModeOption =
    CHAT_MODE_OPTIONS.find((option) => option.id === sendMode) ?? CHAT_MODE_OPTIONS[0]

  useEffect(() => {
    setPendingCode(null)
    setPinnedSelections([])
    const session = useAppStore.getState().getActiveChatSession()
    const lastUser = [...(session?.messages ?? [])]
      .reverse()
      .find((message) => message.role === 'user')
    if (lastUser?.mode === 'ask' || lastUser?.mode === 'edit' || lastUser?.mode === 'agent') {
      setSendMode(lastUser.mode)
    } else {
      // 新規チャットなど履歴がない場合は、直前の送信モードを引き継ぐ
      setSendMode(lastSentModeRef.current)
    }
  }, [activeChatId])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [chatMessages, pendingWorkspacePreview, activeChatId])

  useLayoutEffect(() => {
    if (!historyOpen) {
      setHistoryMenuPos(null)
      return
    }

    const updatePosition = () => {
      const rect = historyButtonRef.current?.getBoundingClientRect()
      if (!rect) return
      setHistoryMenuPos({
        top: rect.bottom + 4,
        right: Math.max(8, window.innerWidth - rect.right)
      })
    }

    updatePosition()
    window.addEventListener('resize', updatePosition)
    return () => window.removeEventListener('resize', updatePosition)
  }, [historyOpen])

  useEffect(() => {
    if (!historyOpen) return

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node
      if (historyRef.current?.contains(target)) return
      if (historyDropdownRef.current?.contains(target)) return
      setHistoryOpen(false)
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setHistoryOpen(false)
    }

    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [historyOpen])

  useEffect(() => {
    if (!modeMenuOpen) return

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node
      if (modePickerRef.current?.contains(target)) return
      setModeMenuOpen(false)
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setModeMenuOpen(false)
    }

    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [modeMenuOpen])

  useEffect(() => {
    if (isChatLoading) setModeMenuOpen(false)
  }, [isChatLoading])

  const formatHistoryTime = (timestamp: number) => {
    try {
      return new Intl.DateTimeFormat(getDateLocale(), {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      }).format(new Date(timestamp))
    } catch {
      return ''
    }
  }

  const handleSend = async () => {
    const text = input.trim()
    if (!text || isChatLoading) return

    const messageMode = sendMode
    const isEditMessage = messageMode === 'edit'
    const isAgentMessage = messageMode === 'agent'
    const selectionsForRequest = buildSelectionsForRequest()

    lastSentModeRef.current = messageMode
    setInput('')
    setPinnedSelections([])
    if (isEditMessage) {
      setPendingWorkspacePreview(null)
    } else {
      setPendingCode(null)
      if (pendingWorkspacePreview?.chatId === activeChatId) {
        revertWorkspacePreview()
      }
    }
    addChatMessage('user', text, messageMode)
    addChatMessage('assistant', '')
    stopRequestedRef.current = false
    setAgentStreamStatus(null)
    setPendingContinue(null)
    setChatLoading(true)

    const activeFile = getActiveFile()

    if (workspaceRoot) {
      await ensureWorkspaceIndex(workspaceRoot)
    }

    if (stopRequestedRef.current) {
      setChatLoading(false)
      updateLastAssistantMessage(t('chat.aborted'))
      return
    }

    let accumulated = ''
    let agentSteps: AgentToolStep[] = []
    let unsubChunk: (() => void) | undefined
    let unsubDone: (() => void) | undefined
    let unsubAborted: (() => void) | undefined
    let unsubError: (() => void) | undefined
    let unsubToolStart: (() => void) | undefined
    let unsubToolResult: (() => void) | undefined
    let unsubNeedApproval: (() => void) | undefined
    let unsubNeedContinue: (() => void) | undefined
    let unsubStep: (() => void) | undefined
    let settled = false

    const cleanup = () => {
      unsubChunk?.()
      unsubDone?.()
      unsubAborted?.()
      unsubError?.()
      unsubToolStart?.()
      unsubToolResult?.()
      unsubNeedApproval?.()
      unsubNeedContinue?.()
      unsubStep?.()
    }

    const finish = () => {
      if (settled) return
      settled = true
      cleanup()
      setAgentStreamStatus(null)
      setPendingContinue(null)
      setChatLoading(false)
    }

    const syncAssistant = (content: string, steps = agentSteps) => {
      updateLastAssistantMessage(content, steps.length > 0 ? { agentSteps: steps } : undefined)
    }

    unsubChunk = window.compass.ai.onChunk((chunk) => {
      accumulated += chunk
      if (isEditMessage) {
        const display = stripAllCompassActionsContent(accumulated)
        syncAssistant(display || t('chat.preparingChanges'))
      } else {
        syncAssistant(accumulated)
      }
    })

    if (isAgentMessage) {
      unsubToolStart = window.compass.ai.onToolStart((event) => {
        agentSteps = [
          ...agentSteps.filter((s) => s.id !== event.id),
          {
            id: event.id,
            name: event.name,
            args: event.args,
            status: 'running'
          }
        ]
        syncAssistant(accumulated || t('chat.generating'))
      })

      unsubToolResult = window.compass.ai.onToolResult((event) => {
        agentSteps = agentSteps.map((step) =>
          step.id === event.id
            ? {
                ...step,
                status: event.ok ? 'done' : 'error',
                ok: event.ok,
                summary: event.summary,
                observation: event.observation
              }
            : step
        )
        syncAssistant(accumulated || t('chat.generating'))
      })

      unsubNeedApproval = window.compass.ai.onNeedApproval((event) => {
        setPendingContinue(null)
        setPendingAgentApprovalId(event.id)
        setPendingWorkspacePreview({ actions: event.actions, items: event.items })
        setAgentStreamStatus(t('chat.agentWaitingApproval'))
        agentSteps = agentSteps.map((step) =>
          step.id === event.id
            ? {
                ...step,
                status: 'waiting_approval',
                summary: t('chat.agentWaitingApproval')
              }
            : step
        )
        syncAssistant(accumulated.trim() || t('chat.reviewProposal'))
      })

      unsubNeedContinue = window.compass.ai.onNeedContinue((event) => {
        setPendingContinue(event)
        const status =
          event.reason === 'tools'
            ? t('chat.agentNeedContinueTools', {
                turns: String(event.turnsUsed),
                tools: String(event.toolsUsed)
              })
            : t('chat.agentNeedContinueTurns', {
                turns: String(event.turnsUsed),
                tools: String(event.toolsUsed)
              })
        setAgentStreamStatus(status)
        syncAssistant(accumulated.trim() || status)
      })

      unsubStep = window.compass.ai.onStep((event) => {
        setAgentStreamStatus(event.label)
        syncAssistant(accumulated)
      })
    }

    unsubDone = window.compass.ai.onDone(async () => {
      finish()

      if (isEditMessage && workspaceRoot) {
        let actions = parseWorkspaceActions(accumulated)
        let usedInferredCodeBlock = false

        if (actions.length === 0) {
          actions = inferWorkspaceActionsFromCodeBlocks(
            accumulated,
            workspaceRoot,
            activeFilePath
          )
          usedInferredCodeBlock = actions.length > 0
        }

        const displayContent = buildDisplayContentForActions(accumulated, usedInferredCodeBlock)

        if (actions.length > 0) {
          try {
            updateLastAssistantMessage(displayContent || t('chat.reviewProposal'))

            const normalizedActions = normalizeWorkspaceActions(workspaceRoot, actions)
            const items = await window.compass.fs.previewActions(workspaceRoot, normalizedActions)
            setPendingWorkspacePreview({ actions: normalizedActions, items })
          } catch (error) {
            const message = error instanceof Error ? error.message : t('chat.previewFailed')
            updateLastAssistantMessage(
              displayContent ? `${displayContent}\n\n⚠️ ${message}` : `⚠️ ${message}`
            )
          }
        } else if (displayContent !== accumulated.trim()) {
          updateLastAssistantMessage(displayContent)
        }
      } else if (isAgentMessage) {
        syncAssistant(accumulated.trim())
      }
    })

    unsubAborted = window.compass.ai.onAborted(() => {
      finish()
      if (isEditMessage) {
        const display = stripAllCompassActionsContent(accumulated).trim()
        updateLastAssistantMessage(display || t('chat.aborted'))
      } else if (isAgentMessage) {
        const approvalId = useAppStore.getState().pendingAgentApprovalId
        if (approvalId) {
          setPendingAgentApprovalId(null)
          revertWorkspacePreview()
        }
        setPendingContinue(null)
        agentSteps = agentSteps.map((step) =>
          step.status === 'running' ||
          step.status === 'waiting_approval' ||
          step.status === 'waiting_continue'
            ? { ...step, status: 'error', ok: false, summary: step.summary || t('chat.aborted') }
            : step
        )
        syncAssistant(accumulated.trim() || t('chat.aborted'))
      } else {
        updateLastAssistantMessage(accumulated.trim() || t('chat.aborted'))
      }
    })

    unsubError = window.compass.ai.onError((error) => {
      finish()
      if (isAgentMessage) {
        agentSteps = agentSteps.map((step) =>
          step.status === 'running' ||
          step.status === 'waiting_approval' ||
          step.status === 'waiting_continue'
            ? { ...step, status: 'error', ok: false, summary: error }
            : step
        )
        syncAssistant(t('chat.errorPrefix', { error }))
      } else {
        updateLastAssistantMessage(t('chat.errorPrefix', { error }))
      }
    })

    const history = [
      ...chatMessages.map((m) => ({
        role: m.role,
        content: m.content,
        ...(isAgentMessage && m.agentSteps && m.agentSteps.length > 0
          ? { agentSteps: m.agentSteps }
          : {})
      })),
      { role: 'user' as const, content: text }
    ]

    await window.compass.ai.chat({
      messages: history,
      workspaceRoot: workspaceRoot ?? undefined,
      mode: messageMode,
      context: {
        filePath: activeFile?.path,
        fileContent: activeFile?.content,
        selections: selectionsForRequest.length > 0 ? selectionsForRequest : undefined,
        references: chatContextRefs.length > 0 ? chatContextRefs : undefined
      }
    })
  }

  const handleStop = () => {
    if (!isChatLoading) return
    stopRequestedRef.current = true
    void window.compass.ai.cancel()
  }

  const insertMentionAtCursor = (mention: string) => {
    inputComposerRef.current?.insertMention(mention)
  }

  const insertContextMentionIntoInput = (ref: {
    path: string
    isDirectory: boolean
  }) => {
    insertMentionAtCursor(formatContextMention(ref.path, ref.isDirectory, workspaceRoot))
  }

  const getLiveSelectionRef = (): ChatSelectionRef | null => {
    if (!editorSelection || !activeFilePath) return null
    const { startLine, endLine } = normalizeSelectionLines(editorSelection)
    return {
      path: activeFilePath,
      startLine,
      endLine,
      text: editorSelection.text
    }
  }

  const buildSelectionsForRequest = (): ChatSelectionRef[] => {
    const result = [...pinnedSelections]
    const live = getLiveSelectionRef()
    if (live && !result.some((r) => selectionRefKey(r) === selectionRefKey(live))) {
      result.push(live)
    }
    return result
  }

  const pinSelectionAndInsert = (ref: ChatSelectionRef, mention?: string) => {
    setPinnedSelections((prev) => {
      if (prev.some((r) => selectionRefKey(r) === selectionRefKey(ref))) return prev
      return [...prev, ref]
    })
    insertMentionAtCursor(
      mention ?? buildSelectionMention(ref.path, ref.startLine, ref.endLine, workspaceRoot)
    )
  }

  useEffect(() => {
    if (!chatComposerInsertRequest) return
    const { mentions, selection } = chatComposerInsertRequest
    if (selection) {
      pinSelectionAndInsert(selection, mentions[0])
    } else {
      for (const mention of mentions) {
        insertMentionAtCursor(mention)
      }
    }
    clearChatComposerInsertRequest()
    // pinSelectionAndInsert / insertMentionAtCursor は毎レンダー新しい参照なので request id のみ監視
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatComposerInsertRequest?.id])

  const isChatDrop = (dataTransfer: DataTransfer) =>
    hasChatContextDrag(dataTransfer) || hasChatSelectionDrag(dataTransfer)

  const handleDragOver = (e: React.DragEvent) => {
    if (!isChatDrop(e.dataTransfer)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
    setIsDragOver(true)
  }

  const handleDragLeave = (e: React.DragEvent) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setIsDragOver(false)
    }
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)

    const fileRefs = parseChatContextRefs(e.dataTransfer)
    if (fileRefs.length > 0) {
      addChatContextRefs(fileRefs)
      for (const fileRef of fileRefs) {
        insertContextMentionIntoInput(fileRef)
      }
      return
    }

    const selectionPayload = parseChatSelectionDrag(e.dataTransfer)
    if (selectionPayload) {
      const selectionRef = toChatSelectionRef(selectionPayload)
      if (selectionPayload.text) {
        pinSelectionAndInsert(selectionRef, selectionPayload.mention)
      } else {
        insertMentionAtCursor(selectionPayload.mention)
      }
    }
  }

  const handlePasteSelection = (dataTransfer: DataTransfer): boolean => {
    const live = getLiveSelectionRef()
    const livePayload = live
      ? {
          path: live.path,
          startLine: live.startLine,
          endLine: live.endLine,
          text: live.text,
          mention: buildSelectionMention(live.path, live.startLine, live.endLine, workspaceRoot)
        }
      : null

    const payload = resolveSelectionFromClipboard(dataTransfer, {
      liveSelectionText: editorSelection?.text ?? null,
      livePayload
    })
    if (!payload) return false

    if (payload.text) {
      pinSelectionAndInsert(toChatSelectionRef(payload), payload.mention)
    } else {
      insertMentionAtCursor(payload.mention)
    }
    return true
  }

  const handleApplyCode = () => {
    if (!pendingCode || !activeFilePath) return
    updateFileContent(activeFilePath, pendingCode.code)
    setPendingCode(null)
  }

  const handleInsert = () => {
    if (!pendingCode || !activeFilePath) return
    const activeFile = getActiveFile()
    if (!activeFile) return
    const newContent = activeFile.content + '\n' + pendingCode.code
    updateFileContent(activeFilePath, newContent)
    setPendingCode(null)
  }

  const handleSelectPreviewItem = (item: ActionPreviewItem) => {
    if (item.type !== 'writeFile') return
    openPreviewFile(item.path, item.newContent, item.oldContent, item.isNew)
  }

  const appendAssistantNote = (note: string) => {
    const last = chatMessages[chatMessages.length - 1]
    if (last?.role === 'assistant') {
      updateLastAssistantMessage(`${last.content}\n\n${note}`)
    } else {
      addChatMessage('assistant', note)
    }
  }

  const handleApplyActions = async () => {
    if (!pendingWorkspacePreview || !workspaceRoot) return

    try {
      const itemCount = pendingWorkspacePreview.items.length
      await applyWorkspacePreview()
      const tree = await window.compass.fs.readDir(workspaceRoot)
      setFileTree(tree)
      void buildWorkspaceIndex(workspaceRoot)
      appendAssistantNote(t('chat.applied', { count: itemCount }))
    } catch (error) {
      const message = error instanceof Error ? error.message : t('chat.applyFailed')
      appendAssistantNote(
        `${t('chat.fileOpError', { message })}\n${t('chat.applyRetryHint')}`
      )
    }
  }

  const handleAgentContinue = () => {
    const event = pendingContinue
    if (!event) return
    setPendingContinue(null)
    setAgentStreamStatus(t('chat.generating'))
    void window.compass.ai.resolveContinue({ id: event.id, continue: true })
  }

  const handleAgentStopContinue = () => {
    const event = pendingContinue
    if (!event) return
    setPendingContinue(null)
    void window.compass.ai.resolveContinue({ id: event.id, continue: false })
  }

  const activeFile = getActiveFile()
  const provider = getLlmProvider(settings.providerId)
  const modelOptions = getModelOptions(settings.providerId, settings.model)

  const handleModelChange = async (model: string): Promise<void> => {
    const next = {
      ...settings,
      model,
      providerKeys: {
        ...settings.providerKeys,
        [settings.providerId]: settings.apiKey
      }
    }
    setSettings(next)
    try {
      await window.compass.settings.set(next)
      setApiConnected(
        getLlmProvider(next.providerId).requiresApiKey ? (next.apiKey ? true : null) : true
      )
    } catch {
      // ストアは更新済み。永続化失敗時は次回起動で戻る
    }
  }

  return (
    <div className="chat-panel">
      <div className="panel-header chat-panel-header">
        <span>{t('chat.title')}</span>
        <div className="chat-header-actions">
          <label
            className="chat-model-select"
            title={t('chat.modelOf', { provider: getProviderLabel(provider.id) })}
          >
            <span className="chat-model-select-label">{getProviderLabel(provider.id)}</span>
            <select
              value={settings.model}
              onChange={(e) => void handleModelChange(e.target.value)}
              disabled={isChatLoading}
              aria-label={t('chat.llmModel')}
            >
              {modelOptions.map((model) => (
                <option key={model} value={model}>
                  {model}
                </option>
              ))}
            </select>
          </label>
          <div className="chat-history-menu" ref={historyRef}>
            <button
              ref={historyButtonRef}
              className="btn-icon"
              onClick={() => setHistoryOpen((open) => !open)}
              title={t('chat.history')}
              aria-expanded={historyOpen}
              aria-haspopup="listbox"
            >
              ☰
            </button>
            {historyOpen &&
              historyMenuPos &&
              createPortal(
                <div
                  ref={historyDropdownRef}
                  className="chat-history-dropdown"
                  role="listbox"
                  aria-label={t('chat.history')}
                  style={{ top: historyMenuPos.top, right: historyMenuPos.right }}
                >
                  <div className="chat-history-dropdown-header">{t('chat.pastChats')}</div>
                  {historySessions.length === 0 ? (
                    <div className="chat-history-empty">{t('chat.noHistory')}</div>
                  ) : (
                    <ul className="chat-history-list">
                      {historySessions.map((session) => (
                        <li key={session.id} className="chat-history-item">
                          <button
                            type="button"
                            className={`chat-history-item-main${
                              session.id === activeChatId ? ' active' : ''
                            }`}
                            onClick={() => {
                              if (session.isOpen) {
                                setActiveChatSession(session.id)
                              } else {
                                reopenChatSession(session.id)
                              }
                              setHistoryOpen(false)
                            }}
                            title={session.title}
                          >
                            <span className="chat-history-item-title">{session.title}</span>
                            <span className="chat-history-item-meta">
                              {formatHistoryTime(session.updatedAt)}
                              {session.isOpen ? t('chat.openBadge') : ''}
                            </span>
                          </button>
                          <button
                            type="button"
                            className="chat-history-item-delete"
                            title={t('chat.deleteFromHistory')}
                            onClick={(e) => {
                              e.stopPropagation()
                              deleteChatSession(session.id)
                            }}
                          >
                            ×
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>,
                document.body
              )}
          </div>
          <button
            className="btn-icon"
            onClick={() => createChatSession()}
            title={t('chat.newChat')}
            disabled={isChatLoading}
          >
            ＋
          </button>
          <button
            className="btn-icon"
            onClick={() => useAppStore.getState().clearChat()}
            title={t('chat.clear')}
            disabled={isChatLoading}
          >
            🗑
          </button>
        </div>
      </div>

      <div className="chat-tabs">
        {openChatSessions.map((session) => (
          <div
            key={session.id}
            className={`chat-tab${session.id === activeChatId ? ' active' : ''}`}
            onClick={() => setActiveChatSession(session.id)}
            title={session.title}
          >
            <span className="chat-tab-title">{session.title}</span>
            <button
              type="button"
              className="chat-tab-close"
              onClick={(e) => {
                e.stopPropagation()
                closeChatSession(session.id)
              }}
              title={t('chat.closeTab')}
            >
              ×
            </button>
          </div>
        ))}
      </div>

      <div className="chat-messages">
        {chatMessages.length === 0 && (
          <div className="chat-empty">
            <p>{t('chat.emptyLead')}</p>
            <p className="hint">{t('chat.emptyModes')}</p>
            <p className="hint">{t('chat.emptyContext')}</p>
            <p className="hint">{t('chat.emptyPasteHint')}</p>
          </div>
        )}
        {chatMessages.map((msg, index) => {
          const isLast = index === chatMessages.length - 1
          const isStreaming = isLast && msg.role === 'assistant' && isChatLoading

          return (
            <div key={msg.id} className={`chat-message ${msg.role}`}>
              <div className="chat-role">
                <span>{msg.role === 'user' ? t('chat.you') : t('chat.ai')}</span>
                {msg.role === 'user' && msg.mode && (
                  <span className={`chat-message-mode ${msg.mode}`}>
                    {msg.mode === 'edit' ? 'Edit' : msg.mode === 'agent' ? 'Agent' : 'Ask'}
                  </span>
                )}
              </div>
              <div className="chat-content">
                {msg.role === 'assistant' && msg.agentSteps && msg.agentSteps.length > 0 && (
                  <AgentStepTimeline steps={msg.agentSteps} />
                )}
                <ChatMessageContent
                  content={msg.content}
                  isStreaming={isStreaming}
                  hideStreamingPlaceholder={Boolean(agentStreamStatus)}
                />
                {isStreaming && agentStreamStatus ? (
                  <div className="chat-agent-stream-status">
                    <AnimatedStatus label={agentStreamStatus} />
                  </div>
                ) : null}
              </div>
            </div>
          )
        })}
        <div ref={messagesEndRef} />
      </div>

      {isActiveChatPreview && pendingWorkspacePreview && (
        <WorkspaceActionPreview
          items={pendingWorkspacePreview.items}
          applyError={lastApplyError}
          onApply={() => void handleApplyActions()}
          onReject={() => revertWorkspacePreview()}
          onSelectItem={handleSelectPreviewItem}
        />
      )}

      {pendingContinue && (
        <div className="agent-continue-bar">
          <div className="agent-continue-info">
            {pendingContinue.reason === 'tools'
              ? t('chat.agentNeedContinueTools', {
                  turns: String(pendingContinue.turnsUsed),
                  tools: String(pendingContinue.toolsUsed)
                })
              : t('chat.agentNeedContinueTurns', {
                  turns: String(pendingContinue.turnsUsed),
                  tools: String(pendingContinue.toolsUsed)
                })}
          </div>
          <div className="agent-continue-actions">
            <button type="button" className="btn-apply" onClick={handleAgentContinue}>
              {t('chat.agentContinue')}
            </button>
            <button type="button" className="btn-reject" onClick={handleAgentStopContinue}>
              {t('chat.agentStopContinue')}
            </button>
          </div>
        </div>
      )}

      {isAskSendMode && pendingCode && activeFile && (
        <DiffPreview
          oldText={activeFile.content}
          newText={pendingCode.code}
          title={t('chat.applyToEditor')}
          onApply={handleApplyCode}
          onReject={() => setPendingCode(null)}
        />
      )}

      {isAskSendMode && pendingCode && activeFile && (
        <div className="apply-options">
          <button className="btn-secondary" onClick={handleInsert}>
            {t('chat.insertAtCursor')}
          </button>
        </div>
      )}

      <div
        className={`chat-input-area${isDragOver ? ' drag-over' : ''}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <div className="chat-input-box">
          <ChatInputComposer
            ref={inputComposerRef}
            value={input}
            onChange={setInput}
            onSubmit={() => void handleSend()}
            onPasteSelection={handlePasteSelection}
            placeholder={
              isEditSendMode
                ? t('chat.placeholderEdit')
                : sendMode === 'agent'
                  ? t('chat.placeholderAgent')
                  : t('chat.placeholderAsk')
            }
            disabled={isChatLoading}
          />
          <div className="chat-input-footer">
            <div className="chat-mode-picker" ref={modePickerRef}>
              <button
                type="button"
                className={`chat-mode-trigger mode-${sendMode}`}
                onClick={() => setModeMenuOpen((open) => !open)}
                disabled={isChatLoading}
                title={t(activeModeOption.titleKey)}
                aria-label={t('chat.sendMode')}
                aria-haspopup="listbox"
                aria-expanded={modeMenuOpen}
              >
                <span className="chat-mode-dot" aria-hidden="true" />
                <span className="chat-mode-trigger-label">{activeModeOption.label}</span>
                <span className="chat-mode-chevron" aria-hidden="true">
                  ▾
                </span>
              </button>
              {modeMenuOpen ? (
                <div className="chat-mode-menu" role="listbox" aria-label={t('chat.sendMode')}>
                  {CHAT_MODE_OPTIONS.map((option) => {
                    const selected = option.id === sendMode
                    return (
                      <button
                        key={option.id}
                        type="button"
                        role="option"
                        aria-selected={selected}
                        className={`chat-mode-menu-item mode-${option.id}${
                          selected ? ' selected' : ''
                        }`}
                        title={t(option.titleKey)}
                        onClick={() => {
                          setSendMode(option.id)
                          setModeMenuOpen(false)
                        }}
                      >
                        <span className="chat-mode-dot" aria-hidden="true" />
                        <span>{option.label}</span>
                        {selected ? (
                          <span className="chat-mode-menu-check" aria-hidden="true">
                            ✓
                          </span>
                        ) : null}
                      </button>
                    )
                  })}
                </div>
              ) : null}
            </div>
            {isChatLoading ? (
              <button
                type="button"
                className="btn-send btn-stop"
                onClick={handleStop}
                title={t('chat.stopTitle')}
              >
                {t('chat.stop')}
              </button>
            ) : (
              <button
                type="button"
                className="btn-send"
                onClick={handleSend}
                disabled={!input.trim()}
              >
                {t('chat.send')}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
