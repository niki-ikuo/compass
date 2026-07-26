import { formatContextMention, formatContextLabel } from './chat-mentions'
import { isTabularDataPath } from './data-rows'
import { getFileName } from './language'
import { join } from './path'
import type { ChatContextRef, ChatMode, UseCasePreset } from '@/types'

export const DATA_RESULT_KIND = 'data-result'

export type DataResultFormat = 'markdown' | 'csv'

export type DataResultMeta = {
  kind: typeof DATA_RESULT_KIND
  sources: string[]
  sql: string
  format: DataResultFormat
}

export type SaveDataResultRequest = {
  text: string
  mode: ChatMode
  preset: UseCasePreset
  contextRefs: ChatContextRef[]
}

export type RerunDataQueryRequest = SaveDataResultRequest & {
  meta: DataResultMeta
}

function normalizeRelativePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\.\//, '')
}

function splitDirAndBase(relativePath: string): { dir: string; stem: string } {
  const normalized = normalizeRelativePath(relativePath)
  const slash = normalized.lastIndexOf('/')
  const dir = slash >= 0 ? normalized.slice(0, slash + 1) : ''
  const base = slash >= 0 ? normalized.slice(slash + 1) : normalized
  const dot = base.lastIndexOf('.')
  const stem = dot > 0 ? base.slice(0, dot) : base
  return { dir, stem }
}

/**
 * データ結果 Markdown サイドカー。
 * `data/sales.csv` → `data/sales.result.md`
 */
export function sidecarDataResultMarkdownPath(relativePath: string): string {
  const { dir, stem } = splitDirAndBase(relativePath)
  return `${dir}${stem}.result.md`
}

/**
 * データ結果 CSV サイドカー。
 * `data/sales.csv` → `data/sales.result.csv`
 */
export function sidecarDataResultCsvPath(relativePath: string): string {
  const { dir, stem } = splitDirAndBase(relativePath)
  return `${dir}${stem}.result.csv`
}

/** `*.result.md` かどうか（中身の frontmatter は見ない） */
export function isDataResultNotePath(filePath: string): boolean {
  return /\.result\.md$/i.test(filePath.replace(/\\/g, '/'))
}

export function isTabularDataAbsolutePath(
  absolutePath: string,
  workspaceRoot: string | null
): boolean {
  const label = formatContextLabel(absolutePath, workspaceRoot)
  if (isTabularDataPath(label)) return true
  // ワークスペース外など相対化できない場合は basename で判定
  return isTabularDataPath(getFileName(absolutePath))
}

function quoteYamlScalar(value: string): string {
  if (value === '' || /[:#{}[\],&*?|>!%@`"'\\]/.test(value) || /^\s|\s$/.test(value)) {
    return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
  }
  return value
}

function unquoteYamlScalar(raw: string): string {
  const value = raw.trim()
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\')
  }
  return value
}

function parseSources(value: string): string[] {
  return value
    .split(/[,|]/)
    .map((part) => normalizeRelativePath(part.trim()))
    .filter(Boolean)
}

function parseFormat(value: string): DataResultFormat {
  const lower = value.trim().toLowerCase()
  return lower === 'csv' ? 'csv' : 'markdown'
}

/**
 * データ結果ノートの YAML frontmatter を読む。
 * `kind: data-result` が必須。`sql` は同一行または `|` / `>` ブロック。
 */
export function parseDataResultFrontmatter(raw: string): {
  meta: DataResultMeta | null
  body: string
} {
  const text = raw.replace(/^\uFEFF/, '')
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text)
  if (!match) return { meta: null, body: raw }

  const lines = match[1].split(/\r?\n/)
  let kind = ''
  let sources: string[] = []
  let sql = ''
  let format: DataResultFormat = 'markdown'
  let i = 0

  while (i < lines.length) {
    const line = lines[i]
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) {
      i += 1
      continue
    }
    const sep = trimmed.indexOf(':')
    if (sep <= 0) {
      i += 1
      continue
    }
    const key = trimmed.slice(0, sep).trim()
    const rest = trimmed.slice(sep + 1).trim()

    if (key === 'sql' && (rest === '|' || rest === '>' || rest === '|-')) {
      const block: string[] = []
      i += 1
      while (i < lines.length) {
        const blockLine = lines[i]
        if (blockLine.length > 0 && !/^\s/.test(blockLine) && blockLine.includes(':')) {
          break
        }
        block.push(blockLine.replace(/^\s{2}/, ''))
        i += 1
      }
      sql = block.join('\n').replace(/\s+$/, '')
      continue
    }

    const value = unquoteYamlScalar(rest)
    if (key === 'kind') kind = value
    if (key === 'sources' && value) sources = parseSources(value)
    if (key === 'sql' && value) sql = value
    if (key === 'format' && value) format = parseFormat(value)
    i += 1
  }

  if (kind !== DATA_RESULT_KIND || sources.length === 0 || !sql.trim()) {
    return { meta: null, body: match[2].replace(/^\r?\n/, '') }
  }

  return {
    meta: {
      kind: DATA_RESULT_KIND,
      sources,
      sql: sql.trim(),
      format
    },
    body: match[2].replace(/^\r?\n/, '')
  }
}

/** プロンプト例示・テスト用に frontmatter 付き Markdown を組み立てる */
export function serializeDataResultMarkdown(
  meta: Omit<DataResultMeta, 'kind'> & { kind?: string },
  body: string
): string {
  const sql = meta.sql.trim()
  const useBlock = sql.includes('\n')
  const frontmatter = [
    '---',
    `kind: ${DATA_RESULT_KIND}`,
    `sources: ${quoteYamlScalar(meta.sources.map(normalizeRelativePath).join(', '))}`,
    useBlock ? 'sql: |' : `sql: ${quoteYamlScalar(sql)}`,
    ...(useBlock ? sql.split('\n').map((line) => `  ${line}`) : []),
    `format: ${meta.format === 'csv' ? 'csv' : 'markdown'}`,
    '---',
    ''
  ].join('\n')
  return frontmatter + body.replace(/^\uFEFF/, '')
}

function toContextRef(absolutePath: string): ChatContextRef {
  return {
    path: absolutePath,
    name: getFileName(absolutePath),
    isDirectory: false
  }
}

function resolveWorkspaceAbsolute(
  relativePath: string,
  workspaceRoot: string
): string {
  const root = workspaceRoot.replace(/\\/g, '/').replace(/\/$/, '')
  return join(root, normalizeRelativePath(relativePath))
}

/** 複数 CSV/JSON について質問する Agent+data 送信内容 */
export function buildAskAcrossDataRequest(
  absolutePaths: string[],
  workspaceRoot: string | null,
  promptTemplate: (vars: { mentions: string }) => string
): SaveDataResultRequest | null {
  const paths = absolutePaths.filter((p) => isTabularDataAbsolutePath(p, workspaceRoot))
  if (paths.length === 0) return null

  const mentions = paths
    .map((p) => formatContextMention(p, false, workspaceRoot))
    .join(' ')

  return {
    text: promptTemplate({ mentions }),
    mode: 'agent',
    preset: 'data',
    contextRefs: paths.map(toContextRef)
  }
}

/** 結果をソース横の `.result.md` / `.result.csv` に残す Agent+data 送信内容 */
export function buildSaveDataResultRequest(
  absolutePaths: string[],
  workspaceRoot: string | null,
  promptTemplate: (vars: {
    mentions: string
    sidecarMd: string
    sidecarCsv: string
  }) => string
): SaveDataResultRequest | null {
  const paths = absolutePaths.filter((p) => isTabularDataAbsolutePath(p, workspaceRoot))
  if (paths.length === 0) return null

  const primaryRelative = normalizeRelativePath(
    formatContextLabel(paths[0], workspaceRoot) === '.'
      ? getFileName(paths[0])
      : formatContextLabel(paths[0], workspaceRoot)
  )
  const sidecarMd = sidecarDataResultMarkdownPath(primaryRelative)
  const sidecarCsv = sidecarDataResultCsvPath(primaryRelative)
  const mentions = paths
    .map((p) => formatContextMention(p, false, workspaceRoot))
    .join(' ')

  return {
    text: promptTemplate({ mentions, sidecarMd, sidecarCsv }),
    mode: 'agent',
    preset: 'data',
    contextRefs: paths.map(toContextRef)
  }
}

/** 結果ノートの frontmatter から前回クエリを再実行する送信内容 */
export function buildRerunDataQueryRequest(
  noteAbsolutePath: string,
  noteContent: string,
  workspaceRoot: string | null,
  promptTemplate: (vars: {
    mention: string
    sources: string
    sql: string
    sidecarMd: string
    sidecarCsv: string
  }) => string
): RerunDataQueryRequest | null {
  const { meta } = parseDataResultFrontmatter(noteContent)
  if (!meta || !workspaceRoot) return null

  const noteRelative = formatContextLabel(noteAbsolutePath, workspaceRoot)
  const sidecarMd = isDataResultNotePath(noteAbsolutePath)
    ? noteRelative
    : sidecarDataResultMarkdownPath(meta.sources[0])
  const primarySource = meta.sources[0]
  const sidecarCsv = sidecarDataResultCsvPath(primarySource)
  const mention = formatContextMention(noteAbsolutePath, false, workspaceRoot)

  const sourceAbs = meta.sources.map((rel) => resolveWorkspaceAbsolute(rel, workspaceRoot))
  const contextRefs = [toContextRef(noteAbsolutePath), ...sourceAbs.map(toContextRef)]

  return {
    text: promptTemplate({
      mention,
      sources: meta.sources.join(', '),
      sql: meta.sql,
      sidecarMd,
      sidecarCsv
    }),
    mode: 'agent',
    preset: 'data',
    contextRefs,
    meta
  }
}
