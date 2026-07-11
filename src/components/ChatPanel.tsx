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
import type { ActionPreviewItem, ChatMode, ChatSelectionRef } from '@/types'
import {
  buildDisplayContentForActions,
  inferWorkspaceActionsFromCodeBlocks,
  normalizeWorkspaceActions,
  parseWorkspaceActionsFromContent,
  stripAllCompassActionsContent
} from '@/utils/workspace-actions'
import {
  hasChatContextDrag,
  parseChatContextRef
} from '@/utils/chat-context-drag'
import {
  formatFileMention,
  formatFolderMention
} from '@/utils/chat-mentions'
import {
  buildSelectionMention,
  hasChatSelectionDrag,
  normalizeSelectionLines,
  parseChatSelectionDrag,
  resolveSelectionFromClipboard,
  toChatSelectionRef
} from '@/utils/chat-selection-drag'
import { buildWorkspaceIndex, ensureWorkspaceIndex } from '@/utils/project-index'

function formatContextLabel(path: string, workspaceRoot: string | null): string {
  if (!workspaceRoot) return path
  const root = workspaceRoot.replace(/\\/g, '/')
  const normalized = path.replace(/\\/g, '/')
  if (normalized.startsWith(root)) {
    return normalized.slice(root.length).replace(/^\//, '') || path
  }
  return path
}

/** 指示文に埋め込むパス表記（フォルダは末尾 `/`） */
function formatContextMention(
  path: string,
  isDirectory: boolean,
  workspaceRoot: string | null
): string {
  const label = formatContextLabel(path, workspaceRoot)
  return isDirectory ? formatFolderMention(label) : formatFileMention(label)
}

function selectionRefKey(ref: ChatSelectionRef): string {
  return `${ref.path.replace(/\\/g, '/')}:${ref.startLine}-${ref.endLine}`
}

function parseWorkspaceActions(raw: string) {
  return parseWorkspaceActionsFromContent(raw)
}

export function ChatPanel() {
  const [input, setInput] = useState('')
  const [sendMode, setSendMode] = useState<ChatMode>('edit')
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
  const stopRequestedRef = useRef(false)
  const lastSentModeRef = useRef<ChatMode>('edit')

  const chatSessions = useAppStore((s) => s.chatSessions)
  const activeChatId = useAppStore((s) => s.activeChatId)
  const activeChat = useAppStore((s) => s.getActiveChatSession())
  const isChatLoading = useAppStore((s) => s.isChatLoading)
  const pendingWorkspacePreview = useAppStore((s) => s.pendingWorkspacePreview)
  const addChatMessage = useAppStore((s) => s.addChatMessage)
  const updateLastAssistantMessage = useAppStore((s) => s.updateLastAssistantMessage)
  const setChatLoading = useAppStore((s) => s.setChatLoading)
  const getActiveFile = useAppStore((s) => s.getActiveFile)
  const editorSelection = useAppStore((s) => s.editorSelection)
  const updateFileContent = useAppStore((s) => s.updateFileContent)
  const activeFilePath = useAppStore((s) => s.activeFilePath)
  const workspaceRoot = useAppStore((s) => s.workspaceRoot)
  const setPendingWorkspacePreview = useAppStore((s) => s.setPendingWorkspacePreview)
  const openPreviewFile = useAppStore((s) => s.openPreviewFile)
  const applyWorkspacePreview = useAppStore((s) => s.applyWorkspacePreview)
  const revertWorkspacePreview = useAppStore((s) => s.revertWorkspacePreview)
  const setFileTree = useAppStore((s) => s.setFileTree)
  const addChatContextRef = useAppStore((s) => s.addChatContextRef)
  const createChatSession = useAppStore((s) => s.createChatSession)
  const setActiveChatSession = useAppStore((s) => s.setActiveChatSession)
  const closeChatSession = useAppStore((s) => s.closeChatSession)
  const reopenChatSession = useAppStore((s) => s.reopenChatSession)
  const deleteChatSession = useAppStore((s) => s.deleteChatSession)
  const chatComposerInsertRequest = useAppStore((s) => s.chatComposerInsertRequest)
  const clearChatComposerInsertRequest = useAppStore((s) => s.clearChatComposerInsertRequest)

  const openChatSessions = chatSessions.filter((session) => session.isOpen)
  const historySessions = [...chatSessions]
    .filter((session) => session.messages.length > 0)
    .sort((a, b) => b.updatedAt - a.updatedAt)

  const chatMessages = activeChat?.messages ?? []
  const chatContextRefs = activeChat?.contextRefs ?? []
  const isEditSendMode = sendMode === 'edit'
  const isActiveChatPreview = pendingWorkspacePreview?.chatId === activeChatId

  useEffect(() => {
    setPendingCode(null)
    setPinnedSelections([])
    const session = useAppStore.getState().getActiveChatSession()
    const lastUser = [...(session?.messages ?? [])]
      .reverse()
      .find((message) => message.role === 'user')
    if (lastUser?.mode === 'ask' || lastUser?.mode === 'edit') {
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

  const formatHistoryTime = (timestamp: number) => {
    try {
      return new Intl.DateTimeFormat('ja-JP', {
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
    setChatLoading(true)

    const activeFile = getActiveFile()

    if (workspaceRoot) {
      await ensureWorkspaceIndex(workspaceRoot)
    }

    if (stopRequestedRef.current) {
      setChatLoading(false)
      updateLastAssistantMessage('（中断されました）')
      return
    }

    let accumulated = ''
    let unsubChunk: (() => void) | undefined
    let unsubDone: (() => void) | undefined
    let unsubAborted: (() => void) | undefined
    let unsubError: (() => void) | undefined
    let settled = false

    const cleanup = () => {
      unsubChunk?.()
      unsubDone?.()
      unsubAborted?.()
      unsubError?.()
    }

    const finish = () => {
      if (settled) return
      settled = true
      cleanup()
      setChatLoading(false)
    }

    unsubChunk = window.compass.ai.onChunk((chunk) => {
      accumulated += chunk
      if (isEditMessage) {
        const display = stripAllCompassActionsContent(accumulated)
        updateLastAssistantMessage(display || '変更を準備しています...')
      } else {
        updateLastAssistantMessage(accumulated)
      }
    })

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
            updateLastAssistantMessage(displayContent || '変更提案をエディタで確認してください。')

            const normalizedActions = normalizeWorkspaceActions(workspaceRoot, actions)
            const items = await window.compass.fs.previewActions(workspaceRoot, normalizedActions)
            setPendingWorkspacePreview({ actions: normalizedActions, items })
          } catch (error) {
            const message = error instanceof Error ? error.message : 'プレビューの生成に失敗しました'
            updateLastAssistantMessage(
              displayContent ? `${displayContent}\n\n⚠️ ${message}` : `⚠️ ${message}`
            )
          }
        } else if (displayContent !== accumulated.trim()) {
          updateLastAssistantMessage(displayContent)
        }
      }
    })

    unsubAborted = window.compass.ai.onAborted(() => {
      finish()
      if (isEditMessage) {
        const display = stripAllCompassActionsContent(accumulated).trim()
        updateLastAssistantMessage(display || '（中断されました）')
      } else {
        updateLastAssistantMessage(accumulated.trim() || '（中断されました）')
      }
    })

    unsubError = window.compass.ai.onError((error) => {
      finish()
      updateLastAssistantMessage(`エラー: ${error}`)
    })

    const history = [
      ...chatMessages.map((m) => ({ role: m.role, content: m.content })),
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
    const { mention, selection } = chatComposerInsertRequest
    if (selection) {
      pinSelectionAndInsert(selection, mention)
    } else {
      insertMentionAtCursor(mention)
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

    const fileRef = parseChatContextRef(e.dataTransfer)
    if (fileRef) {
      addChatContextRef(fileRef)
      insertContextMentionIntoInput(fileRef)
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
      appendAssistantNote(`✅ ${itemCount} 件の変更を適用しました。`)
    } catch (error) {
      const message = error instanceof Error ? error.message : '適用に失敗しました'
      appendAssistantNote(`⚠️ ファイル操作エラー: ${message}`)
    }
  }

  const activeFile = getActiveFile()

  return (
    <div className="chat-panel">
      <div className="panel-header chat-panel-header">
        <span>AI チャット</span>
        <div className="chat-header-actions">
          <div className="chat-history-menu" ref={historyRef}>
            <button
              ref={historyButtonRef}
              className="btn-icon"
              onClick={() => setHistoryOpen((open) => !open)}
              title="チャット履歴"
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
                  aria-label="チャット履歴"
                  style={{ top: historyMenuPos.top, right: historyMenuPos.right }}
                >
                  <div className="chat-history-dropdown-header">過去のチャット</div>
                  {historySessions.length === 0 ? (
                    <div className="chat-history-empty">保存された履歴はまだありません</div>
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
                              {session.isOpen ? ' · 開いています' : ''}
                            </span>
                          </button>
                          <button
                            type="button"
                            className="chat-history-item-delete"
                            title="履歴から削除"
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
            title="新しいチャット"
            disabled={isChatLoading}
          >
            ＋
          </button>
          <button
            className="btn-icon"
            onClick={() => useAppStore.getState().clearChat()}
            title="このチャットをクリア"
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
              title="タブを閉じる（履歴は残ります）"
            >
              ×
            </button>
          </div>
        ))}
      </div>

      <div className="chat-messages">
        {chatMessages.length === 0 && (
          <div className="chat-empty">
            <p>コードについて質問したり、実装や変更を依頼できます</p>
            <p className="hint">
              送信前に Ask / Edit を選べます。Ask は説明のみ、Edit はファイル変更を提案します
            </p>
            <p className="hint">現在のファイルが自動的にコンテキストに含まれます</p>
            <p className="hint">
              エディタでコピーした選択行をチャットに貼ると、自動で参照カプセルになります
            </p>
          </div>
        )}
        {chatMessages.map((msg, index) => {
          const isLast = index === chatMessages.length - 1
          const isStreaming = isLast && msg.role === 'assistant' && isChatLoading

          return (
            <div key={msg.id} className={`chat-message ${msg.role}`}>
              <div className="chat-role">
                <span>{msg.role === 'user' ? 'あなた' : 'AI'}</span>
                {msg.role === 'user' && msg.mode && (
                  <span className={`chat-message-mode ${msg.mode}`}>
                    {msg.mode === 'edit' ? 'Edit' : 'Ask'}
                  </span>
                )}
              </div>
              <div className="chat-content">
                <ChatMessageContent content={msg.content} isStreaming={isStreaming} />
              </div>
            </div>
          )
        })}
        <div ref={messagesEndRef} />
      </div>

      {isActiveChatPreview && pendingWorkspacePreview && (
        <WorkspaceActionPreview
          items={pendingWorkspacePreview.items}
          onApply={() => void handleApplyActions()}
          onReject={() => revertWorkspacePreview()}
          onSelectItem={handleSelectPreviewItem}
        />
      )}

      {!isEditSendMode && pendingCode && activeFile && (
        <DiffPreview
          oldText={activeFile.content}
          newText={pendingCode.code}
          title="エディタへの適用"
          onApply={handleApplyCode}
          onReject={() => setPendingCode(null)}
        />
      )}

      {!isEditSendMode && pendingCode && activeFile && (
        <div className="apply-options">
          <button className="btn-secondary" onClick={handleInsert}>
            カーソル位置に挿入
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
                ? '実装や変更を依頼... (Enterで送信, Shift+Enterで改行)'
                : '質問を入力... (Enterで送信, Shift+Enterで改行)'
            }
            disabled={isChatLoading}
          />
          <div className="chat-input-footer">
            <div className="chat-mode-switch" role="group" aria-label="送信モード">
              <button
                type="button"
                aria-pressed={sendMode === 'edit'}
                className={sendMode === 'edit' ? 'active' : ''}
                onClick={() => setSendMode('edit')}
                disabled={isChatLoading}
                title="このメッセージを Edit モードで送信（ファイルの作成・変更を提案）"
              >
                Edit
              </button>
              <button
                type="button"
                aria-pressed={sendMode === 'ask'}
                className={sendMode === 'ask' ? 'active' : ''}
                onClick={() => setSendMode('ask')}
                disabled={isChatLoading}
                title="このメッセージを Ask モードで送信（質問への回答のみ）"
              >
                Ask
              </button>
            </div>
            {isChatLoading ? (
              <button
                type="button"
                className="btn-send btn-stop"
                onClick={handleStop}
                title="AIの応答を中断"
              >
                停止
              </button>
            ) : (
              <button
                type="button"
                className="btn-send"
                onClick={handleSend}
                disabled={!input.trim()}
              >
                送信
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
