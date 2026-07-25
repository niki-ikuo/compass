/**
 * Make JS strings safe for UTF-8 JSON APIs (LiteLLM / Azure / Python).
 * Lone UTF-16 surrogates survive JSON.stringify as \udxxx, then fail on encode.
 */

const LONE_SURROGATE_RE =
  /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g

export function sanitizeUtf8Text(text: string): string {
  if (!text) return text
  return text.replace(LONE_SURROGATE_RE, '\uFFFD')
}

/** UTF-16-safe slice that does not split surrogate pairs. */
export function sliceUtf16Safe(text: string, start: number, end: number = text.length): string {
  let from = Math.max(0, start)
  let to = Math.min(text.length, end)
  if (from >= to) return ''

  // start on a low surrogate → skip it
  if (from > 0 && from < text.length) {
    const c = text.charCodeAt(from)
    if (c >= 0xdc00 && c <= 0xdfff) from += 1
  }

  // end right after a high surrogate (pair would be split) → back up
  if (to > 0 && to < text.length) {
    const prev = text.charCodeAt(to - 1)
    if (prev >= 0xd800 && prev <= 0xdbff) to -= 1
  }

  if (from >= to) return ''
  return text.slice(from, to)
}

/** JSON.stringify that replaces lone surrogates in every string value. */
export function jsonStringifyUtf8Safe(value: unknown): string {
  return JSON.stringify(value, (_key, v) => (typeof v === 'string' ? sanitizeUtf8Text(v) : v))
}
