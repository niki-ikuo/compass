import type { WebContents } from 'electron'
import type { ChatRequest } from '../../src/types'
import { t } from '../../src/i18n/runtime'
import { getSettings } from './settings'
import { ensureProjectIndex, getProjectIndexContext } from './project-indexer'
import { resolveChatContext } from './filesystem'
import { getLlmProvider, getProviderLabel } from '../../src/utils/llm-providers'

function getSystemPrompt(mode: ChatRequest['mode']): string {
  return mode === 'ask' ? t('ai.askSystemPrompt') : t('ai.editSystemPrompt')
}

async function buildUserMessage(request: ChatRequest): Promise<string> {
  const parts: string[] = []

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
          const ext = file.relativePath.split('.').pop() ?? ''
          parts.push(`### ${file.relativePath}${file.truncated ? ' (truncated)' : ''}`)
          parts.push('```' + ext)
          parts.push(file.content)
          parts.push('```')
        }
        parts.push('')
      }

      for (const file of resolved.files) {
        const ext = file.relativePath.split('.').pop() ?? ''
        parts.push(
          `${t('ai.fileHeading', { path: file.relativePath })}${file.truncated ? ' (truncated)' : ''}`
        )
        parts.push('```' + ext)
        parts.push(file.content)
        parts.push('```')
        parts.push('')
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

  if (request.mode === 'edit') {
    parts.push(t('ai.editModeReminder'))
    parts.push('')
  }

  const lastUser = [...request.messages].reverse().find((m) => m.role === 'user')
  if (lastUser) {
    parts.push(t('ai.userQuestion'))
    parts.push(lastUser.content)
  }

  return parts.join('\n')
}

let activeAbortController: AbortController | null = null

export function cancelChat(): boolean {
  if (!activeAbortController) return false
  activeAbortController.abort()
  return true
}

function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === 'AbortError'
}

export async function streamChat(
  webContents: WebContents,
  request: ChatRequest
): Promise<void> {
  activeAbortController?.abort()
  const abortController = new AbortController()
  activeAbortController = abortController
  const { signal } = abortController

  try {
    const settings = await getSettings()

    if (signal.aborted) {
      webContents.send('ai:aborted')
      return
    }

    const provider = getLlmProvider(settings.providerId)
    if (provider.requiresApiKey && !settings.apiKey) {
      webContents.send('ai:error', t('ai.missingApiKey', { provider: getProviderLabel(provider.id) }))
      return
    }

    if (!settings.apiBaseUrl.trim()) {
      webContents.send('ai:error', t('ai.missingBaseUrl'))
      return
    }

    const history = request.messages.filter((m) => m.role !== 'system')
    const apiMessages: Array<{ role: string; content: string }> = [
      { role: 'system', content: getSystemPrompt(request.mode) }
    ]

    for (let i = 0; i < history.length - 1; i++) {
      apiMessages.push({ role: history[i].role, content: history[i].content })
    }

    apiMessages.push({ role: 'user', content: await buildUserMessage(request) })

    if (signal.aborted) {
      webContents.send('ai:aborted')
      return
    }

    const url = `${settings.apiBaseUrl.replace(/\/$/, '')}/chat/completions`
    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    }
    if (settings.apiKey) {
      headers.Authorization = `Bearer ${settings.apiKey}`
    }
    // OpenRouter 推奨ヘッダ（未設定でも動作するが、ランキング表示などに利用される）
    if (settings.providerId === 'openrouter') {
      headers['HTTP-Referer'] = 'https://github.com/compass-editor'
      headers['X-Title'] = 'Compass'
    }

    const response = await fetch(url, {
      method: 'POST',
      headers,
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
      webContents.send(
        'ai:error',
        t('ai.apiError', { status: response.status, body: errorText })
      )
      return
    }

    if (!response.body) {
      webContents.send('ai:error', t('ai.noResponseBody'))
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
              webContents.send('ai:chunk', content)
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
      webContents.send('ai:aborted')
    } else {
      webContents.send('ai:done')
    }
  } catch (err) {
    if (isAbortError(err) || signal.aborted) {
      webContents.send('ai:aborted')
      return
    }
    const message = err instanceof Error ? err.message : t('common.unknownError')
    webContents.send('ai:error', message)
  } finally {
    if (activeAbortController === abortController) {
      activeAbortController = null
    }
  }
}
