/**
 * Apply a unified-diff style patch to file contents (surgical edit).
 * Path headers (---/+++) are optional when the target path is supplied separately.
 * Also accepts Cursor / OpenAI apply_patch wrappers (`*** Begin Patch`, etc.) by
 * stripping meta lines before parsing.
 */

export class ApplyPatchError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ApplyPatchError'
  }
}

interface HunkLine {
  kind: 'context' | 'remove' | 'add' | 'meta'
  text: string
}

interface Hunk {
  oldStart: number
  oldCount: number
  newStart: number
  newCount: number
  lines: HunkLine[]
}

function splitLines(text: string): string[] {
  if (text.length === 0) return []
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const parts = normalized.split('\n')
  // Preserve a trailing empty slot only when the source ends with a newline.
  if (normalized.endsWith('\n')) return parts
  return parts
}

function parseHunkHeader(line: string): Omit<Hunk, 'lines'> | null {
  const match = /^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s@@/.exec(line)
  if (!match) return null
  return {
    oldStart: Number(match[1]),
    oldCount: match[2] === undefined ? 1 : Number(match[2]),
    newStart: Number(match[3]),
    newCount: match[4] === undefined ? 1 : Number(match[4])
  }
}

/** Cursor / OpenAI apply_patch meta lines (*** Begin Patch, *** Update File:, …). */
function isApplyPatchMetaLine(line: string): boolean {
  return line.trimStart().startsWith('***')
}

/**
 * Strip apply_patch wrappers and ensure at least one hunk marker remains.
 * Models often emit `*** Begin Patch` / `*** Update File:` instead of raw unified diff.
 */
export function normalizePatchInput(patch: string): string {
  const raw = patch.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const lines = raw.split('\n')
  const out: string[] = []
  let sawMeta = false
  let sawHunk = false

  for (const line of lines) {
    if (isApplyPatchMetaLine(line)) {
      sawMeta = true
      continue
    }
    if (line.startsWith('@@')) sawHunk = true
    out.push(line)
  }

  while (out.length > 0 && out[0].trim() === '') out.shift()
  while (out.length > 0 && out[out.length - 1].trim() === '') out.pop()

  if (out.length === 0) return ''

  // Add-file style body: only +/- lines with no @@ after meta strip.
  if (sawMeta && !sawHunk) {
    return ['@@', ...out].join('\n')
  }

  return out.join('\n')
}

function parseHunkBodyLines(
  lines: string[],
  startIndex: number,
  options: { lenientUnmarked: boolean }
): { hunkLines: HunkLine[]; nextIndex: number } {
  const hunkLines: HunkLine[] = []
  let i = startIndex

  while (i < lines.length) {
    const hl = lines[i]
    if (isApplyPatchMetaLine(hl)) {
      i++
      continue
    }
    if (
      hl.startsWith('@@') ||
      hl.startsWith('--- ') ||
      hl.startsWith('+++ ') ||
      hl.startsWith('diff ')
    ) {
      break
    }
    if (hl.startsWith('\\')) {
      hunkLines.push({ kind: 'meta', text: hl.slice(1).trimStart() })
    } else if (hl.startsWith('+')) {
      hunkLines.push({ kind: 'add', text: hl.slice(1) })
    } else if (hl.startsWith('-')) {
      hunkLines.push({ kind: 'remove', text: hl.slice(1) })
    } else if (hl.startsWith(' ') || hl === '') {
      hunkLines.push({ kind: 'context', text: hl.startsWith(' ') ? hl.slice(1) : '' })
    } else if (options.lenientUnmarked) {
      // Treat unmarked lines as context (common LLM / apply_patch slip)
      hunkLines.push({ kind: 'context', text: hl })
    } else {
      throw new ApplyPatchError(`Invalid hunk line: ${hl.slice(0, 80)}`)
    }
    i++
  }

  return { hunkLines, nextIndex: i }
}

export function parseUnifiedDiff(patch: string): Hunk[] {
  const normalized = normalizePatchInput(patch)
  const lines = normalized.split('\n')
  const hunks: Hunk[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]
    if (
      isApplyPatchMetaLine(line) ||
      line.startsWith('---') ||
      line.startsWith('+++') ||
      line.startsWith('diff ') ||
      line.startsWith('index ') ||
      line.trim() === ''
    ) {
      i++
      continue
    }

    const header = parseHunkHeader(line)
    if (!header) {
      // Bare "@@" or "@@ <annotation>" (V4A / apply_patch style).
      if (line.startsWith('@@')) {
        i++
        const { hunkLines, nextIndex } = parseHunkBodyLines(lines, i, { lenientUnmarked: true })
        i = nextIndex
        const oldCount = hunkLines.filter((l) => l.kind === 'context' || l.kind === 'remove').length
        const newCount = hunkLines.filter((l) => l.kind === 'context' || l.kind === 'add').length
        hunks.push({ oldStart: 1, oldCount, newStart: 1, newCount, lines: hunkLines })
        continue
      }
      throw new ApplyPatchError(`Invalid patch line (expected hunk header): ${line.slice(0, 80)}`)
    }

    i++
    const { hunkLines, nextIndex } = parseHunkBodyLines(lines, i, { lenientUnmarked: false })
    i = nextIndex
    hunks.push({ ...header, lines: hunkLines })
  }

  if (hunks.length === 0) {
    throw new ApplyPatchError('Patch contains no hunks')
  }
  return hunks
}

function findHunkPosition(lines: string[], hunk: Hunk): number {
  const expected = hunk.lines
    .filter((l) => l.kind === 'context' || l.kind === 'remove')
    .map((l) => l.text)

  if (expected.length === 0) {
    // Pure insertions: trust oldStart (1-indexed), allow 0 for empty files.
    if (hunk.oldStart <= 0) return 0
    return Math.min(Math.max(hunk.oldStart - 1, 0), lines.length)
  }

  const prefer = Math.max(hunk.oldStart - 1, 0)
  const maxScan = lines.length

  const matchesAt = (start: number): boolean => {
    if (start < 0 || start + expected.length > lines.length) return false
    for (let i = 0; i < expected.length; i++) {
      if (lines[start + i] !== expected[i]) return false
    }
    return true
  }

  if (matchesAt(prefer)) return prefer

  // Fuzzy: search nearby first, then whole file (unique match required when far).
  const window = 40
  for (let dist = 1; dist <= window; dist++) {
    if (matchesAt(prefer - dist)) return prefer - dist
    if (matchesAt(prefer + dist)) return prefer + dist
  }

  const hits: number[] = []
  for (let start = 0; start <= maxScan - expected.length; start++) {
    if (matchesAt(start)) hits.push(start)
  }
  if (hits.length === 1) return hits[0]
  if (hits.length > 1) {
    throw new ApplyPatchError(
      `Hunk context matched ${hits.length} locations (ambiguous) near line ${hunk.oldStart}`
    )
  }

  const preview = expected.slice(0, 3).join('\\n')
  throw new ApplyPatchError(
    `Failed to locate hunk context near line ${hunk.oldStart}: "${preview}"`
  )
}

/**
 * Apply a unified diff patch to `original` file contents.
 * Returns the new file contents.
 */
export function applyUnifiedDiff(original: string, patch: string): string {
  const trimmedPatch = patch.trim()
  if (!trimmedPatch) {
    throw new ApplyPatchError('Empty patch')
  }

  const hunks = parseUnifiedDiff(trimmedPatch)
  let lines = splitLines(original)

  // Apply forward; re-find each hunk against the evolving buffer using patch context.
  for (const hunk of hunks) {
    const pos = findHunkPosition(lines, hunk)
    const next: string[] = []
    next.push(...lines.slice(0, pos))

    let oldConsumed = 0
    for (const hl of hunk.lines) {
      if (hl.kind === 'meta') continue
      if (hl.kind === 'context') {
        next.push(hl.text)
        oldConsumed++
      } else if (hl.kind === 'remove') {
        oldConsumed++
      } else if (hl.kind === 'add') {
        next.push(hl.text)
      }
    }

    next.push(...lines.slice(pos + oldConsumed))
    lines = next
  }

  // Decide trailing newline: if original was empty and result has lines, join with \n
  // between lines; append trailing newline when original had one or result is non-empty
  // and original ended with newline.
  if (lines.length === 0) return ''
  const body = lines.join('\n')
  if (original.length === 0) {
    return `${body}\n`
  }
  if (/\r?\n$/.test(original)) {
    return body.endsWith('\n') ? body : `${body}\n`
  }
  return body
}
