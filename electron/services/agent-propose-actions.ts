/**
 * proposeActions の引数パース／回復（LLM が actions を文字列化するケース向け）。
 */

export function buildJsonParseAttempts(raw: string): string[] {
  const trimmed = raw.trim()
  const attempts: string[] = []
  const pushUnique = (value: string) => {
    const v = value.trim()
    if (!v || attempts.includes(v)) return
    attempts.push(v)
  }

  pushUnique(trimmed)

  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fence?.[1]) pushUnique(fence[1])

  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  if (start >= 0 && end > start) {
    pushUnique(trimmed.slice(start, end + 1))
  }

  const arrayStart = trimmed.indexOf('[')
  const arrayEnd = trimmed.lastIndexOf(']')
  if (arrayStart >= 0 && arrayEnd > arrayStart) {
    pushUnique(trimmed.slice(arrayStart, arrayEnd + 1))
  }

  return attempts
}

export function tryParseJsonValue(raw: string): unknown | undefined {
  for (const attempt of buildJsonParseAttempts(raw)) {
    try {
      let parsed: unknown = JSON.parse(attempt)
      // 二重エンコード: "\"{...}\"" → object
      if (typeof parsed === 'string') {
        try {
          parsed = JSON.parse(parsed)
        } catch {
          // keep string
        }
      }
      return parsed
    } catch {
      // try next
    }
  }
  return undefined
}

export function parseToolArgs(raw: string): Record<string, unknown> {
  if (!raw.trim()) return {}
  const parsed = tryParseJsonValue(raw)
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    return parsed as Record<string, unknown>
  }
  return { _raw: raw }
}

/**
 * LLM が actions を文字列化したり、壊れた JSON を _raw に落とした場合の回復。
 */
export function coerceProposeActionsArgs(args: Record<string, unknown>): Record<string, unknown> {
  if (Array.isArray(args.actions) && args.actions.length > 0) {
    return args
  }

  const tryFromUnknown = (value: unknown): Record<string, unknown> | null => {
    if (Array.isArray(value) && value.length > 0) {
      return { actions: value }
    }
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const obj = value as Record<string, unknown>
      if (Array.isArray(obj.actions) && obj.actions.length > 0) {
        return obj
      }
      if (typeof obj.actions === 'string') {
        const nested = tryParseJsonValue(obj.actions)
        if (Array.isArray(nested) && nested.length > 0) {
          return { ...obj, actions: nested }
        }
      }
    }
    if (typeof value === 'string') {
      const nested = tryParseJsonValue(value)
      return nested === undefined ? null : tryFromUnknown(nested)
    }
    return null
  }

  if ('actions' in args) {
    const recovered = tryFromUnknown(args.actions)
    if (recovered) return recovered
  }

  if (typeof args._raw === 'string') {
    const recovered = tryFromUnknown(args._raw)
    if (recovered) return recovered
  }

  for (const value of Object.values(args)) {
    if (typeof value !== 'string') continue
    if (!value.includes('actions') && !value.includes('writeFile')) continue
    const recovered = tryFromUnknown(value)
    if (recovered) return recovered
  }

  return args
}
