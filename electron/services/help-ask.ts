import { getLlmProvider, getProviderLabel } from '../../src/utils/llm-providers'
import { t } from '../../src/i18n/runtime'
import type { HelpAskRequest, HelpAskResult, HelpDoc } from '../../src/types'
import { buildApiHeaders } from './ai-client'
import { getSettings } from './settings'
import {
  getHelpDoc,
  listHelpDocs,
  normalizeHelpId,
  searchHelpDocs
} from './help'

const HELP_ASK_MAX_SOURCES = 5
const HELP_ASK_BODY_CHARS = 4500
const HELP_ASK_MAX_TOKENS = 1024

let activeHelpAskAbort: AbortController | null = null

export function cancelHelpAsk(): boolean {
  if (!activeHelpAskAbort) return false
  activeHelpAskAbort.abort()
  activeHelpAskAbort = null
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

function truncateBody(body: string, maxChars: number): string {
  const trimmed = body.trim()
  if (trimmed.length <= maxChars) return trimmed
  return `${trimmed.slice(0, maxChars)}\n…`
}

/** Pure helper: which help page ids to load for an ask. */
export function pickHelpSourceIds(
  hitIds: string[],
  catalogIds: string[],
  currentDocId?: string,
  limit = HELP_ASK_MAX_SOURCES
): string[] {
  const out: string[] = []
  const seen = new Set<string>()

  const push = (id: string | undefined): void => {
    if (!id) return
    const normalized = normalizeHelpId(id)
    if (!normalized || seen.has(normalized)) return
    seen.add(normalized)
    out.push(normalized)
  }

  push(currentDocId)
  for (const id of hitIds) {
    if (out.length >= limit) break
    push(id)
  }
  if (out.length < Math.min(3, limit)) {
    push('index.md')
    for (const id of catalogIds) {
      if (out.length >= limit) break
      push(id)
    }
  }
  return out.slice(0, limit)
}

export async function loadHelpAskSources(
  question: string,
  locale: unknown,
  currentDocId?: string
): Promise<HelpDoc[]> {
  const [hits, catalog] = await Promise.all([
    searchHelpDocs(question, locale, 8),
    listHelpDocs(locale)
  ])
  const ids = pickHelpSourceIds(
    hits.map((hit) => hit.id),
    catalog.map((doc) => doc.id),
    currentDocId
  )
  const sources: HelpDoc[] = []
  for (const id of ids) {
    try {
      sources.push(await getHelpDoc(id, locale))
    } catch {
      // skip missing pages
    }
  }
  return sources
}

function buildHelpAskMessages(question: string, sources: HelpDoc[]): Array<{ role: string; content: string }> {
  const articles = sources
    .map((doc) => {
      const body = truncateBody(doc.body, HELP_ASK_BODY_CHARS)
      return [`### ${doc.id}`, `# ${doc.title}`, body].join('\n')
    })
    .join('\n\n')

  return [
    { role: 'system', content: t('help.aiSystemPrompt') },
    {
      role: 'user',
      content: [
        t('help.aiArticlesHeading'),
        '',
        articles || t('help.aiNoArticles'),
        '',
        t('help.aiQuestionHeading'),
        question.trim()
      ].join('\n')
    }
  ]
}

function collectCommands(sources: HelpDoc[]): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const doc of sources) {
    for (const command of doc.commands) {
      if (seen.has(command)) continue
      seen.add(command)
      out.push(command)
    }
  }
  return out
}

function extractMessageText(data: {
  choices?: Array<{
    message?: {
      content?: string | Array<{ type?: string; text?: string }>
      reasoning_content?: string
    }
    text?: string
  }>
  error?: { message?: string }
}): string {
  if (data.error?.message) {
    throw new Error(data.error.message)
  }
  const choice = data.choices?.[0]
  const content = choice?.message?.content
  if (typeof content === 'string') return content.trim()
  if (Array.isArray(content)) {
    return content.map((part) => (typeof part?.text === 'string' ? part.text : '')).join('').trim()
  }
  if (typeof choice?.text === 'string') return choice.text.trim()
  if (typeof choice?.message?.reasoning_content === 'string') {
    return choice.message.reasoning_content.trim()
  }
  return ''
}

export async function askHelp(request: HelpAskRequest): Promise<HelpAskResult> {
  cancelHelpAsk()
  const abortController = new AbortController()
  activeHelpAskAbort = abortController
  const { signal } = abortController

  try {
    const question = request.question.trim()
    if (!question) {
      return { answer: '', sources: [], commands: [], error: t('help.aiEmptyQuestion') }
    }

    const settings = await getSettings()
    if (signal.aborted) {
      return { answer: '', sources: [], commands: [], cancelled: true }
    }

    const provider = getLlmProvider(settings.providerId)
    if (provider.requiresApiKey && !settings.apiKey) {
      return {
        answer: '',
        sources: [],
        commands: [],
        error: t('ai.missingApiKey', { provider: getProviderLabel(provider.id) })
      }
    }
    if (!settings.apiBaseUrl.trim()) {
      return { answer: '', sources: [], commands: [], error: t('ai.missingBaseUrl') }
    }

    const sources = await loadHelpAskSources(question, request.locale, request.currentDocId)
    if (signal.aborted) {
      return { answer: '', sources: [], commands: [], cancelled: true }
    }

    const url = `${settings.apiBaseUrl.replace(/\/$/, '')}/chat/completions`
    const reasoning = isReasoningModel(settings.model)
    const messages = buildHelpAskMessages(question, sources)
    const body: Record<string, unknown> = {
      model: settings.model,
      messages,
      stream: false
    }
    if (reasoning) {
      // gpt-5 / o 系は temperature 固定のことが多く、0.2 を送ると 400 になる
      body.max_completion_tokens = HELP_ASK_MAX_TOKENS
      body.reasoning_effort = 'minimal'
    } else {
      body.max_tokens = HELP_ASK_MAX_TOKENS
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
    if (!response.ok && reasoning) {
      response = await doFetch({
        model: settings.model,
        messages,
        stream: false,
        max_tokens: HELP_ASK_MAX_TOKENS
      })
    }

    if (signal.aborted) {
      return { answer: '', sources: [], commands: [], cancelled: true }
    }

    if (!response.ok) {
      const errorText = await response.text()
      return {
        answer: '',
        sources: sources.map((doc) => ({ id: doc.id, title: doc.title })),
        commands: collectCommands(sources),
        error: t('ai.apiError', { status: response.status, body: errorText })
      }
    }

    const data = (await response.json()) as Parameters<typeof extractMessageText>[0]
    const answer = extractMessageText(data)
    if (!answer) {
      return {
        answer: '',
        sources: sources.map((doc) => ({ id: doc.id, title: doc.title })),
        commands: collectCommands(sources),
        error: t('help.aiEmptyAnswer')
      }
    }

    return {
      answer,
      sources: sources.map((doc) => ({ id: doc.id, title: doc.title })),
      commands: collectCommands(sources)
    }
  } catch (err) {
    if (signal.aborted || (err instanceof Error && err.name === 'AbortError')) {
      return { answer: '', sources: [], commands: [], cancelled: true }
    }
    return {
      answer: '',
      sources: [],
      commands: [],
      error: err instanceof Error ? err.message : t('help.aiAskFailed')
    }
  } finally {
    if (activeHelpAskAbort === abortController) {
      activeHelpAskAbort = null
    }
  }
}
