/**
 * Open WebUI OpenAI-compat 向けのクライアント互換。
 *
 * 一部バージョンは外部クライアントが chat_id / parent_id を送らないと
 * metadata.chat_id が None のまま .startswith() し、400 を返す:
 *   {"detail":"'NoneType' object has no attribute 'startswith'"}
 *
 * @see https://github.com/open-webui/open-webui/issues/24564
 */

import { LLM_PROVIDERS } from './llm-providers'

function isKnownNonCustomProviderBase(apiBaseUrl: string): boolean {
  const url = apiBaseUrl.trim().replace(/\/+$/, '').toLowerCase()
  if (!url) return false
  for (const provider of LLM_PROVIDERS) {
    if (provider.id === 'custom' || !provider.apiBaseUrl) continue
    const base = provider.apiBaseUrl.replace(/\/+$/, '').toLowerCase()
    if (base && (url === base || url.startsWith(`${base}/`))) {
      return true
    }
  }
  return false
}

/** Open WebUI の OpenAI 互換ベース URL らしいか */
export function isOpenWebUiBaseUrl(apiBaseUrl: string): boolean {
  const trimmed = apiBaseUrl.trim()
  if (!trimmed) return false
  try {
    const url = new URL(trimmed)
    const host = url.hostname.toLowerCase()
    if (host.includes('open-webui')) return true

    // OpenRouter 等の /api/v1 と衝突しないよう既知プロバイダは除外
    if (isKnownNonCustomProviderBase(trimmed)) return false

    const path = url.pathname.replace(/\/+$/, '').toLowerCase() || '/'
    // 既定は http://host:3000/api または .../api/v1
    return path === '/api' || path === '/api/v1'
  } catch {
    return false
  }
}

/**
 * Open WebUI 向けに chat_id / parent_id を付与したボディを返す。
 * 該当しない URL では body をそのまま返す（コピーしない）。
 */
export function withOpenWebUiChatCompat<T extends Record<string, unknown>>(
  body: T,
  apiBaseUrl: string
): T {
  if (!isOpenWebUiBaseUrl(apiBaseUrl)) return body

  const next: T & { chat_id?: string; parent_id?: null } = { ...body }
  if (!('chat_id' in next)) next.chat_id = ''
  // 古い版は parent_id: null 明示で is_new_chat 扱いになる
  if (!('parent_id' in next)) next.parent_id = null
  return next
}
