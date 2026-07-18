import type { WebContents } from 'electron'
import type {
  ChatRequest,
  InlineCompletionRequest,
  InlineCompletionResult,
  ResolvedContextFile,
  UseCasePreset
} from '../../src/types'
import { normalizeUseCasePreset, DEFAULT_SETTINGS } from '../../src/types'
import { t } from '../../src/i18n/runtime'
import type { MessageKey } from '../../src/i18n/messages'
import { composeSystemPrompt, getUseCasePresetReminderKey } from '../../src/utils/system-prompt'
import { resolveInlineCompletionStyle } from '../../src/utils/inline-completion-prompt'
import {
  toApiUserContent,
  type ChatContentPart,
  type ChatImageAttachment,
  type UserMessagePayload
} from '../../src/utils/chat-content-parts'
import { getSettings } from './settings'
import { ensureProjectIndex, getProjectIndexContext } from './project-indexer'
import { resolveChatContext } from './filesystem'
import { getLlmProvider, getProviderLabel } from '../../src/utils/llm-providers'

export type { ChatContentPart, ChatImageAttachment, UserMessagePayload }
export { toApiUserContent }

const PRESET_ROLE_KEYS: Record<UseCasePreset, MessageKey> = {
  general: 'ai.preset.general.role',
  document: 'ai.preset.document.role',
  data: 'ai.preset.data.role',
  code: 'ai.preset.code.role'
}

export { composeSystemPrompt }

function appendResolvedFile(
  parts: string[],
  file: ResolvedContextFile,
  images: ChatImageAttachment[]
): void {
  if (file.kind === 'image' && file.mimeType && file.base64) {
    parts.push(t('ai.imageHeading', { path: file.relativePath }))
    parts.push(t('ai.imageAttachedNote'))
    parts.push('')
    images.push({
      relativePath: file.relativePath,
      mimeType: file.mimeType,
      base64: file.base64
    })
    return
  }

  const heading =
    file.kind === 'pdf'
      ? t('ai.pdfHeading', { path: file.relativePath })
      : t('ai.fileHeading', { path: file.relativePath })
  parts.push(`${heading}${file.truncated ? ' (truncated)' : ''}`)
  const fence = file.kind === 'pdf' ? 'text' : (file.relativePath.split('.').pop() ?? '')
  parts.push('```' + fence)
  parts.push(file.content)
  parts.push('```')
  parts.push('')
}

export function getSystemPrompt(
  mode: ChatRequest['mode'],
  preset?: UseCasePreset | null
): string {
  const resolved = normalizeUseCasePreset(preset) ?? DEFAULT_SETTINGS.defaultUseCasePreset
  const rolePrompt = t(PRESET_ROLE_KEYS[resolved])
  const modePrompt =
    mode === 'ask'
      ? t('ai.askSystemPrompt')
      : mode === 'agent'
        ? t('ai.agentSystemPrompt')
        : t('ai.editSystemPrompt')
  return composeSystemPrompt(rolePrompt, modePrompt)
}

const INLINE_COMPLETION_MAX_TOKENS = 96
/** 推論モデルは reasoning にもトークンを使うため余裕を持たせる */
const INLINE_COMPLETION_REASONING_MAX_TOKENS = 2048

function isReasoningModel(model: string): boolean {
  const m = model.toLowerCase()
  return (
    m.startsWith('o1') ||
    m.startsWith('o3') ||
    m.startsWith('o4') ||
    m.startsWith('gpt-5') ||
    m.includes('reason')
  )
}

function buildInlineCompletionUserMessage(request: InlineCompletionRequest): string {
  const style = resolveInlineCompletionStyle({
    language: request.language,
    filePath: request.filePath,
    useCasePreset: request.preset
  })
  const meta: string[] = []
  if (request.filePath) {
    meta.push(t('ai.inlineCompletionFile', { path: request.filePath }))
  }
  if (request.language) {
    meta.push(t('ai.inlineCompletionLanguage', { language: request.language }))
  }

  return [
    meta.length > 0 ? meta.join('\n') : null,
    t(style === 'code' ? 'ai.inlineCompletionIntroCode' : 'ai.inlineCompletionIntroText'),
    '',
    request.prefix + '<|cursor|>' + request.suffix,
    t('ai.inlineCompletionOutro')
  ]
    .filter((line) => line !== null)
    .join('\n')
}

function buildInlineCompletionMessages(
  request: InlineCompletionRequest
): Array<{ role: 'system' | 'user' | 'assistant'; content: string }> {
  const style = resolveInlineCompletionStyle({
    language: request.language,
    filePath: request.filePath,
    useCasePreset: request.preset
  })
  // few-shot なし（例文コピーや Chat デバッグ時の混乱を避ける）
  // プロンプト文言は getSettings() → setLocale 後に t() で UI 言語に合わせる
  return [
    {
      role: 'system',
      content: t(
        style === 'code'
          ? 'ai.inlineCompletionSystemPromptCode'
          : 'ai.inlineCompletionSystemPromptText'
      )
    },
    { role: 'user', content: buildInlineCompletionUserMessage(request) }
  ]
}

/**
 * モデルが付けがちな説明・フェンス・ゴミ応答を除去する。
 * 改行・インデントは補完本体になり得るので trim しない。
 */
export function sanitizeInlineCompletion(raw: string): string {
  let text = raw.replace(/\r\n/g, '\n')
  if (text.length === 0) return ''

  const fenced = text.match(/^```(?:\w+)?\n([\s\S]*?)\n```[ \t]*$/)
  if (fenced) {
    text = fenced[1]
  } else if (/^```/.test(text.trimStart())) {
    text = text.replace(/^[ \t]*```(?:\w+)?\n?/, '').replace(/\n?[ \t]*```[ \t]*$/, '')
  }

  text = text.replace(/<\|cursor\|>/g, '')

  const compact = text.trim()
  if (
    compact.length > 0 &&
    /^(gpt|chatgpt|claude|ok|okay|sure|yes|no|done|sorry|here( you go)?|当然|はい|いいえ)[.!。]*$/i.test(
      compact
    )
  ) {
    return ''
  }

  const lines = text.split('\n')
  if (
    lines.length > 1 &&
    compact.length > 0 &&
    !/^[ \t]*(?:[{}()[\];,.<>/*+\-|&!?=`'"@#]|\/\/|\/\*|#|<!--)/.test(lines[0]) &&
    /[.。:：]$/.test(lines[0].trim()) &&
    lines[0].trim().split(/\s+/).length > 3
  ) {
    text = lines.slice(1).join('\n')
  }

  return text
}

export async function buildUserMessagePayload(request: ChatRequest): Promise<UserMessagePayload> {
  const parts: string[] = []
  const images: ChatImageAttachment[] = []

  if (request.workspaceRoot) {
    try {
      await ensureProjectIndex(request.workspaceRoot)
    } catch {
      // Continue without a fresh index if rebuild fails.
    }

    const indexContext = await getProjectIndexContext(request.workspaceRoot, {
      currentFile: request.context?.filePath,
      referencePaths: request.context?.references?.map((r) => r.path)
    })
    if (indexContext) {
      parts.push(indexContext.aiContext)
      parts.push('')
    }
  }

  if (request.workspaceRoot && request.context?.references?.length) {
    const resolved = await resolveChatContext(request.workspaceRoot, request.context.references)
    if (resolved.files.length > 0 || resolved.folders.length > 0) {
      parts.push(t('ai.userRefsHeader'))
      parts.push(t('ai.userRefsIntro'))

      for (const folder of resolved.folders) {
        parts.push(t('ai.folderHeading', { path: folder.relativePath }))
        parts.push(t('ai.structureHeading'))
        for (const filePath of folder.structure.slice(0, 40)) {
          parts.push(`- ${filePath}`)
        }
        if (folder.truncated) parts.push(t('ai.truncated'))
        for (const file of folder.files) {
          if (file.kind === 'image' && file.mimeType && file.base64) {
            parts.push(`### ${file.relativePath}`)
            parts.push(t('ai.imageAttachedNote'))
            images.push({
              relativePath: file.relativePath,
              mimeType: file.mimeType,
              base64: file.base64
            })
          } else {
            const ext = file.kind === 'pdf' ? 'text' : (file.relativePath.split('.').pop() ?? '')
            const label =
              file.kind === 'pdf'
                ? `${file.relativePath} (PDF)`
                : file.relativePath
            parts.push(`### ${label}${file.truncated ? ' (truncated)' : ''}`)
            parts.push('```' + ext)
            parts.push(file.content)
            parts.push('```')
          }
        }
        parts.push('')
      }

      for (const file of resolved.files) {
        appendResolvedFile(parts, file, images)
      }
    }
  }

  if (request.context?.filePath && request.context.fileContent !== undefined) {
    const ext = request.context.filePath.split('.').pop() ?? ''
    parts.push(t('ai.currentFile', { path: request.context.filePath }))
    parts.push('```' + ext)
    parts.push(request.context.fileContent)
    parts.push('```')
    parts.push('')
  }

  const selections =
    request.context?.selections && request.context.selections.length > 0
      ? request.context.selections
      : request.context?.selection
        ? [
            {
              path: request.context.filePath ?? '',
              startLine: 0,
              endLine: 0,
              text: request.context.selection
            }
          ]
        : []

  if (selections.length > 0) {
    parts.push(t('ai.selectionsHeader'))
    for (const sel of selections) {
      const range =
        sel.startLine > 0
          ? sel.startLine === sel.endLine
            ? `:${sel.startLine}`
            : `:${sel.startLine}-${sel.endLine}`
          : ''
      const label = sel.path ? `${sel.path}${range}` : t('ai.selectionText')
      const ext = sel.path.split('.').pop() ?? ''
      parts.push(`## ${label}`)
      parts.push('```' + ext)
      parts.push(sel.text)
      parts.push('```')
      parts.push('')
    }
  }

  const presetReminderKey = getUseCasePresetReminderKey(
    normalizeUseCasePreset(request.preset) ?? DEFAULT_SETTINGS.defaultUseCasePreset
  )
  if (presetReminderKey) {
    parts.push(t(presetReminderKey))
    parts.push('')
  }

  if (request.mode === 'edit') {
    parts.push(t('ai.editModeReminder'))
    parts.push('')
  }

  if (request.mode === 'agent') {
    parts.push(t('ai.agentModeReminder'))
    parts.push('')
  }

  const lastUser = [...request.messages].reverse().find((m) => m.role === 'user')
  if (lastUser) {
    parts.push(t('ai.userQuestion'))
    parts.push(lastUser.content)
  }

  return { text: parts.join('\n'), images }
}

export async function buildUserMessage(request: ChatRequest): Promise<string> {
  const payload = await buildUserMessagePayload(request)
  return payload.text
}

const activeAbortControllers = new Map<string, AbortController>()
let activeCompleteAbortController: AbortController | null = null

export function cancelChat(chatId?: string): boolean {
  if (chatId) {
    const controller = activeAbortControllers.get(chatId)
    if (!controller) return false
    controller.abort()
    return true
  }
  if (activeAbortControllers.size === 0) return false
  for (const controller of activeAbortControllers.values()) {
    controller.abort()
  }
  return true
}

export function acquireChatAbortController(chatId: string): AbortController {
  activeAbortControllers.get(chatId)?.abort()
  const controller = new AbortController()
  activeAbortControllers.set(chatId, controller)
  return controller
}

export function releaseChatAbortController(chatId: string, controller: AbortController): void {
  if (activeAbortControllers.get(chatId) === controller) {
    activeAbortControllers.delete(chatId)
  }
}

/** Renderer へ chatId 付きで AI イベントを送る */
export function sendAiEvent(
  webContents: WebContents,
  channel: string,
  chatId: string,
  ...args: unknown[]
): void {
  webContents.send(channel, chatId, ...args)
}

export function cancelInlineCompletion(): boolean {
  if (!activeCompleteAbortController) return false
  activeCompleteAbortController.abort()
  return true
}

export function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === 'AbortError'
}

export function buildApiHeaders(settings: Awaited<ReturnType<typeof getSettings>>): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json'
  }
  if (settings.apiKey) {
    headers.Authorization = `Bearer ${settings.apiKey}`
  }
  if (settings.providerId === 'openrouter') {
    headers['HTTP-Referer'] = 'https://github.com/compass-editor'
    headers['X-Title'] = 'Compass'
  }
  return headers
}

export async function completeInline(
  request: InlineCompletionRequest
): Promise<InlineCompletionResult> {
  activeCompleteAbortController?.abort()
  const abortController = new AbortController()
  activeCompleteAbortController = abortController
  const { signal } = abortController

  try {
    if (!request.prefix.trim() && !request.suffix.trim()) {
      return { text: '' }
    }

    const settings = await getSettings()
    if (signal.aborted) return { text: '', cancelled: true }

    const provider = getLlmProvider(settings.providerId)
    if (provider.requiresApiKey && !settings.apiKey) {
      return {
        text: '',
        error: t('ai.missingApiKey', { provider: getProviderLabel(provider.id) })
      }
    }
    if (!settings.apiBaseUrl.trim()) {
      return { text: '', error: t('ai.missingBaseUrl') }
    }

    const url = `${settings.apiBaseUrl.replace(/\/$/, '')}/chat/completions`
    const reasoning = isReasoningModel(settings.model)
    const body: Record<string, unknown> = {
      model: settings.model,
      messages: buildInlineCompletionMessages(request),
      stream: false
    }

    if (reasoning) {
      // gpt-5 / o 系: max_tokens だと推論で枠を使い切り content が空になる
      body.max_completion_tokens = INLINE_COMPLETION_REASONING_MAX_TOKENS
      body.reasoning_effort = 'minimal'
    } else {
      body.max_tokens = INLINE_COMPLETION_MAX_TOKENS
      body.temperature = 0.2
    }

    const doFetch = (payload: Record<string, unknown>): Promise<Response> =>
      fetch(url, {
        method: 'POST',
        headers: buildApiHeaders(settings),
        body: JSON.stringify(payload),
        signal
      })

    let response = await doFetch(body)

    // 一部ゲートウェイは reasoning_effort / max_completion_tokens 未対応
    if (!response.ok && reasoning) {
      const retryBody: Record<string, unknown> = {
        model: settings.model,
        messages: body.messages,
        stream: false,
        max_tokens: INLINE_COMPLETION_REASONING_MAX_TOKENS
      }
      response = await doFetch(retryBody)
      if (!response.ok) {
        const retryError = await response.text()
        return {
          text: '',
          error: t('ai.apiError', { status: response.status, body: retryError })
        }
      }
    } else if (!response.ok) {
      const errorText = await response.text()
      return {
        text: '',
        error: t('ai.apiError', { status: response.status, body: errorText })
      }
    }

    const data = (await response.json()) as {
      choices?: Array<{
        message?: {
          content?: string | Array<{ type?: string; text?: string }>
          reasoning?: unknown
          reasoning_content?: string
        }
        text?: string
        finish_reason?: string
      }>
      usage?: {
        completion_tokens?: number
        completion_tokens_details?: { reasoning_tokens?: number }
      }
      error?: { message?: string }
    }
    if (signal.aborted) return { text: '', cancelled: true }

    if (data.error?.message) {
      return { text: '', error: data.error.message }
    }

    const choice = data.choices?.[0]
    const content = choice?.message?.content
    let raw = ''
    if (typeof content === 'string') {
      raw = content
    } else if (Array.isArray(content)) {
      raw = content.map((part) => (typeof part?.text === 'string' ? part.text : '')).join('')
    } else if (typeof choice?.text === 'string') {
      raw = choice.text
    } else if (typeof choice?.message?.reasoning_content === 'string') {
      // 一部ゲートウェイ互換
      raw = choice.message.reasoning_content
    }

    return { text: sanitizeInlineCompletion(raw) }
  } catch (err) {
    if (isAbortError(err) || signal.aborted) {
      return { text: '', cancelled: true }
    }
    const message = err instanceof Error ? err.message : t('common.unknownError')
    return { text: '', error: message }
  } finally {
    if (activeCompleteAbortController === abortController) {
      activeCompleteAbortController = null
    }
  }
}

export async function streamChat(
  webContents: WebContents,
  request: ChatRequest
): Promise<void> {
  const chatId = request.chatId?.trim() || `anon-${Date.now()}`
  const abortController = acquireChatAbortController(chatId)
  const { signal } = abortController
  const send = (channel: string, ...args: unknown[]) =>
    sendAiEvent(webContents, channel, chatId, ...args)

  try {
    const settings = await getSettings()

    if (signal.aborted) {
      send('ai:aborted')
      return
    }

    const provider = getLlmProvider(settings.providerId)
    if (provider.requiresApiKey && !settings.apiKey) {
      send('ai:error', t('ai.missingApiKey', { provider: getProviderLabel(provider.id) }))
      return
    }

    if (!settings.apiBaseUrl.trim()) {
      send('ai:error', t('ai.missingBaseUrl'))
      return
    }

    const history = request.messages.filter((m) => m.role !== 'system')
    const apiMessages: Array<{ role: string; content: string | ChatContentPart[] }> = [
      { role: 'system', content: getSystemPrompt(request.mode, request.preset) }
    ]

    for (let i = 0; i < history.length - 1; i++) {
      apiMessages.push({ role: history[i].role, content: history[i].content })
    }

    const userPayload = await buildUserMessagePayload(request)
    apiMessages.push({ role: 'user', content: toApiUserContent(userPayload) })

    if (signal.aborted) {
      send('ai:aborted')
      return
    }

    const url = `${settings.apiBaseUrl.replace(/\/$/, '')}/chat/completions`

    const response = await fetch(url, {
      method: 'POST',
      headers: buildApiHeaders(settings),
      body: JSON.stringify({
        model: settings.model,
        messages: apiMessages,
        temperature: settings.temperature,
        max_tokens: settings.maxTokens,
        stream: true
      }),
      signal
    })

    if (!response.ok) {
      const errorText = await response.text()
      send('ai:error', t('ai.apiError', { status: response.status, body: errorText }))
      return
    }

    if (!response.body) {
      send('ai:error', t('ai.noResponseBody'))
      return
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    try {
      while (true) {
        if (signal.aborted) {
          await reader.cancel()
          break
        }

        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed || !trimmed.startsWith('data:')) continue

          const data = trimmed.slice(5).trim()
          if (data === '[DONE]') continue

          try {
            const parsed = JSON.parse(data)
            const content = parsed.choices?.[0]?.delta?.content
            if (content) {
              send('ai:chunk', content)
            }
          } catch {
            // skip malformed SSE chunks
          }
        }
      }
    } catch (err) {
      if (!isAbortError(err) && !signal.aborted) throw err
    }

    if (signal.aborted) {
      send('ai:aborted')
    } else {
      send('ai:done')
    }
  } catch (err) {
    if (isAbortError(err) || signal.aborted) {
      send('ai:aborted')
      return
    }
    const message = err instanceof Error ? err.message : t('common.unknownError')
    send('ai:error', message)
  } finally {
    releaseChatAbortController(chatId, abortController)
  }
}
