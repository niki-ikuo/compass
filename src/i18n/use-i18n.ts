import { useCallback, useSyncExternalStore } from 'react'
import {
  getLocale,
  subscribeLocale,
  t,
  type MessageKey
} from './runtime'
import type { LocaleId } from './types'

type Params = Record<string, string | number>

export function useI18n(): {
  locale: LocaleId
  t: (key: MessageKey, params?: Params) => string
} {
  const locale = useSyncExternalStore(subscribeLocale, getLocale, getLocale)
  const translate = useCallback(
    (key: MessageKey, params?: Params) => t(key, params, locale),
    [locale]
  )
  return { locale, t: translate }
}
