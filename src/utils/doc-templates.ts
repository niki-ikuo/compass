import type { LocaleId } from '@/i18n'
import { DEFAULT_LOCALE } from '@/i18n'
import type { DecodedFileContent, FileTreeNode, WorkspaceAction } from '@/types'
import { basename, join } from '@/utils/path'
import { buildUniqueFileName } from '@/utils/unique-file-name'

/** ワークスペースのテンプレートフォルダ（Git 共有向け。`.compass` 配下） */
export const WORKSPACE_TEMPLATES_DIR = '.compass/templates'

export type BuiltinDocTemplateId = 'meeting-notes' | 'procedure' | 'plan-memo' | 'data-memo'

/** 内蔵 ID、または `.compass/templates/*.md` のファイル名（拡張子なし） */
export type DocTemplateId = BuiltinDocTemplateId | (string & {})

export type DocTemplateSource = 'builtin' | 'workspace'

export interface DocTemplate {
  id: string
  /** 既定ファイル名（.md 付き） */
  defaultFileName: string
  /** 内蔵テンプレ用 i18n キー。ワークスペース由来では未設定 */
  labelKey?:
    | 'template.meetingNotes'
    | 'template.procedure'
    | 'template.planMemo'
    | 'template.dataMemo'
  /** メニュー表示名（ワークスペース由来、または管理 UI で確定した値） */
  label?: string
  body: string
  source: DocTemplateSource
  /** メニュー表示順（小さいほど上）。未設定時はマージ時に既定値を付与 */
  order?: number
  /** ワークスペース上の保存パス（絶対） */
  storagePath?: string
}

export interface WorkspaceTemplateDraft {
  id: string
  label: string
  defaultFileName: string
  body: string
  order: number
}

const TEMPLATES_JA: Record<BuiltinDocTemplateId, Omit<DocTemplate, 'id' | 'labelKey' | 'source'>> = {
  'meeting-notes': {
    defaultFileName: 'meeting-notes.md',
    body: [
      '# 議事録',
      '',
      '- 日時:',
      '- 場所:',
      '- 参加者:',
      '',
      '## 議題',
      '',
      '1.',
      '',
      '## 議論メモ',
      '',
      '- ',
      '',
      '## 決定事項',
      '',
      '- ',
      '',
      '## 次のアクション',
      '',
      '| 担当 | 内容 | 期限 |',
      '| --- | --- | --- |',
      '|  |  |  |',
      ''
    ].join('\n')
  },
  procedure: {
    defaultFileName: 'procedure.md',
    body: [
      '# 手順書',
      '',
      '## 目的',
      '',
      '',
      '',
      '## 前提条件',
      '',
      '- ',
      '',
      '## 手順',
      '',
      '1. ',
      '2. ',
      '3. ',
      '',
      '## 確認ポイント',
      '',
      '- ',
      '',
      '## トラブルシューティング',
      '',
      '| 症状 | 対処 |',
      '| --- | --- |',
      '|  |  |',
      ''
    ].join('\n')
  },
  'plan-memo': {
    defaultFileName: 'plan-memo.md',
    body: [
      '# 企画メモ',
      '',
      '## 背景',
      '',
      '',
      '',
      '## 目的 / ゴール',
      '',
      '- ',
      '',
      '## 案',
      '',
      '1. ',
      '',
      '## リスク / 懸念',
      '',
      '- ',
      '',
      '## 次にやること',
      '',
      '- [ ] ',
      ''
    ].join('\n')
  },
  'data-memo': {
    defaultFileName: 'data-memo.md',
    body: [
      '# データメモ',
      '',
      '## データ源',
      '',
      '- ファイル / パス:',
      '- 取得日:',
      '',
      '## スキーマ概要',
      '',
      '| 列 / キー | 型 | 説明 |',
      '| --- | --- | --- |',
      '|  |  |  |',
      '',
      '## 品質メモ',
      '',
      '- 欠損:',
      '- 重複:',
      '- 注意点:',
      '',
      '## 結論 / 仮説',
      '',
      '- ',
      ''
    ].join('\n')
  }
}

const TEMPLATES_EN: Record<BuiltinDocTemplateId, Omit<DocTemplate, 'id' | 'labelKey' | 'source'>> = {
  'meeting-notes': {
    defaultFileName: 'meeting-notes.md',
    body: [
      '# Meeting notes',
      '',
      '- Date:',
      '- Place:',
      '- Attendees:',
      '',
      '## Agenda',
      '',
      '1.',
      '',
      '## Discussion',
      '',
      '- ',
      '',
      '## Decisions',
      '',
      '- ',
      '',
      '## Next actions',
      '',
      '| Owner | Action | Due |',
      '| --- | --- | --- |',
      '|  |  |  |',
      ''
    ].join('\n')
  },
  procedure: {
    defaultFileName: 'procedure.md',
    body: [
      '# Procedure',
      '',
      '## Purpose',
      '',
      '',
      '',
      '## Prerequisites',
      '',
      '- ',
      '',
      '## Steps',
      '',
      '1. ',
      '2. ',
      '3. ',
      '',
      '## Checks',
      '',
      '- ',
      '',
      '## Troubleshooting',
      '',
      '| Symptom | Fix |',
      '| --- | --- |',
      '|  |  |',
      ''
    ].join('\n')
  },
  'plan-memo': {
    defaultFileName: 'plan-memo.md',
    body: [
      '# Plan memo',
      '',
      '## Background',
      '',
      '',
      '',
      '## Goal',
      '',
      '- ',
      '',
      '## Options',
      '',
      '1. ',
      '',
      '## Risks',
      '',
      '- ',
      '',
      '## Next steps',
      '',
      '- [ ] ',
      ''
    ].join('\n')
  },
  'data-memo': {
    defaultFileName: 'data-memo.md',
    body: [
      '# Data memo',
      '',
      '## Source',
      '',
      '- File / path:',
      '- Retrieved:',
      '',
      '## Schema',
      '',
      '| Column / key | Type | Notes |',
      '| --- | --- | --- |',
      '|  |  |  |',
      '',
      '## Quality notes',
      '',
      '- Missing:',
      '- Duplicates:',
      '- Caveats:',
      '',
      '## Conclusion / hypothesis',
      '',
      '- ',
      ''
    ].join('\n')
  }
}

const LABEL_KEYS: Record<BuiltinDocTemplateId, NonNullable<DocTemplate['labelKey']>> = {
  'meeting-notes': 'template.meetingNotes',
  procedure: 'template.procedure',
  'plan-memo': 'template.planMemo',
  'data-memo': 'template.dataMemo'
}

export const DOC_TEMPLATE_IDS: BuiltinDocTemplateId[] = [
  'meeting-notes',
  'procedure',
  'plan-memo',
  'data-memo'
]

const BUILTIN_ID_SET = new Set<string>(DOC_TEMPLATE_IDS)
const BUILTIN_ORDER_STEP = 100
const EXTRA_ORDER_BASE = 10_000

export function isBuiltinDocTemplateId(id: string): id is BuiltinDocTemplateId {
  return BUILTIN_ID_SET.has(id)
}

export function getDocTemplate(
  id: BuiltinDocTemplateId,
  locale: LocaleId = DEFAULT_LOCALE
): DocTemplate {
  const table = locale === 'en' ? TEMPLATES_EN : TEMPLATES_JA
  const entry = table[id]
  const builtinIndex = DOC_TEMPLATE_IDS.indexOf(id)
  return {
    id,
    labelKey: LABEL_KEYS[id],
    defaultFileName: entry.defaultFileName,
    body: entry.body,
    source: 'builtin',
    order: builtinIndex * BUILTIN_ORDER_STEP
  }
}

export function listDocTemplates(locale: LocaleId = DEFAULT_LOCALE): DocTemplate[] {
  return DOC_TEMPLATE_IDS.map((id) => getDocTemplate(id, locale))
}

/** 先頭の ATX 見出し `# Title` をラベルにする。無ければ null */
export function extractTemplateLabelFromBody(body: string): string | null {
  for (const line of body.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const match = /^#\s+(.+)$/.exec(trimmed)
    if (match) {
      const label = match[1].trim()
      return label.length > 0 ? label : null
    }
    // 最初の非空行が見出しでなければ諦める
    break
  }
  return null
}

export function templateIdFromFileName(fileName: string): string {
  const base = basename(fileName)
  return base.replace(/\.md$/i, '')
}

export function normalizeTemplateFileName(name: string): string {
  const base = basename(name.trim() || 'untitled.md')
  if (/\.md$/i.test(base)) return base
  return `${base}.md`
}

/** 表示名・ファイル名から安定したテンプレート ID を作る */
export function slugifyTemplateId(raw: string): string {
  const base = templateIdFromFileName(normalizeTemplateFileName(raw))
  const slug = base
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
  return slug || 'template'
}

export function ensureUniqueTemplateId(preferredId: string, existingIds: Iterable<string>): string {
  const existing = new Set([...existingIds].map((id) => id.toLowerCase()))
  const base = slugifyTemplateId(preferredId)
  if (!existing.has(base)) return base
  for (let i = 2; i < 1000; i++) {
    const candidate = `${base}-${i}`
    if (!existing.has(candidate)) return candidate
  }
  return `${base}-${Date.now()}`
}

function unquoteYamlScalar(raw: string): string {
  const value = raw.trim()
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1)
  }
  return value
}

function quoteYamlScalar(value: string): string {
  if (value === '' || /[:#{}[\],&*?|>!%@`"'\\]/.test(value) || /^\s|\s$/.test(value)) {
    return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
  }
  return value
}

export function parseTemplateFrontmatter(raw: string): {
  meta: { label?: string; fileName?: string; order?: number }
  body: string
} {
  const text = raw.replace(/^\uFEFF/, '')
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text)
  if (!match) return { meta: {}, body: raw }

  const meta: { label?: string; fileName?: string; order?: number } = {}
  for (const line of match[1].split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const sep = trimmed.indexOf(':')
    if (sep <= 0) continue
    const key = trimmed.slice(0, sep).trim()
    const value = unquoteYamlScalar(trimmed.slice(sep + 1))
    if (key === 'label' && value) meta.label = value
    if ((key === 'fileName' || key === 'filename') && value) {
      meta.fileName = normalizeTemplateFileName(value)
    }
    if (key === 'order') {
      const n = Number(value)
      if (Number.isFinite(n)) meta.order = n
    }
  }

  return { meta, body: match[2].replace(/^\r?\n/, '') }
}

export function serializeWorkspaceTemplateMarkdown(draft: WorkspaceTemplateDraft): string {
  const fileName = normalizeTemplateFileName(draft.defaultFileName)
  const frontmatter = [
    '---',
    `label: ${quoteYamlScalar(draft.label.trim() || draft.id)}`,
    `fileName: ${quoteYamlScalar(fileName)}`,
    `order: ${draft.order}`,
    '---',
    ''
  ].join('\n')
  const body = draft.body.replace(/^\uFEFF/, '')
  return frontmatter + body
}

export function workspaceTemplateFromMarkdown(
  fileName: string,
  raw: string,
  storagePath?: string
): DocTemplate | null {
  if (!/\.md$/i.test(fileName)) return null
  const id = templateIdFromFileName(fileName)
  if (!id) return null

  const { meta, body } = parseTemplateFrontmatter(raw)
  const label = meta.label ?? extractTemplateLabelFromBody(body) ?? id
  const defaultFileName = meta.fileName ?? `${id}.md`

  return {
    id,
    defaultFileName: normalizeTemplateFileName(defaultFileName),
    label,
    body,
    source: 'workspace',
    order: meta.order,
    storagePath
  }
}

function resolveOrder(template: DocTemplate, fallbackIndex: number): number {
  if (typeof template.order === 'number' && Number.isFinite(template.order)) {
    return template.order
  }
  if (isBuiltinDocTemplateId(template.id)) {
    return DOC_TEMPLATE_IDS.indexOf(template.id) * BUILTIN_ORDER_STEP
  }
  return EXTRA_ORDER_BASE + fallbackIndex
}

function sortTemplatesByOrder(templates: DocTemplate[]): DocTemplate[] {
  return templates
    .map((template, index) => ({
      ...template,
      order: resolveOrder(template, index)
    }))
    .sort((a, b) => {
      const orderDiff = (a.order ?? 0) - (b.order ?? 0)
      if (orderDiff !== 0) return orderDiff
      return a.id.localeCompare(b.id)
    })
}

/**
 * 内蔵をベースに、同 ID のワークスペーステンプレで上書きし、追加分を合流して order で並べる。
 */
export function mergeDocTemplates(
  builtins: DocTemplate[],
  workspaceTemplates: DocTemplate[]
): DocTemplate[] {
  const byId = new Map<string, DocTemplate>()
  for (const item of builtins) {
    byId.set(item.id, item)
  }

  for (const item of workspaceTemplates) {
    const previous = byId.get(item.id)
    if (previous) {
      byId.set(item.id, {
        ...item,
        // ワークスペース上書きでも order 未指定なら内蔵の既定順を維持
        order: item.order ?? previous.order
      })
    } else {
      byId.set(item.id, item)
    }
  }

  return sortTemplatesByOrder([...byId.values()])
}

export interface DocTemplateFs {
  readDir: (dirPath: string) => Promise<FileTreeNode[]>
  readFile: (filePath: string) => Promise<DecodedFileContent>
}

/** `.compass/templates/` 直下の `.md` のみ（サブフォルダは見ない） */
export async function loadWorkspaceDocTemplates(
  workspaceRoot: string,
  fs: DocTemplateFs
): Promise<DocTemplate[]> {
  const dir = join(workspaceRoot, WORKSPACE_TEMPLATES_DIR)
  let nodes: FileTreeNode[]
  try {
    nodes = await fs.readDir(dir)
  } catch {
    return []
  }

  const markdownFiles = nodes
    .filter((node) => !node.isDirectory && /\.md$/i.test(node.name))
    .sort((a, b) => a.name.localeCompare(b.name))

  const templates: DocTemplate[] = []
  for (const file of markdownFiles) {
    try {
      const { content } = await fs.readFile(file.path)
      const parsed = workspaceTemplateFromMarkdown(file.name, content, file.path)
      if (parsed) templates.push(parsed)
    } catch {
      // 読めないファイルはスキップ
    }
  }
  return templates
}

/** 内蔵 + ワークスペース `.compass/templates/` をマージした一覧 */
export async function listEffectiveDocTemplates(
  workspaceRoot: string | null | undefined,
  locale: LocaleId = DEFAULT_LOCALE,
  fs?: DocTemplateFs
): Promise<DocTemplate[]> {
  const builtins = listDocTemplates(locale)
  if (!workspaceRoot) return builtins

  const reader =
    fs ??
    ({
      readDir: (dirPath) => window.compass.fs.readDir(dirPath),
      readFile: (filePath) => window.compass.fs.readFile(filePath)
    } satisfies DocTemplateFs)

  const workspaceTemplates = await loadWorkspaceDocTemplates(workspaceRoot, reader)
  return mergeDocTemplates(builtins, workspaceTemplates)
}

export function templateStoragePath(workspaceRoot: string, id: string): string {
  return join(workspaceRoot, WORKSPACE_TEMPLATES_DIR, `${id}.md`)
}

export function workspaceTemplateRelativePath(id: string): string {
  return `${WORKSPACE_TEMPLATES_DIR}/${id}.md`.replace(/\\/g, '/')
}

/** 管理 UI の下書きを `.compass/templates/` に保存し、不要ファイルを削除する */
export function buildSaveTemplateActions(
  drafts: WorkspaceTemplateDraft[],
  previousWorkspaceIds: Iterable<string>
): WorkspaceAction[] {
  const keepIds = new Set(drafts.map((draft) => draft.id))
  const actions: WorkspaceAction[] = [{ type: 'mkdir', path: WORKSPACE_TEMPLATES_DIR }]

  for (const draft of drafts) {
    actions.push({
      type: 'writeFile',
      path: workspaceTemplateRelativePath(draft.id),
      content: serializeWorkspaceTemplateMarkdown(draft)
    })
  }

  for (const id of previousWorkspaceIds) {
    if (!keepIds.has(id)) {
      actions.push({
        type: 'deleteFile',
        path: workspaceTemplateRelativePath(id)
      })
    }
  }

  return actions
}

export function draftsFromEffectiveTemplates(
  templates: DocTemplate[],
  resolveLabel: (template: DocTemplate) => string
): WorkspaceTemplateDraft[] {
  return templates.map((template, index) => ({
    id: template.id,
    label: resolveLabel(template),
    defaultFileName: normalizeTemplateFileName(template.defaultFileName),
    body: template.body,
    order: resolveOrder(template, index)
  }))
}

export function reindexDraftOrders(drafts: WorkspaceTemplateDraft[]): WorkspaceTemplateDraft[] {
  return drafts.map((draft, index) => ({
    ...draft,
    order: index * BUILTIN_ORDER_STEP
  }))
}

/** `meeting-notes.md`, `meeting-notes-2.md`, ... */
export function buildUniqueTemplateFileName(
  preferredName: string,
  existingNames: Iterable<string>
): string {
  return buildUniqueFileName(preferredName, existingNames)
}
