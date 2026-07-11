export type LocaleId = 'ja' | 'en'

export interface LocaleOption {
  id: LocaleId
  /** 言語名は各言語の自称で固定表示 */
  nativeLabel: string
}

export const LOCALE_OPTIONS: LocaleOption[] = [
  { id: 'ja', nativeLabel: '日本語' },
  { id: 'en', nativeLabel: 'English' }
]

export const DEFAULT_LOCALE: LocaleId = 'en'

export function isLocaleId(value: unknown): value is LocaleId {
  return value === 'ja' || value === 'en'
}

export function toBcp47(locale: LocaleId): string {
  return locale === 'ja' ? 'ja-JP' : 'en-US'
}
