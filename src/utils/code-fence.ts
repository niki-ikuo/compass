export const CODE_FENCE_REGEX = /```\s*([\w-]+)\s*\n?([\s\S]*?)```/g

const FENCED_ACTIONS_OPEN_REGEX = /```\s*compass-actions\b/gi
/** Bare label not preceded by a fence tick (fenced form is handled above). */
const BARE_ACTIONS_OPEN_REGEX = /(?<!`)compass-actions\b/gi

export interface CompassActionsBlock {
  /** Inclusive start index in the source string */
  start: number
  /** Exclusive end index (after optional closing fence) */
  end: number
  /** Balanced JSON object text */
  json: string
}

/**
 * Extract a balanced `{ ... }` JSON object starting at `start`,
 * respecting JSON string escapes so nested ``` / braces inside strings
 * do not end the object early.
 */
export function extractBalancedJsonObject(text: string, start: number): string | null {
  if (text[start] !== '{') return null

  let depth = 0
  let inString = false
  let escaped = false

  for (let i = start; i < text.length; i++) {
    const ch = text[i]

    if (inString) {
      if (escaped) {
        escaped = false
        continue
      }
      if (ch === '\\') {
        escaped = true
        continue
      }
      if (ch === '"') {
        inString = false
      }
      continue
    }

    if (ch === '"') {
      inString = true
      continue
    }
    if (ch === '{') {
      depth++
      continue
    }
    if (ch === '}') {
      depth--
      if (depth === 0) {
        return text.slice(start, i + 1)
      }
    }
  }

  return null
}

function findJsonObjectAfter(text: string, from: number): { json: string; braceIndex: number } | null {
  const braceIndex = text.indexOf('{', from)
  if (braceIndex < 0) return null

  const between = text.slice(from, braceIndex)
  if (between.trim().length > 0) return null

  const json = extractBalancedJsonObject(text, braceIndex)
  if (!json) return null

  return { json, braceIndex }
}

function endAfterOptionalClosingFence(text: string, jsonEnd: number): number {
  const after = text.slice(jsonEnd)
  const close = after.match(/^[ \t]*\r?\n?[ \t]*```/)
  return close ? jsonEnd + close[0].length : jsonEnd
}

/**
 * Find ```compass-actions``` (or bare `compass-actions {`) blocks by
 * balanced JSON extraction — safe when writeFile content embeds ``` fences.
 */
export function findCompassActionsBlocks(content: string): CompassActionsBlock[] {
  const blocks: CompassActionsBlock[] = []
  const occupied: Array<{ start: number; end: number }> = []

  const overlaps = (start: number, end: number): boolean =>
    occupied.some((span) => start < span.end && end > span.start)

  FENCED_ACTIONS_OPEN_REGEX.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = FENCED_ACTIONS_OPEN_REGEX.exec(content)) !== null) {
    const found = findJsonObjectAfter(content, match.index + match[0].length)
    if (!found) continue

    const start = match.index
    const end = endAfterOptionalClosingFence(content, found.braceIndex + found.json.length)
    if (overlaps(start, end)) continue

    blocks.push({ start, end, json: found.json })
    occupied.push({ start, end })
    FENCED_ACTIONS_OPEN_REGEX.lastIndex = end
  }

  BARE_ACTIONS_OPEN_REGEX.lastIndex = 0
  while ((match = BARE_ACTIONS_OPEN_REGEX.exec(content)) !== null) {
    const found = findJsonObjectAfter(content, match.index + match[0].length)
    if (!found) continue

    const start = match.index
    const end = endAfterOptionalClosingFence(content, found.braceIndex + found.json.length)
    if (overlaps(start, end)) continue

    blocks.push({ start, end, json: found.json })
    occupied.push({ start, end })
    BARE_ACTIONS_OPEN_REGEX.lastIndex = end
  }

  return blocks.sort((a, b) => a.start - b.start)
}
