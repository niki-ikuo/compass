import type { AppSettings } from '../../src/types'
import { getLlmProvider, getProviderLabel } from '../../src/utils/llm-providers'
import { withOpenWebUiChatCompat } from '../../src/utils/open-webui-compat'
import { t } from '../../src/i18n/runtime'
import { buildApiHeaders } from './ai-client'
import { getSettings } from './settings'

export type LlmConnectionCode =
  | 'apiKey'
  | 'baseUrl'
  | 'model'
  | 'auth'
  | 'network'
  | 'modelMissing'
  | 'http'
  | 'unknown'

export interface LlmConnectionTestResult {
  ok: boolean
  /** incomplete | checking is renderer-only; main returns connected | error | incomplete */
  status: 'incomplete' | 'connected' | 'error'
  error?: string
  code?: LlmConnectionCode
  method?: 'models' | 'chat'
}

const TEST_TIMEOUT_MS = 15_000

let activeTestAbort: AbortController | null = null

export function cancelLlmConnectionTest(): boolean {
  if (!activeTestAbort) return false
  activeTestAbort.abort()
  activeTestAbort = null
  return true
}

function isReasoningModel(model: string): boolean {
  const m = model.toLowerCase()
  return (
    m.startsWith('o1') ||
    m.startsWith('o3') ||
    m.startsWith('o4') ||
    m.startsWith('gpt-5') ||
    m.includes('gpt-5') ||
    m.includes('reason')
  )
}

function validateSettings(settings: AppSettings): LlmConnectionTestResult | null {
  if (!settings.model.trim()) {
    return { ok: false, status: 'incomplete', code: 'model', error: t('status.modelUnset') }
  }
  if (!settings.apiBaseUrl.trim()) {
    return { ok: false, status: 'incomplete', code: 'baseUrl', error: t('status.baseUrlUnset') }
  }
  const provider = getLlmProvider(settings.providerId)
  if (provider.requiresApiKey && !settings.apiKey.trim()) {
    return {
      ok: false,
      status: 'incomplete',
      code: 'apiKey',
      error: t('ai.missingApiKey', { provider: getProviderLabel(provider.id) })
    }
  }
  return null
}

export function modelIdMatches(listedIds: string[], model: string): boolean {
  const target = model.trim()
  if (!target) return false
  const lower = target.toLowerCase()
  for (const id of listedIds) {
    if (id === target) return true
    if (id.toLowerCase() === lower) return true
    const leaf = id.split('/').pop()
    if (leaf && (leaf === target || leaf.toLowerCase() === lower)) return true
  }
  return false
}

function classifyHttpError(status: number, body: string): Pick<LlmConnectionTestResult, 'code' | 'error'> {
  if (status === 401 || status === 403) {
    return { code: 'auth', error: t('ai.apiError', { status, body }) }
  }
  const lower = body.toLowerCase()
  if (
    status === 404 ||
    lower.includes('model') && (lower.includes('not found') || lower.includes('does not exist') || lower.includes('invalid'))
  ) {
    return { code: 'modelMissing', error: t('status.modelMissing', { model: '' }) || body }
  }
  return { code: 'http', error: t('ai.apiError', { status, body }) }
}

async function fetchModels(
  settings: AppSettings,
  signal: AbortSignal
): Promise<{ ok: true; ids: string[] } | { ok: false; status: number; body: string } | { ok: false; network: true; message: string }> {
  const url = `${settings.apiBaseUrl.replace(/\/$/, '')}/models`
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: buildApiHeaders(settings),
      signal
    })
    const body = await response.text()
    if (!response.ok) {
      return { ok: false, status: response.status, body }
    }
    try {
      const data = JSON.parse(body) as { data?: Array<{ id?: string }> }
      const ids = (data.data ?? [])
        .map((item) => (typeof item?.id === 'string' ? item.id : ''))
        .filter(Boolean)
      return { ok: true, ids }
    } catch {
      return { ok: false, status: response.status, body: body.slice(0, 500) }
    }
  } catch (err) {
    if (signal.aborted) throw err
    return {
      ok: false,
      network: true,
      message: err instanceof Error ? err.message : t('status.connectionFailed')
    }
  }
}

async function probeChat(
  settings: AppSettings,
  signal: AbortSignal
): Promise<{ ok: true } | { ok: false; status?: number; body?: string; network?: boolean; message?: string }> {
  const url = `${settings.apiBaseUrl.replace(/\/$/, '')}/chat/completions`
  const reasoning = isReasoningModel(settings.model)
  const payload: Record<string, unknown> = {
    model: settings.model,
    messages: [{ role: 'user', content: 'ping' }],
    stream: false
  }
  if (reasoning) {
    payload.max_completion_tokens = 1
  } else {
    payload.max_tokens = 1
    payload.temperature = 0
  }

  try {
    let response = await fetch(url, {
      method: 'POST',
      headers: buildApiHeaders(settings),
      body: JSON.stringify(withOpenWebUiChatCompat(payload, settings.apiBaseUrl)),
      signal
    })
    if (!response.ok && reasoning) {
      response = await fetch(url, {
        method: 'POST',
        headers: buildApiHeaders(settings),
        body: JSON.stringify(
          withOpenWebUiChatCompat(
            {
              model: settings.model,
              messages: payload.messages,
              stream: false,
              max_tokens: 1
            },
            settings.apiBaseUrl
          )
        ),
        signal
      })
    }
    const body = await response.text()
    if (!response.ok) {
      return { ok: false, status: response.status, body }
    }
    return { ok: true }
  } catch (err) {
    if (signal.aborted) throw err
    return {
      ok: false,
      network: true,
      message: err instanceof Error ? err.message : t('status.connectionFailed')
    }
  }
}

/**
 * Verify LLM settings against the live endpoint.
 * Prefer GET /models (and require the configured model when the list is non-empty),
 * then fall back to a minimal chat/completions probe.
 */
export async function testLlmConnection(
  settingsOverride?: AppSettings
): Promise<LlmConnectionTestResult> {
  cancelLlmConnectionTest()
  const abortController = new AbortController()
  activeTestAbort = abortController
  const timeout = setTimeout(() => abortController.abort(), TEST_TIMEOUT_MS)

  try {
    const settings = settingsOverride ?? (await getSettings())
    const incomplete = validateSettings(settings)
    if (incomplete) return incomplete

    const { signal } = abortController
    const modelsResult = await fetchModels(settings, signal)

    if ('network' in modelsResult && modelsResult.network) {
      // /models が死んでいても chat だけ動くゲートウェイがあるので chat を試す
      const chat = await probeChat(settings, signal)
      if (chat.ok) return { ok: true, status: 'connected', method: 'chat' }
      if (chat.network) {
        return {
          ok: false,
          status: 'error',
          code: 'network',
          error: chat.message || modelsResult.message
        }
      }
      const classified = classifyHttpError(chat.status ?? 0, chat.body ?? '')
      return {
        ok: false,
        status: 'error',
        code: classified.code,
        error:
          classified.code === 'modelMissing'
            ? t('status.modelMissing', { model: settings.model })
            : classified.error
      }
    }

    if (modelsResult.ok) {
      if (modelsResult.ids.length === 0 || modelIdMatches(modelsResult.ids, settings.model)) {
        if (modelsResult.ids.length > 0 && modelIdMatches(modelsResult.ids, settings.model)) {
          return { ok: true, status: 'connected', method: 'models' }
        }
        // 空リストは信用せず chat で確認
        const chat = await probeChat(settings, signal)
        if (chat.ok) return { ok: true, status: 'connected', method: 'chat' }
        if (chat.network) {
          return { ok: false, status: 'error', code: 'network', error: chat.message }
        }
        const classified = classifyHttpError(chat.status ?? 0, chat.body ?? '')
        return {
          ok: false,
          status: 'error',
          code: classified.code === 'modelMissing' ? 'modelMissing' : classified.code,
          error:
            classified.code === 'modelMissing'
              ? t('status.modelMissing', { model: settings.model })
              : classified.error
        }
      }

      // リストにあるが一致しない → 念のため chat（不完全な一覧対策）。失敗なら modelMissing
      const chat = await probeChat(settings, signal)
      if (chat.ok) return { ok: true, status: 'connected', method: 'chat' }
      return {
        ok: false,
        status: 'error',
        code: 'modelMissing',
        error: t('status.modelMissing', { model: settings.model })
      }
    }

    // /models HTTP error
    if (!modelsResult.ok && 'status' in modelsResult) {
      if (modelsResult.status === 401 || modelsResult.status === 403) {
        return {
          ok: false,
          status: 'error',
          code: 'auth',
          error: t('ai.apiError', { status: modelsResult.status, body: modelsResult.body })
        }
      }
      // 404 などは chat へフォールバック
      const chat = await probeChat(settings, signal)
      if (chat.ok) return { ok: true, status: 'connected', method: 'chat' }
      if (chat.network) {
        return { ok: false, status: 'error', code: 'network', error: chat.message }
      }
      const classified = classifyHttpError(chat.status ?? 0, chat.body ?? '')
      return {
        ok: false,
        status: 'error',
        code: classified.code,
        error:
          classified.code === 'modelMissing'
            ? t('status.modelMissing', { model: settings.model })
            : classified.error
      }
    }

    return { ok: false, status: 'error', code: 'unknown', error: t('status.connectionFailed') }
  } catch (err) {
    if (abortController.signal.aborted) {
      return { ok: false, status: 'error', code: 'network', error: t('status.connectionTimeout') }
    }
    return {
      ok: false,
      status: 'error',
      code: 'unknown',
      error: err instanceof Error ? err.message : t('status.connectionFailed')
    }
  } finally {
    clearTimeout(timeout)
    if (activeTestAbort === abortController) {
      activeTestAbort = null
    }
  }
}
