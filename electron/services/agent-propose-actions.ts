/**
 * proposeActions の引数パース／回復（LLM が actions を文字列化するケース向け）。
 */

const ACTION_TYPES = new Set(['writeFile', 'mkdir', 'deleteFile', 'deleteDir'])

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

/**
 * JSON 文字列リテラル内を補正する。
 * - 未エスケープの制御文字をエスケープ
 * - 不正な `\'` などを JSON として合法な形へ書き換え（LLM のよくあるミス）
 */
export function escapeControlCharsInJsonStrings(raw: string): string {
  let out = ''
  let inString = false
  let escape = false

  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i]
    if (!inString) {
      out += ch
      if (ch === '"') inString = true
      continue
    }

    if (escape) {
      escape = false
      // JSON で合法: " \ / b f n r t uXXXX
      if (
        ch === '"' ||
        ch === '\\' ||
        ch === '/' ||
        ch === 'b' ||
        ch === 'f' ||
        ch === 'n' ||
        ch === 'r' ||
        ch === 't' ||
        ch === 'u'
      ) {
        out += '\\'
        out += ch
        continue
      }
      if (ch === "'") {
        // \' → '（シングルクオートの過剰エスケープ）
        out += "'"
        continue
      }
      // その他の不正エスケープはバックスラッシュをリテラルとして残す
      out += '\\\\'
      out += ch
      continue
    }

    if (ch === '\\') {
      escape = true
      continue
    }

    if (ch === '"') {
      out += ch
      inString = false
      continue
    }

    if (ch === '\n') {
      out += '\\n'
      continue
    }
    if (ch === '\r') {
      out += '\\r'
      continue
    }
    if (ch === '\t') {
      out += '\\t'
      continue
    }
    if (ch.charCodeAt(0) < 0x20) {
      out += `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`
      continue
    }

    out += ch
  }

  // 末尾が単独の \ で終わっている場合は後段の closeTruncatedJson に委ねる
  if (escape) out += '\\'

  return out
}

interface JsonScanState {
  inString: boolean
  escape: boolean
  /** `\uXXXX` の残り桁。0 なら未着手。 */
  unicodeRemaining: number
  stack: string[]
}

function scanJsonStructure(raw: string): JsonScanState {
  let inString = false
  let escape = false
  let unicodeRemaining = 0
  const stack: string[] = []

  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i]
    if (inString) {
      if (unicodeRemaining > 0) {
        if (/[0-9a-fA-F]/.test(ch)) {
          unicodeRemaining--
        } else {
          // 不正な \u シーケンス — 残り期待を捨ててこの文字を通常処理
          unicodeRemaining = 0
          i--
        }
        continue
      }
      if (escape) {
        escape = false
        if (ch === 'u') unicodeRemaining = 4
        continue
      }
      if (ch === '\\') {
        escape = true
        continue
      }
      if (ch === '"') inString = false
      continue
    }

    if (ch === '"') {
      inString = true
      continue
    }
    if (ch === '{') stack.push('}')
    else if (ch === '[') stack.push(']')
    else if (ch === '}' || ch === ']') {
      if (stack.length > 0 && stack[stack.length - 1] === ch) stack.pop()
    }
  }

  return { inString, escape, unicodeRemaining, stack }
}

/** 括弧／文字列が閉じ切っていない（トークン上限で途中切れしやすい）JSON かどうか。 */
export function isIncompleteJson(raw: string): boolean {
  const trimmed = raw.trim()
  if (!trimmed) return false
  const { inString, escape, unicodeRemaining, stack } = scanJsonStructure(trimmed)
  return inString || escape || unicodeRemaining > 0 || stack.length > 0
}

/** 末尾が切れた JSON を閉じ括弧／引用符で補完する（ベストエフォート）。 */
export function closeTruncatedJson(raw: string): string {
  const { inString, escape, unicodeRemaining, stack } = scanJsonStructure(raw)

  let result = raw
  if (inString) {
    // トークン限界などでエスケープの途中で切れることが多い
    if (escape) {
      result = result.slice(0, -1)
    } else if (unicodeRemaining > 0) {
      const partialHex = 4 - unicodeRemaining
      result = result.slice(0, -(2 + partialHex))
    }
    result += '"'
  }
  result = result.replace(/,\s*$/, '')
  // 途中で切れたキー（`"content":` のあと値なし）は null で埋める
  if (/:\s*$/.test(result)) result += 'null'
  const closers = [...stack]
  while (closers.length > 0) result += closers.pop()
  return result
}

function actionsIncludeWriteFile(actions: unknown[]): boolean {
  return actions.some(
    (item) =>
      !!item &&
      typeof item === 'object' &&
      !Array.isArray(item) &&
      (item as { type?: unknown }).type === 'writeFile'
  )
}

function safeJsonParse(raw: string): unknown | undefined {
  try {
    return JSON.parse(raw)
  } catch {
    return undefined
  }
}

function parseWithRepair(raw: string, options?: { closeTruncated?: boolean }): unknown | undefined {
  const direct = safeJsonParse(raw)
  if (direct !== undefined) return direct

  const escaped = escapeControlCharsInJsonStrings(raw)
  const escapedParsed = safeJsonParse(escaped)
  if (escapedParsed !== undefined) return escapedParsed

  if (options?.closeTruncated) {
    for (const candidate of [raw, escaped]) {
      const closed = closeTruncatedJson(candidate)
      const parsed = safeJsonParse(closed)
      if (parsed !== undefined) return parsed
    }
  }

  return undefined
}

export function isActionLike(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const obj = value as Record<string, unknown>
  return (
    typeof obj.type === 'string' &&
    ACTION_TYPES.has(obj.type) &&
    typeof obj.path === 'string' &&
    obj.path.trim().length > 0
  )
}

function asActionsArray(value: unknown): unknown[] | null {
  if (Array.isArray(value) && value.length > 0) {
    return value
  }
  if (isActionLike(value)) {
    return [value]
  }
  return null
}

/** 破損／途中切れテキストから完結した action オブジェクトだけを抜き出す。 */
export function extractCompleteActions(text: string): unknown[] {
  const actions: unknown[] = []
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== '{') continue

    let depth = 0
    let inString = false
    let escape = false
    for (let j = i; j < text.length; j++) {
      const ch = text[j]
      if (inString) {
        if (escape) {
          escape = false
          continue
        }
        if (ch === '\\') {
          escape = true
          continue
        }
        if (ch === '"') inString = false
        continue
      }

      if (ch === '"') {
        inString = true
        continue
      }
      if (ch === '{') depth++
      else if (ch === '}') {
        depth--
        if (depth === 0) {
          const slice = text.slice(i, j + 1)
          for (const candidate of [slice, escapeControlCharsInJsonStrings(slice)]) {
            const parsed = safeJsonParse(candidate)
            if (isActionLike(parsed)) {
              actions.push(parsed)
              break
            }
          }
          i = j
          break
        }
      }
    }
  }
  return actions
}

export function tryParseJsonValue(
  raw: string,
  options?: { closeTruncated?: boolean }
): unknown | undefined {
  for (const attempt of buildJsonParseAttempts(raw)) {
    let parsed = parseWithRepair(attempt, options)
    if (parsed === undefined) continue

    // 二重エンコード: "\"{...}\"" → object
    if (typeof parsed === 'string') {
      const nested = parseWithRepair(parsed, options)
      if (nested !== undefined) parsed = nested
    }
    return parsed
  }
  return undefined
}

export function parseToolArgs(raw: string): Record<string, unknown> {
  if (!raw.trim()) return {}
  const parsed = tryParseJsonValue(raw)
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    return parsed as Record<string, unknown>
  }
  const asActions = asActionsArray(parsed)
  if (asActions) {
    return { actions: asActions }
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
    const direct = asActionsArray(value)
    if (direct) return { actions: direct }

    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const obj = value as Record<string, unknown>
      const fromActions = asActionsArray(obj.actions)
      if (fromActions) {
        return { ...obj, actions: fromActions }
      }
      if (typeof obj.actions === 'string') {
        const nested = tryParseJsonValue(obj.actions)
        const nestedActions = asActionsArray(nested)
        if (nestedActions) return { ...obj, actions: nestedActions }
        if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
          const inner = asActionsArray((nested as Record<string, unknown>).actions)
          if (inner) return { ...obj, actions: inner }
        }
        const extracted = extractCompleteActions(obj.actions)
        if (extracted.length > 0) return { ...obj, actions: extracted }
      }
    }

    if (typeof value === 'string') {
      const nested = tryParseJsonValue(value)
      if (nested !== undefined) {
        const fromNested = tryFromUnknown(nested)
        if (fromNested) return fromNested
      }
      // 途中切れでも完結した action だけ先に拾う（不完全な末尾 writeFile は捨てる）
      const extracted = extractCompleteActions(value)
      if (extracted.length > 0) return { actions: extracted }

      // mkdir/delete など content なし action の途中切れのみ閉じ補完する。
      // writeFile の content 途中切れを閉じると不完全プレビューになるため拒否する。
      const closed = tryParseJsonValue(value, { closeTruncated: true })
      if (closed !== undefined) {
        const fromClosed = tryFromUnknown(closed)
        if (
          fromClosed &&
          Array.isArray(fromClosed.actions) &&
          !actionsIncludeWriteFile(fromClosed.actions)
        ) {
          return fromClosed
        }
      }
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
