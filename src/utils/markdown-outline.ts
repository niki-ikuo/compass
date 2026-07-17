export interface MarkdownHeading {
  level: number
  text: string
  /** 1-based line number */
  line: number
}

const ATX_HEADING = /^(#{1,6})\s+(.+?)\s*#*\s*$/

/** ATX 見出し（#〜######）を行番号付きで抽出。コードフェンス内は無視。 */
export function parseMarkdownHeadings(text: string): MarkdownHeading[] {
  const headings: MarkdownHeading[] = []
  const lines = text.split('\n')
  let inFence = false

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const fence = line.match(/^(`{3,}|~{3,})/)
    if (fence) {
      inFence = !inFence
      continue
    }
    if (inFence) continue

    const match = line.match(ATX_HEADING)
    if (!match) continue
    headings.push({
      level: match[1].length,
      text: match[2].trim(),
      line: i + 1
    })
  }

  return headings
}

/**
 * 先頭の本文段落から短い要約を作る。
 * 見出し・フェンス・空行は飛ばし、最初の段落を maxChars まで。
 */
export function extractMarkdownSummary(text: string, maxChars = 200): string {
  const lines = text.split('\n')
  let inFence = false
  const chunks: string[] = []

  for (const line of lines) {
    if (/^(`{3,}|~{3,})/.test(line)) {
      inFence = !inFence
      continue
    }
    if (inFence) continue
    if (ATX_HEADING.test(line)) continue

    const trimmed = line.trim()
    if (!trimmed) {
      if (chunks.length > 0) break
      continue
    }

    chunks.push(trimmed)
    if (chunks.join(' ').length >= maxChars) break
  }

  const summary = chunks.join(' ').replace(/\s+/g, ' ').trim()
  if (!summary) return ''
  if (summary.length <= maxChars) return summary
  return `${summary.slice(0, Math.max(1, maxChars - 1))}…`
}

export type MarkdownHeadingIssueKind = 'broken_atx' | 'empty_heading' | 'level_jump'

export interface MarkdownHeadingIssue {
  kind: MarkdownHeadingIssueKind
  line: number
  message: string
}

/** 壊れた ATX（#直後に空白なし）や空見出しを検出。フェンス内は無視。 */
export function findBrokenAtxHeadings(text: string): MarkdownHeadingIssue[] {
  const issues: MarkdownHeadingIssue[] = []
  const lines = text.split('\n')
  let inFence = false

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (/^(`{3,}|~{3,})/.test(line)) {
      inFence = !inFence
      continue
    }
    if (inFence) continue

    if (/^#{1,6}\S/.test(line)) {
      issues.push({
        kind: 'broken_atx',
        line: i + 1,
        message: `ATX heading needs a space after #: "${line.trim().slice(0, 60)}"`
      })
      continue
    }
    if (/^#{1,6}\s*$/.test(line)) {
      issues.push({
        kind: 'empty_heading',
        line: i + 1,
        message: 'Empty ATX heading'
      })
    }
  }

  return issues
}

/** 見出し階層の飛び（例: # → ###）を検出。 */
export function validateMarkdownHeadingStructure(
  headings: MarkdownHeading[]
): MarkdownHeadingIssue[] {
  const issues: MarkdownHeadingIssue[] = []
  for (let i = 1; i < headings.length; i++) {
    const prev = headings[i - 1]
    const cur = headings[i]
    if (cur.level > prev.level + 1) {
      issues.push({
        kind: 'level_jump',
        line: cur.line,
        message: `Heading level jumps from h${prev.level} to h${cur.level} ("${cur.text}")`
      })
    }
  }
  return issues
}

/** 文書向け verify: 壊れた ATX + 階層ジャンプ。 */
export function validateMarkdownDocument(text: string): MarkdownHeadingIssue[] {
  return [
    ...findBrokenAtxHeadings(text),
    ...validateMarkdownHeadingStructure(parseMarkdownHeadings(text))
  ]
}

export type MarkdownHeadingChangeKind = 'added' | 'removed'

export interface MarkdownHeadingChange {
  kind: MarkdownHeadingChangeKind
  level: number
  text: string
}

function headingKey(heading: Pick<MarkdownHeading, 'level' | 'text'>): string {
  return `${heading.level}\0${heading.text}`
}

/** 見出し集合の差分（追加・削除）。順序変更のみは検出しない。 */
export function diffMarkdownHeadings(
  oldText: string,
  newText: string
): MarkdownHeadingChange[] {
  const oldHeadings = parseMarkdownHeadings(oldText)
  const newHeadings = parseMarkdownHeadings(newText)
  const oldCounts = new Map<string, { level: number; text: string; count: number }>()
  const newCounts = new Map<string, { level: number; text: string; count: number }>()

  for (const h of oldHeadings) {
    const key = headingKey(h)
    const prev = oldCounts.get(key)
    if (prev) prev.count += 1
    else oldCounts.set(key, { level: h.level, text: h.text, count: 1 })
  }
  for (const h of newHeadings) {
    const key = headingKey(h)
    const prev = newCounts.get(key)
    if (prev) prev.count += 1
    else newCounts.set(key, { level: h.level, text: h.text, count: 1 })
  }

  const changes: MarkdownHeadingChange[] = []
  for (const [key, entry] of newCounts) {
    const oldCount = oldCounts.get(key)?.count ?? 0
    for (let i = 0; i < entry.count - oldCount; i++) {
      changes.push({ kind: 'added', level: entry.level, text: entry.text })
    }
  }
  for (const [key, entry] of oldCounts) {
    const newCount = newCounts.get(key)?.count ?? 0
    for (let i = 0; i < entry.count - newCount; i++) {
      changes.push({ kind: 'removed', level: entry.level, text: entry.text })
    }
  }
  return changes
}

export type CompactDiffEntry =
  | { type: 'add' | 'remove' | 'same'; content: string }
  | { type: 'skip'; count: number }

/**
 * 変更行の前後 context 行だけ残し、離れた unchanged を skip に折りたたむ。
 * 文書向けの読みやすい差分表示用。
 */
export function compactDiffLines(
  lines: Array<{ type: 'add' | 'remove' | 'same'; content: string }>,
  context = 1
): CompactDiffEntry[] {
  if (lines.length === 0) return []

  const keep = new Array<boolean>(lines.length).fill(false)
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].type === 'same') continue
    const from = Math.max(0, i - context)
    const to = Math.min(lines.length - 1, i + context)
    for (let j = from; j <= to; j++) keep[j] = true
  }

  // 変更が無い場合は先頭数行だけ示す
  if (!keep.some(Boolean)) {
    const preview = lines.slice(0, Math.min(3, lines.length)).map((line) => ({
      type: line.type,
      content: line.content
    }))
    if (lines.length > preview.length) {
      return [...preview, { type: 'skip', count: lines.length - preview.length }]
    }
    return preview
  }

  const result: CompactDiffEntry[] = []
  let skipCount = 0
  for (let i = 0; i < lines.length; i++) {
    if (!keep[i]) {
      skipCount += 1
      continue
    }
    if (skipCount > 0) {
      result.push({ type: 'skip', count: skipCount })
      skipCount = 0
    }
    result.push({ type: lines[i].type, content: lines[i].content })
  }
  if (skipCount > 0) result.push({ type: 'skip', count: skipCount })
  return result
}
