export type StrReplaceErrorCode =
  | 'empty_old'
  | 'not_found'
  | 'not_unique'

export type StrReplaceResult =
  | { ok: true; content: string; replacements: number }
  | { ok: false; code: StrReplaceErrorCode; count: number; message: string }

/**
 * Exact string replace for Agent `strReplace`.
 * Default: oldString must occur exactly once. replaceAll replaces every occurrence.
 */
export function applyExactReplace(
  content: string,
  oldString: string,
  newString: string,
  replaceAll = false
): StrReplaceResult {
  if (oldString.length === 0) {
    return {
      ok: false,
      code: 'empty_old',
      count: 0,
      message: 'Error: oldString must be a non-empty exact substring of the file'
    }
  }

  const count = countOccurrences(content, oldString)
  if (count === 0) {
    return {
      ok: false,
      code: 'not_found',
      count: 0,
      message:
        'Error: oldString was not found in the file. Call readFile with force=true and copy the exact current text.'
    }
  }
  if (!replaceAll && count !== 1) {
    return {
      ok: false,
      code: 'not_unique',
      count,
      message: `Error: oldString matched ${count} times. Pass a unique substring, or set replaceAll=true.`
    }
  }

  const next = replaceAll
    ? content.split(oldString).join(newString)
    : content.replace(oldString, newString)

  return { ok: true, content: next, replacements: replaceAll ? count : 1 }
}

export function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0
  let count = 0
  let from = 0
  while (from <= haystack.length - needle.length) {
    const at = haystack.indexOf(needle, from)
    if (at < 0) break
    count++
    from = at + needle.length
  }
  return count
}
