/**
 * Open WebUI OpenAI-compat 向けのクライアント互換。
 *
 * 一部の古い Open WebUI は chat_id / parent_id が無いと
 * metadata.chat_id が None のまま .startswith() し 400 になる。
 * 一方で Open WebUI → LiteLLM → Azure は未知パラメータ `chat_id` を拒否する。
 * 付与は設定の opt-in（openWebUiChatCompat）のみ。
 *
 * @see https://github.com/open-webui/open-webui/issues/24564
 */

/**
 * enabled のときだけ chat_id / parent_id を付与したボディを返す。
 * オフ、または既に付いている場合は body をそのまま返す（コピーしない）。
 */
export function withOpenWebUiChatCompat<T extends Record<string, unknown>>(
  body: T,
  enabled: boolean
): T {
  if (!enabled) return body

  const next: T & { chat_id?: string; parent_id?: null } = { ...body }
  if (!('chat_id' in next)) next.chat_id = ''
  // 古い版は parent_id: null 明示で is_new_chat 扱いになる
  if (!('parent_id' in next)) next.parent_id = null
  return next
}
