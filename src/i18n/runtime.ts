import { messages, type MessageKey } from './messages'
import { DEFAULT_LOCALE, isLocaleId, toBcp47, type LocaleId } from './types'

export type { LocaleId, MessageKey }
export { DEFAULT_LOCALE, LOCALE_OPTIONS, isLocaleId, toBcp47 } from './types'

type Params = Record<string, string | number>

let currentLocale: LocaleId = DEFAULT_LOCALE
const listeners = new Set<() => void>()

function emit(): void {
  listeners.forEach((listener) => listener())
}

export function getLocale(): LocaleId {
  return currentLocale
}

export function setLocale(locale: LocaleId): void {
  if (!isLocaleId(locale) || locale === currentLocale) return
  currentLocale = locale
  if (typeof document !== 'undefined') {
    document.documentElement.lang = locale
  }
  emit()
}

export function subscribeLocale(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function interpolate(template: string, params?: Params): string {
  if (!params) return template
  return template.replace(/\{(\w+)\}/g, (_, key: string) =>
    params[key] !== undefined ? String(params[key]) : `{${key}}`
  )
}

export function t(key: MessageKey, params?: Params, locale: LocaleId = currentLocale): string {
  const dict = messages[locale] ?? messages[DEFAULT_LOCALE]
  const fallback = messages[DEFAULT_LOCALE]
  return interpolate(dict[key] ?? fallback[key] ?? key, params)
}

export function getDateLocale(locale: LocaleId = currentLocale): string {
  return toBcp47(locale)
}

/** 既定チャットタイトル（全ロケール）かどうか */
export function isDefaultChatTitle(title: string): boolean {
  return title === messages.ja['chat.newChat'] || title === messages.en['chat.newChat']
}
