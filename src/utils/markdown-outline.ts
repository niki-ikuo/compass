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

export type MarkdownHeadingIssueKind =
  | 'broken_atx'
  | 'empty_heading'
  | 'level_jump'
  | 'duplicate_heading'
  | 'broken_link'

export interface MarkdownHeadingIssue {
  kind: MarkdownHeadingIssueKind
  line: number
  message: string
}

const MD_LINK = /(!)?\[([^\]]*)\]\(([^)]+)\)/g
const DOC_LINK_EXT = /\.(md|markdown|mdx)$/i

/** `](href "title")` / `<href>` からリンク先パスだけ取り出す。 */
export function stripMarkdownHref(raw: string): string {
  let target = raw.trim()
  if (target.startsWith('<') && target.endsWith('>')) {
    target = target.slice(1, -1).trim()
  }
  const titled = target.match(/^(\S+)(?:\s+("|').*\2)?$/)
  if (titled) target = titled[1]
  const hashIdx = target.indexOf('#')
  if (hashIdx === 0) return ''
  if (hashIdx > 0) target = target.slice(0, hashIdx)
  return target.trim()
}

/**
 * fromFile（ワークスペース相対）から相対リンクを解決する。
 * http(s) 等の絶対 URL・ワークスペース外は null。
 */
export function resolveMarkdownLink(fromFile: string, href: string): string | null {
  const target = stripMarkdownHref(href)
  if (!target) return null
  if (/^[a-z][a-z0-9+.-]*:/i.test(target)) return null
  if (target.startsWith('//')) return null

  const from = fromFile.replace(/\\/g, '/').replace(/^\.\//, '')
  const slash = from.lastIndexOf('/')
  const fromDir = slash >= 0 ? from.slice(0, slash) : ''
  const joined = fromDir ? `${fromDir}/${target}` : target
  const parts: string[] = []
  for (const part of joined.split('/')) {
    if (!part || part === '.') continue
    if (part === '..') {
      if (parts.length === 0) return null
      parts.pop()
      continue
    }
    parts.push(part)
  }
  return parts.join('/')
}

/**
 * Markdown 内の相対ドキュメントリンク（.md / .markdown / .mdx）を
 * ワークスペース相対パスへ解決して返す（重複除去・出現順）。
 */
export function parseMarkdownDocLinks(text: string, fromFile: string): string[] {
  const out: string[] = []
  const seen = new Set<string>()
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

    MD_LINK.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = MD_LINK.exec(line)) !== null) {
      if (match[1] === '!') continue
      const resolved = resolveMarkdownLink(fromFile, match[3])
      if (!resolved || !DOC_LINK_EXT.test(resolved)) continue
      if (seen.has(resolved)) continue
      seen.add(resolved)
      out.push(resolved)
    }
  }
  return out
}

/**
 * 指定見出し（テキスト一致、大文字小文字無視可）から
 * 同レベル以上の次見出し直前までのセクション本文を返す。
 */
export function extractMarkdownSection(text: string, headingText: string): string | null {
  const needle = headingText.replace(/^#+\s*/, '').trim()
  if (!needle) return null
  const headings = parseMarkdownHeadings(text)
  const idx = headings.findIndex(
    (h) => h.text === needle || h.text.toLowerCase() === needle.toLowerCase()
  )
  if (idx < 0) return null

  const start = headings[idx]
  const lines = text.split('\n')
  let endExclusive = lines.length
  for (let i = idx + 1; i < headings.length; i++) {
    if (headings[i].level <= start.level) {
      endExclusive = headings[i].line - 1
      break
    }
  }
  return lines.slice(start.line - 1, endExclusive).join('\n')
}

/** 同一レベル・同一テキストの見出し重複。 */
export function findDuplicateHeadings(headings: MarkdownHeading[]): MarkdownHeadingIssue[] {
  const firstLine = new Map<string, number>()
  const issues: MarkdownHeadingIssue[] = []
  for (const h of headings) {
    const key = `${h.level}\0${h.text}`
    const prev = firstLine.get(key)
    if (prev !== undefined) {
      issues.push({
        kind: 'duplicate_heading',
        line: h.line,
        message: `Duplicate h${h.level} heading "${h.text}" (also at L${prev})`
      })
    } else {
      firstLine.set(key, h.line)
    }
  }
  return issues
}

/**
 * 相対 .md リンクのうち、exists が false のものを broken_link として返す。
 * exists 未指定時はリンク検査をスキップ。
 */
export function findBrokenMarkdownDocLinks(
  text: string,
  fromFile: string,
  exists?: (workspaceRelativePath: string) => boolean
): MarkdownHeadingIssue[] {
  if (!exists) return []
  const issues: MarkdownHeadingIssue[] = []
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

    MD_LINK.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = MD_LINK.exec(line)) !== null) {
      if (match[1] === '!') continue
      const href = match[3]
      const resolved = resolveMarkdownLink(fromFile, href)
      if (!resolved || !DOC_LINK_EXT.test(resolved)) continue
      if (exists(resolved)) continue
      issues.push({
        kind: 'broken_link',
        line: i + 1,
        message: `Broken doc link "${stripMarkdownHref(href)}" → ${resolved}`
      })
    }
  }
  return issues
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

export interface ValidateMarkdownDocumentOptions {
  /** リンク解決の起点（ワークスペース相対）。未指定ならリンク検査なし */
  relativePath?: string
  /** ワークスペース相対パスの存在確認。未指定ならリンク検査なし */
  fileExists?: (workspaceRelativePath: string) => boolean
}

/** 文書向け verify: 壊れた ATX・階層ジャンプ・重複見出し・（任意）壊れた相対 doc リンク。 */
export function validateMarkdownDocument(
  text: string,
  options: ValidateMarkdownDocumentOptions = {}
): MarkdownHeadingIssue[] {
  const headings = parseMarkdownHeadings(text)
  const issues: MarkdownHeadingIssue[] = [
    ...findBrokenAtxHeadings(text),
    ...validateMarkdownHeadingStructure(headings),
    ...findDuplicateHeadings(headings)
  ]
  if (options.relativePath && options.fileExists) {
    issues.push(
      ...findBrokenMarkdownDocLinks(text, options.relativePath, options.fileExists)
    )
  }
  return issues
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
