import type { WebContents } from 'electron'
import type { ChatRequest } from '../../src/types'
import { getSettings } from './settings'
import { ensureProjectIndex, getProjectIndexContext } from './project-indexer'
import { resolveChatContext } from './filesystem'

const EDIT_SYSTEM_PROMPT =
  'あなたはコーディングアシスタントです。日本語で回答してください。Editモードでは、ファイル/フォルダの作成・変更・削除は必ず```compass-actions```コードブロック内のJSONだけで返してください。通常の```css```や```html```などのコードブロックでファイル全体を提示してはいけません。説明文は短くし、実際の変更内容はcompass-actionsに含めてください。形式は {"actions":[{"type":"mkdir","path":"relative/path"},{"type":"writeFile","path":"relative/file.ts","content":"..."},{"type":"deleteFile","path":"relative/file.ts"},{"type":"deleteDir","path":"relative/folder"}]} とし、pathはワークスペース直下からの相対パス（例: style.css。フォルダ名を重複して含めない）のみ使用してください。プロジェクト構造インデックス(.compass)が提供された場合は、ファイル間の関係を踏まえて回答してください。'

const ASK_SYSTEM_PROMPT =
  'あなたはコーディングアシスタントです。日本語で回答してください。現在はAskモードです。コードの説明、質問への回答、調査、レビューのみを行い、ワークスペースへのファイル作成・変更・削除は行わないでください。```compass-actions```コードブロックは絶対に出力しないでください。コード例は通常の```コードブロックで示し、ユーザーが手動で適用できるようにしてください。プロジェクト構造インデックス(.compass)が提供された場合は、ファイル間の関係を踏まえて回答してください。'

function getSystemPrompt(mode: ChatRequest['mode']): string {
  return mode === 'ask' ? ASK_SYSTEM_PROMPT : EDIT_SYSTEM_PROMPT
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
      parts.push('[ユーザーが指定したファイル/フォルダ]')
      parts.push('以下はエクスプローラーから明示的に指定されたコンテキストです。')

      for (const folder of resolved.folders) {
        parts.push(`## フォルダ: ${folder.relativePath}`)
        parts.push('### 構造')
        for (const filePath of folder.structure.slice(0, 40)) {
          parts.push(`- ${filePath}`)
        }
        if (folder.truncated) parts.push('- ... (省略)')
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
        parts.push(`## ファイル: ${file.relativePath}${file.truncated ? ' (truncated)' : ''}`)
        parts.push('```' + ext)
        parts.push(file.content)
        parts.push('```')
        parts.push('')
      }
    }
  }

  if (request.context?.filePath && request.context.fileContent !== undefined) {
    const ext = request.context.filePath.split('.').pop() ?? ''
    parts.push(`[現在のファイル: ${request.context.filePath}]`)
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
    parts.push('[ユーザーが指定した選択行]')
    for (const sel of selections) {
      const range =
        sel.startLine > 0
          ? sel.startLine === sel.endLine
            ? `:${sel.startLine}`
            : `:${sel.startLine}-${sel.endLine}`
          : ''
      const label = sel.path ? `${sel.path}${range}` : '選択テキスト'
      const ext = sel.path.split('.').pop() ?? ''
      parts.push(`## ${label}`)
      parts.push('```' + ext)
      parts.push(sel.text)
      parts.push('```')
      parts.push('')
    }
  }

  if (request.mode === 'edit') {
    parts.push(
      '[Editモード] ファイル変更は通常のコードブロックではなく、必ず```compass-actions```のJSONのみで返してください。'
    )
    parts.push('')
  }

  const lastUser = [...request.messages].reverse().find((m) => m.role === 'user')
  if (lastUser) {
    parts.push('[ユーザーの質問]')
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

    if (!settings.apiKey) {
      webContents.send('ai:error', 'APIキーが設定されていません。設定画面から入力してください。')
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

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${settings.apiKey}`
      },
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
      webContents.send('ai:error', `APIエラー (${response.status}): ${errorText}`)
      return
    }

    if (!response.body) {
      webContents.send('ai:error', 'レスポンスボディがありません')
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
    const message = err instanceof Error ? err.message : '不明なエラー'
    webContents.send('ai:error', message)
  } finally {
    if (activeAbortController === abortController) {
      activeAbortController = null
    }
  }
}
