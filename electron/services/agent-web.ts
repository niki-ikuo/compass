import { assertSafeApiBaseUrl } from './path-guard'
import { redactSecrets } from '../../src/utils/redact'

const MAX_FETCH_CHARS = 80_000
const FETCH_TIMEOUT_MS = 15_000
const SEARCH_TIMEOUT_MS = 12_000
const MAX_SEARCH_HITS = 8

export function assertSafePublicHttpUrl(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) {
    throw new Error('url is required')
  }
  return assertSafeApiBaseUrl(trimmed)
}

function withTimeout(signal: AbortSignal | undefined, ms: number): AbortSignal {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), ms)
  const onAbort = () => {
    clearTimeout(timer)
    ctrl.abort()
  }
  if (signal) {
    if (signal.aborted) {
      clearTimeout(timer)
      ctrl.abort()
    } else {
      signal.addEventListener('abort', onAbort, { once: true })
    }
  }
  ctrl.signal.addEventListener(
    'abort',
    () => {
      clearTimeout(timer)
      if (signal) signal.removeEventListener('abort', onAbort)
    },
    { once: true }
  )
  return ctrl.signal
}

export async function fetchPublicUrl(
  url: string,
  signal?: AbortSignal
): Promise<{ ok: boolean; summary: string; content: string }> {
  let safe: string
  try {
    safe = assertSafePublicHttpUrl(url)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, summary: message, content: `Error: ${message}` }
  }

  try {
    const response = await fetch(safe, {
      method: 'GET',
      redirect: 'follow',
      signal: withTimeout(signal, FETCH_TIMEOUT_MS),
      headers: { 'User-Agent': 'CompassAgent/1.0 (read-only fetchUrl)' }
    })
    const raw = await response.text()
    const redacted = redactSecrets(raw)
    const truncated = redacted.length > MAX_FETCH_CHARS
    const body = truncated ? `${redacted.slice(0, MAX_FETCH_CHARS)}\n…(truncated)` : redacted
    return {
      ok: response.ok,
      summary: `GET ${response.status} ${safe}`,
      content: `# fetchUrl ${safe}\nstatus: ${response.status}\n\n${body}`
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, summary: message, content: `Error: ${message}` }
  }
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
}

function parseDuckDuckGoHits(html: string): Array<{ title: string; url: string; snippet: string }> {
  const hits: Array<{ title: string; url: string; snippet: string }> = []
  const resultRe =
    /class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi
  let match: RegExpExecArray | null
  while ((match = resultRe.exec(html)) !== null && hits.length < MAX_SEARCH_HITS) {
    const url = decodeHtmlEntities(match[1])
    const title = decodeHtmlEntities(match[2].replace(/<[^>]+>/g, '')).trim()
    const snippet = decodeHtmlEntities(match[3].replace(/<[^>]+>/g, '')).trim()
    if (url.startsWith('http')) {
      hits.push({ title: title || url, url, snippet })
    }
  }
  if (hits.length > 0) return hits

  const uddg = /uddg=([^&"]+)/g
  const seen = new Set<string>()
  let m: RegExpExecArray | null
  while ((m = uddg.exec(html)) !== null && hits.length < MAX_SEARCH_HITS) {
    try {
      const url = decodeURIComponent(m[1])
      if (!url.startsWith('http') || seen.has(url)) continue
      seen.add(url)
      hits.push({ title: url, url, snippet: '' })
    } catch {
      // skip bad encoding
    }
  }
  return hits
}

export async function searchWeb(
  query: string,
  signal?: AbortSignal
): Promise<{ ok: boolean; summary: string; content: string }> {
  const q = query.trim()
  if (!q) {
    return { ok: false, summary: 'query is required', content: 'Error: query is required' }
  }
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`
  try {
    const response = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: withTimeout(signal, SEARCH_TIMEOUT_MS),
      headers: {
        'User-Agent': 'CompassAgent/1.0 (read-only webSearch)',
        Accept: 'text/html'
      }
    })
    const html = await response.text()
    const hits = parseDuckDuckGoHits(html)
    if (hits.length === 0) {
      return {
        ok: response.ok,
        summary: 'no search hits',
        content: `# webSearch ${q}\nNo hits parsed. Try fetchUrl with a known documentation URL.`
      }
    }
    const lines = [`# webSearch ${q}`, ...hits.map((h) => `- ${h.title}\n  ${h.url}\n  ${h.snippet}`)]
    return {
      ok: true,
      summary: `${hits.length} hit(s)`,
      content: redactSecrets(lines.join('\n'))
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, summary: message, content: `Error: ${message}` }
  }
}
