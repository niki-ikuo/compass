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
  AgentNeedExecApprovalEvent,
  AgentToolStep,
  ChatMode,
  ChatSelectionRef,
  UseCasePreset
} from '@/types'
import { normalizeUseCasePreset } from '@/types'
import {
  DEFAULT_USE_CASE_PRESET,
  resolveEffectiveUseCasePreset,
  USE_CASE_PRESET_OPTIONS
} from '@/utils/use-case-preset'
import { AgentStepTimeline } from './AgentStepTimeline'
import { AnimatedStatus } from './AnimatedEllipsis'
import { ChatHistoryIcon, PlusIcon, TrashIcon, CloseIcon } from './icons/ToolbarIcons'
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
import { getLlmProvider, getModelOptions, getProviderLabel, isAgentModeAvailable } from '@/utils/llm-providers'
import { parseAgentToolsUnsupportedError } from '@/utils/agent-tools'
import { formatActionPreviewError } from '@/utils/apply-error'
import { resolveLastSentChatMode } from '@/utils/chat-mode'
import {
  buildPastedMediaFileName,
  classifyMediaFile,
  collectClipboardMedia,
  hasClipboardMedia
} from '@/utils/clipboard-media'
import { join } from '@/utils/path'
import { isMediaOpenFile } from '@/utils/media-context'
import { isBrowserOpenFile } from '@/utils/browser-tab'
import { isSettingsOpenFile } from '@/utils/settings-tab'
import {
  CHAT_TAB_REORDER_MIME,
  hasTabReorderDrag,
  resolveTabDropIndex
} from '@/utils/tab-reorder'
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
  const [canSend, setCanSend] = useState(false)
  const [sendMode, setSendMode] = useState<ChatMode>('edit')
  const [sendPreset, setSendPreset] = useState<UseCasePreset>(DEFAULT_USE_CASE_PRESET)
  const [modeMenuOpen, setModeMenuOpen] = useState(false)
  const [presetMenuOpen, setPresetMenuOpen] = useState(false)
  const [agentStreamStatusByChat, setAgentStreamStatusByChat] = useState<
    Record<string, string | null>
  >({})
  const [pendingContinueByChat, setPendingContinueByChat] = useState<
    Record<string, AgentNeedContinueEvent | null>
  >({})
  const [pendingExecApprovalByChat, setPendingExecApprovalByChat] = useState<
    Record<string, AgentNeedExecApprovalEvent | null>
  >({})
  const [agentEditFallback, setAgentEditFallback] = useState<{ prompt: string } | null>(null)
  const [pendingCode, setPendingCode] = useState<{ code: string; language: string } | null>(null)
  const [isDragOver, setIsDragOver] = useState(false)
  const [pinnedSelections, setPinnedSelections] = useState<ChatSelectionRef[]>([])
  const [historyOpen, setHistoryOpen] = useState(false)
  const [historyMenuPos, setHistoryMenuPos] = useState<{ top: number; right: number } | null>(
    null
  )
  const [chatTabDragId, setChatTabDragId] = useState<string | null>(null)
  const [chatTabDropIndex, setChatTabDropIndex] = useState<number | null>(null)
  const chatTabDragIdRef = useRef<string | null>(null)
  const messagesContainerRef = useRef<HTMLDivElement>(null)
  const chatTabsRef = useRef<HTMLDivElement>(null)
  const inputComposerRef = useRef<ChatInputComposerHandle>(null)
  const pasteMediaInFlightRef = useRef(false)
  const historyRef = useRef<HTMLDivElement>(null)
  const historyButtonRef = useRef<HTMLButtonElement>(null)
  const historyDropdownRef = useRef<HTMLDivElement>(null)
  const modePickerRef = useRef<HTMLDivElement>(null)
  const presetPickerRef = useRef<HTMLDivElement>(null)
  const stopRequestedChatIdsRef = useRef(new Set<string>())
  const lastSentModeRef = useRef<ChatMode>('edit')
  const prevActiveChatIdRef = useRef<string | null>(null)
  const prevMessageCountRef = useRef(-1)
  const hasSettledScrollRef = useRef(false)

  const chatSessions = useAppStore((s) => s.chatSessions)
  const activeChatId = useAppStore((s) => s.activeChatId)
  const activeChat = useAppStore((s) => s.getActiveChatSession())
  const loadingChatIds = useAppStore((s) => s.loadingChatIds)
  const pendingWorkspacePreview = useAppStore((s) => s.pendingWorkspacePreview)
  const lastApplyError = useAppStore((s) => s.lastApplyError)
  const pendingAgentApprovalId = useAppStore((s) => s.pendingAgentApprovalId)
  const addChatMessage = useAppStore((s) => s.addChatMessage)
  const addChatExchange = useAppStore((s) => s.addChatExchange)
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
  const sendApplyFailureToAgent = useAppStore((s) => s.sendApplyFailureToAgent)
  const setFileTree = useAppStore((s) => s.setFileTree)
  const addChatContextRefs = useAppStore((s) => s.addChatContextRefs)
  const createChatSession = useAppStore((s) => s.createChatSession)
  const setActiveChatSession = useAppStore((s) => s.setActiveChatSession)
  const reorderChatSession = useAppStore((s) => s.reorderChatSession)
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
  const isChatLoading = Boolean(activeChatId && loadingChatIds.includes(activeChatId))
  const agentStreamStatus = activeChatId ? (agentStreamStatusByChat[activeChatId] ?? null) : null
  const pendingContinue = activeChatId ? (pendingContinueByChat[activeChatId] ?? null) : null
  const pendingExecApproval = activeChatId
    ? (pendingExecApprovalByChat[activeChatId] ?? null)
    : null
  const agentModeAvailable = isAgentModeAvailable(settings.providerId)
  const modeOptions = CHAT_MODE_OPTIONS.filter(
    (option) => option.id !== 'agent' || agentModeAvailable
  )
  const isEditSendMode = sendMode === 'edit'
  const isAskSendMode = sendMode === 'ask'
  const isActiveChatPreview = pendingWorkspacePreview?.chatId === activeChatId
  const activeModeOption =
    modeOptions.find((option) => option.id === sendMode) ?? modeOptions[0]
  const activePresetOption =
    USE_CASE_PRESET_OPTIONS.find((option) => option.id === sendPreset) ??
    USE_CASE_PRESET_OPTIONS[0]

  const setAgentStreamStatusFor = (chatId: string, status: string | null) => {
    setAgentStreamStatusByChat((prev) => {
      if (prev[chatId] === status) return prev
      return { ...prev, [chatId]: status }
    })
  }
  const setPendingContinueFor = (chatId: string, event: AgentNeedContinueEvent | null) => {
    setPendingContinueByChat((prev) => {
      if (prev[chatId] === event) return prev
      return { ...prev, [chatId]: event }
    })
  }
  const setPendingExecApprovalFor = (
    chatId: string,
    event: AgentNeedExecApprovalEvent | null
  ) => {
    setPendingExecApprovalByChat((prev) => {
      if (prev[chatId] === event) return prev
      return { ...prev, [chatId]: event }
    })
  }

  useEffect(() => {
    if (sendMode === 'agent' && !agentModeAvailable) {
      setSendMode('edit')
      lastSentModeRef.current = 'edit'
    }
  }, [agentModeAvailable, sendMode, settings.providerId])

  useEffect(() => {
    setPendingCode(null)
    setPinnedSelections([])
    setAgentEditFallback(null)
    const store = useAppStore.getState()
    const session = store.getActiveChatSession()
    const lastUser = [...(session?.messages ?? [])]
      .reverse()
      .find((message) => message.role === 'user')
    const available = isAgentModeAvailable(store.settings.providerId)
    if (lastUser?.mode === 'agent' && !available) {
      setSendMode('edit')
    } else if (lastUser?.mode === 'ask' || lastUser?.mode === 'edit' || lastUser?.mode === 'agent') {
      setSendMode(lastUser.mode)
      lastSentModeRef.current = lastUser.mode
    } else {
      // 新規チャットなど履歴がない場合は、最終送信のモードを引き継ぐ
      const inherited =
        resolveLastSentChatMode(store.chatSessions) ?? lastSentModeRef.current
      lastSentModeRef.current = inherited
      setSendMode(inherited === 'agent' && !available ? 'edit' : inherited)
    }

    const lastPreset = normalizeUseCasePreset(lastUser?.preset)
    setSendPreset(
      lastPreset ??
        resolveEffectiveUseCasePreset({
          workspacePreset: store.workspaceDefaultUseCasePreset,
          appPreset: store.settings.defaultUseCasePreset
        })
    )
  }, [activeChatId])

  const workspaceDefaultUseCasePreset = useAppStore((s) => s.workspaceDefaultUseCasePreset)

  // ワークスペース既定やアプリ既定が変わったとき、履歴のないチャットの初期用途を合わせる
  useEffect(() => {
    const store = useAppStore.getState()
    const session = store.getActiveChatSession()
    const hasUser = (session?.messages ?? []).some((message) => message.role === 'user')
    if (hasUser) return
    setSendPreset(
      resolveEffectiveUseCasePreset({
        workspacePreset: workspaceDefaultUseCasePreset,
        appPreset: store.settings.defaultUseCasePreset
      })
    )
  }, [workspaceDefaultUseCasePreset, settings.defaultUseCasePreset])

  useLayoutEffect(() => {
    const container = messagesContainerRef.current
    if (!container) return

    const chatSwitched = prevActiveChatIdRef.current !== activeChatId
    const delta = chatMessages.length - prevMessageCountRef.current
    prevActiveChatIdRef.current = activeChatId
    prevMessageCountRef.current = chatMessages.length

    // 復元・セッション切替・送信（user+assistant）・ストリーミング中は即時。
    // smooth をチャンクごとに重ねると縦にびくびく揺れる。
    // scrollIntoView は親まで巻き込んで一瞬上余白が開くことがあるため、コンテナだけ動かす。
    const shouldJump =
      !hasSettledScrollRef.current ||
      chatSwitched ||
      Math.abs(delta) > 1 ||
      delta < 0 ||
      isChatLoading

    hasSettledScrollRef.current = true
    container.scrollTo({
      top: container.scrollHeight,
      behavior: shouldJump ? 'auto' : 'smooth'
    })
  }, [chatMessages, pendingWorkspacePreview, activeChatId, isChatLoading])

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

  const openChatTabsKey = openChatSessions.map((session) => `${session.id}:${session.title}`).join('|')

  useLayoutEffect(() => {
    const el = chatTabsRef.current
    if (!el || !activeChatId) return
    const activeTab = el.querySelector<HTMLElement>('.chat-tab.active')
    activeTab?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' })
  }, [activeChatId, openChatTabsKey])

  useEffect(() => {
    if (!modeMenuOpen && !presetMenuOpen) return

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node
      if (modePickerRef.current?.contains(target)) return
      if (presetPickerRef.current?.contains(target)) return
      setModeMenuOpen(false)
      setPresetMenuOpen(false)
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setModeMenuOpen(false)
        setPresetMenuOpen(false)
      }
    }

    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [modeMenuOpen, presetMenuOpen])

  useEffect(() => {
    if (isChatLoading) {
      setModeMenuOpen(false)
      setPresetMenuOpen(false)
    }
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

  const clearInput = () => {
    setCanSend(false)
    inputComposerRef.current?.clear()
  }

  const handleSend = async (overrides?: { text?: string; mode?: ChatMode }) => {
    const text = (overrides?.text ?? inputComposerRef.current?.getValue() ?? '').trim()
    const chatId = activeChatId
    if (!text || !chatId || loadingChatIds.includes(chatId)) return

    const messageMode = overrides?.mode ?? sendMode
    const messagePreset = resolveEffectiveUseCasePreset({
      uiPreset: sendPreset,
      workspacePreset: workspaceDefaultUseCasePreset,
      appPreset: settings.defaultUseCasePreset
    })
    if (messageMode === 'agent' && !isAgentModeAvailable(settings.providerId)) {
      setSendMode('edit')
      lastSentModeRef.current = 'edit'
      setAgentEditFallback({ prompt: text })
      if (!overrides?.text) clearInput()
      return
    }

    const isEditMessage = messageMode === 'edit'
    const isAgentMessage = messageMode === 'agent'
    const selectionsForRequest = buildSelectionsForRequest()
    const historyMessages = chatMessages
    const historyContextRefs = chatContextRefs

    lastSentModeRef.current = messageMode
    if (messageMode !== sendMode) {
      setSendMode(messageMode)
    }
    setAgentEditFallback(null)
    if (!overrides?.text) {
      clearInput()
    }
    setPinnedSelections([])
    if (pendingWorkspacePreview?.chatId === chatId) {
      setPendingWorkspacePreview(null)
    }
    if (!isEditMessage) {
      setPendingCode(null)
    }
    addChatExchange(chatId, text, messageMode, messagePreset, settings.model)
    stopRequestedChatIdsRef.current.delete(chatId)
    setAgentStreamStatusFor(chatId, null)
    setPendingContinueFor(chatId, null)
    setPendingExecApprovalFor(chatId, null)
    setChatLoading(chatId, true)

    const activeFile = getActiveFile()

    if (workspaceRoot) {
      await ensureWorkspaceIndex(workspaceRoot)
    }

    if (stopRequestedChatIdsRef.current.has(chatId)) {
      stopRequestedChatIdsRef.current.delete(chatId)
      setChatLoading(chatId, false)
      updateLastAssistantMessage(chatId, t('chat.aborted'))
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
    let unsubNeedExecApproval: (() => void) | undefined
    let unsubNeedContinue: (() => void) | undefined
    let unsubStep: (() => void) | undefined
    let settled = false

    const isThisChat = (eventChatId: string) => eventChatId === chatId

    const cleanup = () => {
      unsubChunk?.()
      unsubDone?.()
      unsubAborted?.()
      unsubError?.()
      unsubToolStart?.()
      unsubToolResult?.()
      unsubNeedApproval?.()
      unsubNeedExecApproval?.()
      unsubNeedContinue?.()
      unsubStep?.()
    }

    const finish = () => {
      if (settled) return
      settled = true
      cleanup()
      stopRequestedChatIdsRef.current.delete(chatId)
      setAgentStreamStatusFor(chatId, null)
      setPendingContinueFor(chatId, null)
      setPendingExecApprovalFor(chatId, null)
      setChatLoading(chatId, false)
    }

    const syncAssistant = (content: string, steps = agentSteps) => {
      updateLastAssistantMessage(
        chatId,
        content,
        steps.length > 0 ? { agentSteps: steps } : undefined
      )
    }

    unsubChunk = window.compass.ai.onChunk((eventChatId, chunk) => {
      if (!isThisChat(eventChatId)) return
      accumulated += chunk
      if (isEditMessage) {
        const display = stripAllCompassActionsContent(accumulated)
        syncAssistant(display || t('chat.preparingChanges'))
      } else {
        syncAssistant(accumulated)
      }
    })

    if (isAgentMessage) {
      unsubToolStart = window.compass.ai.onToolStart((eventChatId, event) => {
        if (!isThisChat(eventChatId)) return
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

      unsubToolResult = window.compass.ai.onToolResult((eventChatId, event) => {
        if (!isThisChat(eventChatId)) return
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

      unsubNeedApproval = window.compass.ai.onNeedApproval((eventChatId, event) => {
        if (!isThisChat(eventChatId)) return
        setPendingContinueFor(chatId, null)
        setPendingExecApprovalFor(chatId, null)
        setPendingAgentApprovalId(event.id)
        setPendingWorkspacePreview({
          chatId,
          actions: event.actions,
          items: event.items
        })
        setAgentStreamStatusFor(chatId, t('chat.agentWaitingApproval'))
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

      unsubNeedExecApproval = window.compass.ai.onNeedExecApproval((eventChatId, event) => {
        if (!isThisChat(eventChatId)) return
        setPendingContinueFor(chatId, null)
        setPendingExecApprovalFor(chatId, event)
        setAgentStreamStatusFor(chatId, t('chat.agentWaitingExecApproval'))
        agentSteps = agentSteps.map((step) =>
          step.id === event.id
            ? {
                ...step,
                status: 'waiting_approval',
                summary: t('chat.agentWaitingExecApproval')
              }
            : step
        )
        syncAssistant(accumulated.trim() || t('chat.agentWaitingExecApproval'))
      })

      unsubNeedContinue = window.compass.ai.onNeedContinue((eventChatId, event) => {
        if (!isThisChat(eventChatId)) return
        setPendingExecApprovalFor(chatId, null)
        setPendingContinueFor(chatId, event)
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
        setAgentStreamStatusFor(chatId, status)
        syncAssistant(accumulated.trim() || status)
      })

      unsubStep = window.compass.ai.onStep((eventChatId, event) => {
        if (!isThisChat(eventChatId)) return
        // ステータス行は agentStreamStatus で描画。空 content の再同期はスクロールを余計に走らせる。
        setAgentStreamStatusFor(chatId, event.label)
      })
    }

    unsubDone = window.compass.ai.onDone(async (eventChatId) => {
      if (!isThisChat(eventChatId)) return
      finish()

      if (settings.rememberLastUseCasePreset && messagePreset !== settings.defaultUseCasePreset) {
        const next = {
          ...settings,
          defaultUseCasePreset: messagePreset,
          providerKeys: {
            ...settings.providerKeys,
            [settings.providerId]: settings.apiKey
          }
        }
        setSettings(next)
        try {
          await window.compass.settings.set(next)
        } catch {
          // ストアは更新済み。永続化失敗時は次回起動で戻る
        }
      }

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
            updateLastAssistantMessage(chatId, displayContent || t('chat.reviewProposal'))

            const normalizedActions = normalizeWorkspaceActions(workspaceRoot, actions)
            const items = await window.compass.fs.previewActions(workspaceRoot, normalizedActions)
            setPendingWorkspacePreview({
              chatId,
              actions: normalizedActions,
              items
            })
          } catch (error) {
            const message = error instanceof Error ? error.message : t('chat.previewFailed')
            updateLastAssistantMessage(
              chatId,
              displayContent
                ? `${displayContent}\n\n${formatActionPreviewError(message, t)}`
                : formatActionPreviewError(message, t)
            )
          }
        } else if (displayContent !== accumulated.trim()) {
          updateLastAssistantMessage(chatId, displayContent)
        }
      } else if (isAgentMessage) {
        syncAssistant(accumulated.trim())
      }
    })

    unsubAborted = window.compass.ai.onAborted((eventChatId) => {
      if (!isThisChat(eventChatId)) return
      finish()
      if (isEditMessage) {
        const display = stripAllCompassActionsContent(accumulated).trim()
        updateLastAssistantMessage(chatId, display || t('chat.aborted'))
      } else if (isAgentMessage) {
        const state = useAppStore.getState()
        if (state.pendingWorkspacePreview?.chatId === chatId && state.pendingAgentApprovalId) {
          setPendingAgentApprovalId(null)
          revertWorkspacePreview()
        }
        setPendingContinueFor(chatId, null)
        setPendingExecApprovalFor(chatId, null)
        agentSteps = agentSteps.map((step) =>
          step.status === 'running' ||
          step.status === 'waiting_approval' ||
          step.status === 'waiting_continue'
            ? { ...step, status: 'error', ok: false, summary: step.summary || t('chat.aborted') }
            : step
        )
        syncAssistant(accumulated.trim() || t('chat.aborted'))
      } else {
        updateLastAssistantMessage(chatId, accumulated.trim() || t('chat.aborted'))
      }
    })

    unsubError = window.compass.ai.onError((eventChatId, error) => {
      if (!isThisChat(eventChatId)) return
      finish()
      const toolsUnsupportedMessage = parseAgentToolsUnsupportedError(error)
      if (isAgentMessage && toolsUnsupportedMessage) {
        if (useAppStore.getState().activeChatId === chatId) {
          setSendMode('edit')
          lastSentModeRef.current = 'edit'
          setAgentEditFallback({ prompt: text })
        }
        agentSteps = agentSteps.map((step) =>
          step.status === 'running' ||
          step.status === 'waiting_approval' ||
          step.status === 'waiting_continue'
            ? { ...step, status: 'error', ok: false, summary: toolsUnsupportedMessage }
            : step
        )
        syncAssistant(
          `${t('chat.errorPrefix', { error: toolsUnsupportedMessage })}\n${t('chat.agentFallbackSwitched')}`
        )
        return
      }
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
        updateLastAssistantMessage(chatId, t('chat.errorPrefix', { error }))
      }
    })

    const history = [
      ...historyMessages.map((m) => ({
        role: m.role,
        content: m.content,
        ...(isAgentMessage && m.agentSteps && m.agentSteps.length > 0
          ? { agentSteps: m.agentSteps }
          : {})
      })),
      { role: 'user' as const, content: text }
    ]

    await window.compass.ai.chat({
      chatId,
      messages: history,
      workspaceRoot: workspaceRoot ?? undefined,
      mode: messageMode,
      preset: messagePreset,
      context: {
        filePath:
          activeFile &&
          !isMediaOpenFile(activeFile) &&
          !isBrowserOpenFile(activeFile) &&
          !isSettingsOpenFile(activeFile)
            ? activeFile.path
            : undefined,
        fileContent:
          activeFile &&
          !isMediaOpenFile(activeFile) &&
          !isBrowserOpenFile(activeFile) &&
          !isSettingsOpenFile(activeFile)
            ? activeFile.content
            : undefined,
        selections: selectionsForRequest.length > 0 ? selectionsForRequest : undefined,
        references: historyContextRefs.length > 0 ? historyContextRefs : undefined
      }
    })
  }

  const handleStop = () => {
    if (!activeChatId || !loadingChatIds.includes(activeChatId)) return
    stopRequestedChatIdsRef.current.add(activeChatId)
    void window.compass.ai.cancel(activeChatId)
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

  const handlePasteMedia = async (dataTransfer: DataTransfer): Promise<void> => {
    if (!hasClipboardMedia(dataTransfer)) return
    if (pasteMediaInFlightRef.current) return
    if (!workspaceRoot) {
      window.alert(t('chat.pasteMediaNeedsWorkspace'))
      return
    }

    const mediaItems = collectClipboardMedia(dataTransfer)
    if (mediaItems.length === 0) return

    pasteMediaInFlightRef.current = true
    try {
      for (const item of mediaItems) {
        const classified = classifyMediaFile(item.file)
        if (!classified) continue

        const fileName = buildPastedMediaFileName(classified, item.name)
        const absolutePath = join(workspaceRoot, '.compass', 'pasted', fileName)
        const buffer = await item.file.arrayBuffer()
        const bytes = new Uint8Array(buffer)
        let binary = ''
        const chunk = 0x8000
        for (let i = 0; i < bytes.length; i += chunk) {
          binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
        }
        const base64 = btoa(binary)

        await window.compass.fs.writeBinaryFile(absolutePath, base64)

        const ref = {
          path: absolutePath,
          name: fileName,
          isDirectory: false
        }
        addChatContextRefs([ref])
        insertContextMentionIntoInput(ref)
      }

      const tree = await window.compass.fs.readDir(workspaceRoot)
      setFileTree(tree)
    } catch (err) {
      window.alert(
        err instanceof Error ? err.message : t('chat.pasteMediaFailed')
      )
    } finally {
      pasteMediaInFlightRef.current = false
    }
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
    if (!activeChatId) return
    const last = chatMessages[chatMessages.length - 1]
    if (last?.role === 'assistant') {
      updateLastAssistantMessage(activeChatId, `${last.content}\n\n${note}`)
    } else {
      addChatMessage(activeChatId, 'assistant', note)
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
      const canAskAgent = Boolean(useAppStore.getState().pendingAgentApprovalId)
      appendAssistantNote(
        `${t('chat.fileOpError', { message })}\n${
          canAskAgent ? t('chat.applyFailedAskAgentHint') : t('chat.applyRetryHint')
        }`
      )
    }
  }

  const handleAgentContinue = () => {
    const event = pendingContinue
    if (!event || !activeChatId) return
    setPendingContinueFor(activeChatId, null)
    setAgentStreamStatusFor(activeChatId, t('chat.generating'))
    void window.compass.ai.resolveContinue({ id: event.id, continue: true })
  }

  const handleAgentStopContinue = () => {
    const event = pendingContinue
    if (!event || !activeChatId) return
    setPendingContinueFor(activeChatId, null)
    void window.compass.ai.resolveContinue({ id: event.id, continue: false })
  }

  const handleAllowExec = () => {
    const event = pendingExecApproval
    if (!event || !activeChatId) return
    setPendingExecApprovalFor(activeChatId, null)
    setAgentStreamStatusFor(activeChatId, t('chat.generating'))
    void window.compass.ai.resolveApproval({
      id: event.id,
      approved: true,
      detail: `User approved exec: ${event.command}`
    })
  }

  const handleDenyExec = () => {
    const event = pendingExecApproval
    if (!event || !activeChatId) return
    setPendingExecApprovalFor(activeChatId, null)
    void window.compass.ai.resolveApproval({
      id: event.id,
      approved: false,
      detail: `User rejected exec command (${event.reason}): ${event.command}`
    })
  }

  const handleResendAsEdit = () => {
    const prompt = agentEditFallback?.prompt?.trim()
    if (!prompt || isChatLoading) return
    setAgentEditFallback(null)
    void handleSend({ text: prompt, mode: 'edit' })
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
      <div className="chat-tabs-bar">
        <div
          className="chat-tabs"
          ref={chatTabsRef}
          onDragOver={(e) => {
            if (!hasTabReorderDrag(e.dataTransfer, CHAT_TAB_REORDER_MIME)) return
            e.preventDefault()
            e.dataTransfer.dropEffect = 'move'
            if (e.target === e.currentTarget) {
              setChatTabDropIndex(openChatSessions.length)
            }
          }}
          onDrop={(e) => {
            if (!hasTabReorderDrag(e.dataTransfer, CHAT_TAB_REORDER_MIME)) return
            e.preventDefault()
            const fromId =
              chatTabDragIdRef.current || e.dataTransfer.getData(CHAT_TAB_REORDER_MIME)
            const toIndex = chatTabDropIndex
            chatTabDragIdRef.current = null
            setChatTabDragId(null)
            setChatTabDropIndex(null)
            if (!fromId || toIndex === null) return
            reorderChatSession(fromId, toIndex)
          }}
          onDragLeave={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node)) {
              setChatTabDropIndex(null)
            }
          }}
        >
          {openChatSessions.map((session, index) => (
            <div
              key={session.id}
              className={`chat-tab draggable${session.id === activeChatId ? ' active' : ''}${
                loadingChatIds.includes(session.id) ? ' loading' : ''
              }${chatTabDragId === session.id ? ' tab-dragging' : ''}${
                chatTabDropIndex === index ? ' tab-drop-before' : ''
              }`}
              draggable
              onClick={() => setActiveChatSession(session.id)}
              title={session.title}
              onDragStart={(e) => {
                chatTabDragIdRef.current = session.id
                setChatTabDragId(session.id)
                e.dataTransfer.setData(CHAT_TAB_REORDER_MIME, session.id)
                e.dataTransfer.effectAllowed = 'move'
              }}
              onDragEnd={() => {
                chatTabDragIdRef.current = null
                setChatTabDragId(null)
                setChatTabDropIndex(null)
              }}
              onDragOver={(e) => {
                if (!hasTabReorderDrag(e.dataTransfer, CHAT_TAB_REORDER_MIME)) return
                e.preventDefault()
                e.stopPropagation()
                e.dataTransfer.dropEffect = 'move'
                const rect = e.currentTarget.getBoundingClientRect()
                setChatTabDropIndex(
                  resolveTabDropIndex(e.clientX, rect.left, rect.width, index)
                )
              }}
              onDrop={(e) => {
                if (!hasTabReorderDrag(e.dataTransfer, CHAT_TAB_REORDER_MIME)) return
                e.preventDefault()
                e.stopPropagation()
                const rect = e.currentTarget.getBoundingClientRect()
                const toIndex = resolveTabDropIndex(e.clientX, rect.left, rect.width, index)
                const fromId =
                  chatTabDragIdRef.current || e.dataTransfer.getData(CHAT_TAB_REORDER_MIME)
                chatTabDragIdRef.current = null
                setChatTabDragId(null)
                setChatTabDropIndex(null)
                if (!fromId) return
                reorderChatSession(fromId, toIndex)
              }}
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
                <CloseIcon />
              </button>
            </div>
          ))}
          {chatTabDropIndex === openChatSessions.length && (
            <div className="tab-drop-end" aria-hidden />
          )}
        </div>
        <div className="chat-header-actions">
          <div className="chat-history-menu" ref={historyRef}>
            <button
              ref={historyButtonRef}
              className="btn-icon"
              onClick={() => setHistoryOpen((open) => !open)}
              title={t('chat.history')}
              aria-expanded={historyOpen}
              aria-haspopup="listbox"
            >
              <ChatHistoryIcon />
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
                            <CloseIcon />
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
          >
            <PlusIcon />
          </button>
          <button
            className="btn-icon"
            onClick={() => useAppStore.getState().clearChat()}
            title={t('chat.clear')}
            disabled={isChatLoading}
          >
            <TrashIcon />
          </button>
        </div>
      </div>

      <div className="chat-messages" ref={messagesContainerRef}>
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
          const requestMeta =
            msg.role === 'assistant' && index > 0 && chatMessages[index - 1]?.role === 'user'
              ? chatMessages[index - 1]
              : null
          const requestMode = requestMeta?.mode
          const requestPreset = normalizeUseCasePreset(requestMeta?.preset)
          const requestPresetOption = requestPreset
            ? USE_CASE_PRESET_OPTIONS.find((option) => option.id === requestPreset)
            : undefined
          const requestModeLabel = requestMode
            ? (CHAT_MODE_OPTIONS.find((option) => option.id === requestMode)?.label ?? requestMode)
            : null
          const requestModel =
            typeof requestMeta?.model === 'string' && requestMeta.model.trim()
              ? requestMeta.model.trim()
              : null

          return (
            <div key={msg.id} className={`chat-message ${msg.role}`}>
              <div className="chat-role">
                <span>{msg.role === 'user' ? t('chat.you') : t('chat.ai')}</span>
                {requestModeLabel && requestMode ? (
                  <span className={`chat-message-mode ${requestMode}`}>{requestModeLabel}</span>
                ) : null}
                {requestPresetOption ? (
                  <span className={`chat-message-preset preset-${requestPresetOption.id}`}>
                    {t(requestPresetOption.labelKey)}
                  </span>
                ) : null}
                {requestModel ? (
                  <span className="chat-message-model" title={requestModel}>
                    {requestModel}
                  </span>
                ) : null}
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
      </div>

      {isActiveChatPreview && pendingWorkspacePreview && (
        <WorkspaceActionPreview
          items={pendingWorkspacePreview.items}
          applyError={lastApplyError}
          onApply={() => void handleApplyActions()}
          onReject={() => revertWorkspacePreview()}
          onAskAgentFix={
            lastApplyError && pendingAgentApprovalId
              ? () => sendApplyFailureToAgent()
              : undefined
          }
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

      {pendingExecApproval && !pendingContinue && (
        <div className="agent-exec-approval-bar">
          <div className="agent-exec-approval-info">
            <div className="agent-exec-approval-title">{t('chat.agentWaitingExecApproval')}</div>
            <code className="agent-exec-approval-command">{pendingExecApproval.command}</code>
            <div className="agent-exec-approval-meta">
              {t('chat.agentExecApprovalMeta', {
                cwd: pendingExecApproval.cwd,
                reason: pendingExecApproval.reason
              })}
            </div>
          </div>
          <div className="agent-exec-approval-actions">
            <button type="button" className="btn-apply" onClick={handleAllowExec}>
              {t('chat.agentAllowExec')}
            </button>
            <button type="button" className="btn-reject" onClick={handleDenyExec}>
              {t('chat.agentDenyExec')}
            </button>
          </div>
        </div>
      )}

      {agentEditFallback && !pendingContinue && !pendingExecApproval && (
        <div className="agent-fallback-bar">
          <div className="agent-fallback-info">{t('chat.agentFallbackHint')}</div>
          <div className="agent-fallback-actions">
            <button
              type="button"
              className="btn-apply"
              onClick={handleResendAsEdit}
              disabled={isChatLoading}
            >
              {t('chat.agentResendAsEdit')}
            </button>
            <button
              type="button"
              className="btn-reject"
              onClick={() => setAgentEditFallback(null)}
              disabled={isChatLoading}
            >
              {t('common.cancel')}
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
            onCanSendChange={setCanSend}
            onSubmit={() => void handleSend()}
            onPasteSelection={handlePasteSelection}
            onPasteMedia={(data) => {
              void handlePasteMedia(data)
            }}
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
            <div className="chat-input-footer-controls">
              <div className="chat-mode-picker" ref={modePickerRef}>
                <button
                  type="button"
                  className={`chat-mode-trigger mode-${sendMode}`}
                  onClick={() => {
                    setPresetMenuOpen(false)
                    setModeMenuOpen((open) => !open)
                  }}
                  disabled={isChatLoading}
                  title={
                    !agentModeAvailable
                      ? t('chat.agentModeUnavailable')
                      : t(activeModeOption.titleKey)
                  }
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
                    {modeOptions.map((option) => {
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
                    {!agentModeAvailable ? (
                      <p className="chat-mode-menu-hint">{t('chat.agentModeUnavailable')}</p>
                    ) : null}
                  </div>
                ) : null}
              </div>
              <div className="chat-preset-picker" ref={presetPickerRef}>
                <button
                  type="button"
                  className={`chat-preset-trigger preset-${sendPreset}`}
                  onClick={() => {
                    setModeMenuOpen(false)
                    setPresetMenuOpen((open) => !open)
                  }}
                  disabled={isChatLoading}
                  title={t(activePresetOption.descKey)}
                  aria-label={t('chat.useCasePreset')}
                  aria-haspopup="listbox"
                  aria-expanded={presetMenuOpen}
                >
                  <span className="chat-preset-dot" aria-hidden="true" />
                  <span className="chat-preset-trigger-label">
                    {t(activePresetOption.labelKey)}
                  </span>
                  <span className="chat-preset-chevron" aria-hidden="true">
                    ▾
                  </span>
                </button>
                {presetMenuOpen ? (
                  <div
                    className="chat-preset-menu"
                    role="listbox"
                    aria-label={t('chat.useCasePreset')}
                  >
                    {USE_CASE_PRESET_OPTIONS.map((option) => {
                      const selected = option.id === sendPreset
                      return (
                        <button
                          key={option.id}
                          type="button"
                          role="option"
                          aria-selected={selected}
                          className={`chat-preset-menu-item preset-${option.id}${
                            selected ? ' selected' : ''
                          }`}
                          title={t(option.descKey)}
                          onClick={() => {
                            setSendPreset(option.id)
                            setPresetMenuOpen(false)
                          }}
                        >
                          <span className="chat-preset-dot" aria-hidden="true" />
                          <span className="chat-preset-menu-item-text">
                            <span className="chat-preset-menu-item-label">
                              {t(option.labelKey)}
                            </span>
                            <span className="chat-preset-menu-item-desc">
                              {t(option.descKey)}
                            </span>
                          </span>
                          {selected ? (
                            <span className="chat-preset-menu-check" aria-hidden="true">
                              ✓
                            </span>
                          ) : null}
                        </button>
                      )
                    })}
                  </div>
                ) : null}
              </div>
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
                onClick={() => void handleSend()}
                disabled={!canSend}
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
