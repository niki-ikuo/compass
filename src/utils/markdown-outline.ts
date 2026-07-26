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
  | 'term_mismatch'

export interface GlossaryTerm {
  /** 推奨表記 */
  preferred: string
  /** 避ける表記 */
  avoid: string[]
}

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

function findHeadingIndex(headings: MarkdownHeading[], headingText: string): number {
  const needle = headingText.replace(/^#+\s*/, '').trim()
  if (!needle) return -1
  return headings.findIndex(
    (h) => h.text === needle || h.text.toLowerCase() === needle.toLowerCase()
  )
}

/** 指定見出しから同レベル以上の次見出し直前までの行範囲（0-based, end exclusive）。 */
export function findMarkdownSectionRange(
  text: string,
  headingText: string
): { startLine: number; endExclusive: number; heading: MarkdownHeading } | null {
  const headings = parseMarkdownHeadings(text)
  const idx = findHeadingIndex(headings, headingText)
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
  return { startLine: start.line - 1, endExclusive, heading: start }
}

/**
 * 指定見出し（テキスト一致、大文字小文字無視可）から
 * 同レベル以上の次見出し直前までのセクション本文を返す。
 */
export function extractMarkdownSection(text: string, headingText: string): string | null {
  const range = findMarkdownSectionRange(text, headingText)
  if (!range) return null
  return text.split('\n').slice(range.startLine, range.endExclusive).join('\n')
}

/**
 * 見出し配下だけを差し替える。newSectionBody が見出し行で始まらない場合は
 * 元の見出し行を先頭に付与する（他章は触らない）。
 */
export function replaceMarkdownSection(
  text: string,
  headingText: string,
  newSectionBody: string
): string | null {
  const range = findMarkdownSectionRange(text, headingText)
  if (!range) return null

  const lines = text.split('\n')
  const normalized = newSectionBody.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const bodyLines = normalized.split('\n')
  const firstContent = bodyLines.find((line) => line.trim().length > 0)
  const startsWithHeading = Boolean(firstContent && ATX_HEADING.test(firstContent))

  let replacementLines: string[]
  if (startsWithHeading) {
    replacementLines = bodyLines
  } else {
    const headingLine = lines[range.startLine]
    const trimmed = normalized.replace(/^\n+/, '').replace(/\n+$/, '')
    replacementLines = trimmed ? [headingLine, ...trimmed.split('\n')] : [headingLine]
  }

  return [...lines.slice(0, range.startLine), ...replacementLines, ...lines.slice(range.endExclusive)].join(
    '\n'
  )
}

/** 指定行（1-based）直前までの直近見出し。 */
export function headingAtLine(text: string, line: number): MarkdownHeading | null {
  const headings = parseMarkdownHeadings(text)
  let best: MarkdownHeading | null = null
  for (const h of headings) {
    if (h.line <= line) best = h
    else break
  }
  return best
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
  /** 用語集。未指定なら用語検査なし */
  glossaryTerms?: GlossaryTerm[]
}

/**
 * `.compass/glossary.md` 向けの薄い用語集パーサ。
 * 行形式: `推奨 | 避け1, 避け2` または表行 `| 推奨 | 避け |`
 */
export function parseGlossaryMarkdown(text: string): GlossaryTerm[] {
  const terms: GlossaryTerm[] = []
  const seen = new Set<string>()
  const lines = text.split('\n')
  let inFence = false

  for (const line of lines) {
    if (/^(`{3,}|~{3,})/.test(line)) {
      inFence = !inFence
      continue
    }
    if (inFence) continue
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    if (/^\|?\s*:?-+:?\s*\|/.test(trimmed)) continue

    let preferred = ''
    let avoidRaw = ''
    const table = trimmed.match(/^\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|?\s*$/)
    if (table) {
      preferred = table[1].trim()
      avoidRaw = table[2].trim()
      if (/^preferred$/i.test(preferred) || /^推奨/.test(preferred)) continue
      if (/^avoid$/i.test(avoidRaw) || /^避け/.test(avoidRaw)) continue
    } else {
      const pipe = trimmed.match(/^([^|#]+?)\s*\|\s*(.+)$/)
      if (!pipe) continue
      preferred = pipe[1].trim()
      avoidRaw = pipe[2].trim()
    }

    if (!preferred || !avoidRaw) continue
    const avoid = avoidRaw
      .split(/[,、]/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && s.toLowerCase() !== preferred.toLowerCase())
    if (avoid.length === 0) continue
    const key = preferred.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    terms.push({ preferred, avoid })
  }
  return terms
}

/** 用語集の「避け」表記が本文に出ていれば term_mismatch。フェンス内は無視。 */
export function findTermIssues(text: string, terms: GlossaryTerm[]): MarkdownHeadingIssue[] {
  if (terms.length === 0) return []
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

    const lower = line.toLowerCase()
    for (const term of terms) {
      for (const avoid of term.avoid) {
        if (!avoid) continue
        const needle = avoid.toLowerCase()
        let from = 0
        while (from <= lower.length) {
          const at = lower.indexOf(needle, from)
          if (at < 0) break
          const before = at === 0 ? '' : lower[at - 1]
          const after = at + needle.length >= lower.length ? '' : lower[at + needle.length]
          const boundaryBefore = !/[a-z0-9_]/i.test(before)
          const boundaryAfter = !/[a-z0-9_]/i.test(after)
          // CJK / 記号混じりは部分一致、ASCII 語は単語境界
          const isAsciiWord = /^[a-z0-9][a-z0-9_-]*$/i.test(avoid)
          if (!isAsciiWord || (boundaryBefore && boundaryAfter)) {
            issues.push({
              kind: 'term_mismatch',
              line: i + 1,
              message: `Prefer "${term.preferred}" instead of "${avoid}"`
            })
            break
          }
          from = at + needle.length
        }
      }
    }
  }
  return issues
}

/** 文書向け verify: 壊れた ATX・階層ジャンプ・重複見出し・（任意）壊れた相対 doc リンク・用語。 */
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
  if (options.glossaryTerms && options.glossaryTerms.length > 0) {
    issues.push(...findTermIssues(text, options.glossaryTerms))
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
  | { type: 'heading'; level: number; text: string }

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

/**
 * 散文 Diff: 変更塊の前に直近見出しラベルを差し込み、ノイズを畳む。
 * oldText は見出し解決用（削除行・共通行の行番号基準）。
 */
export function compactProseDiffLines(
  lines: Array<{ type: 'add' | 'remove' | 'same'; content: string }>,
  oldText: string,
  context = 2
): CompactDiffEntry[] {
  if (lines.length === 0) return []

  const oldLineByIndex = new Array<number>(lines.length)
  let oldLine = 1
  for (let i = 0; i < lines.length; i++) {
    oldLineByIndex[i] = oldLine
    if (lines[i].type === 'same' || lines[i].type === 'remove') {
      oldLine += 1
    }
  }

  const keep = new Array<boolean>(lines.length).fill(false)
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].type === 'same') continue
    const from = Math.max(0, i - context)
    const to = Math.min(lines.length - 1, i + context)
    for (let j = from; j <= to; j++) keep[j] = true
  }

  if (!keep.some(Boolean)) {
    return compactDiffLines(lines, context)
  }

  const result: CompactDiffEntry[] = []
  let skipCount = 0
  let lastHeadingKey = ''
  let regionStart = true

  for (let i = 0; i < lines.length; i++) {
    if (!keep[i]) {
      skipCount += 1
      regionStart = true
      continue
    }
    if (skipCount > 0) {
      result.push({ type: 'skip', count: skipCount })
      skipCount = 0
    }
    if (regionStart) {
      const heading = headingAtLine(oldText, oldLineByIndex[i])
      if (heading) {
        const key = `${heading.level}\0${heading.text}`
        if (key !== lastHeadingKey) {
          result.push({ type: 'heading', level: heading.level, text: heading.text })
          lastHeadingKey = key
        }
      }
      regionStart = false
    }
    result.push({ type: lines[i].type, content: lines[i].content })
  }
  if (skipCount > 0) result.push({ type: 'skip', count: skipCount })
  return result
}
