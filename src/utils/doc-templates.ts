import type { LocaleId } from '@/i18n'
import { DEFAULT_LOCALE } from '@/i18n'
import type { DecodedFileContent, FileTreeNode } from '@/types'
import { basename, join } from '@/utils/path'
import { buildUniqueFileName } from '@/utils/unique-file-name'

/** ワークスペース直下のテンプレートフォルダ（Git 共有・エクスプローラー編集向け） */
export const WORKSPACE_TEMPLATES_DIR = 'templates'

export type BuiltinDocTemplateId = 'meeting-notes' | 'procedure' | 'plan-memo' | 'data-memo'

/** 内蔵 ID、または `templates/*.md` のファイル名（拡張子なし） */
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
  /** ワークスペーステンプレの表示名（見出し or ファイル名） */
  label?: string
  body: string
  source: DocTemplateSource
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

export function isBuiltinDocTemplateId(id: string): id is BuiltinDocTemplateId {
  return BUILTIN_ID_SET.has(id)
}

export function getDocTemplate(
  id: BuiltinDocTemplateId,
  locale: LocaleId = DEFAULT_LOCALE
): DocTemplate {
  const table = locale === 'en' ? TEMPLATES_EN : TEMPLATES_JA
  const entry = table[id]
  return {
    id,
    labelKey: LABEL_KEYS[id],
    defaultFileName: entry.defaultFileName,
    body: entry.body,
    source: 'builtin'
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

export function workspaceTemplateFromMarkdown(
  fileName: string,
  body: string
): DocTemplate | null {
  if (!/\.md$/i.test(fileName)) return null
  const id = templateIdFromFileName(fileName)
  if (!id) return null
  const label = extractTemplateLabelFromBody(body) ?? id
  return {
    id,
    defaultFileName: `${id}.md`,
    label,
    body,
    source: 'workspace'
  }
}

/**
 * 内蔵をベースに、同 ID のワークスペーステンプレで上書きし、追加分を末尾に並べる。
 */
export function mergeDocTemplates(
  builtins: DocTemplate[],
  workspaceTemplates: DocTemplate[]
): DocTemplate[] {
  const byId = new Map<string, DocTemplate>()
  for (const item of builtins) {
    byId.set(item.id, item)
  }

  const extras: DocTemplate[] = []
  for (const item of workspaceTemplates) {
    if (byId.has(item.id)) {
      byId.set(item.id, item)
    } else {
      extras.push(item)
    }
  }

  const mergedBuiltins = DOC_TEMPLATE_IDS.map((id) => byId.get(id)).filter(
    (item): item is DocTemplate => item !== undefined
  )
  extras.sort((a, b) => a.id.localeCompare(b.id))
  return [...mergedBuiltins, ...extras]
}

export interface DocTemplateFs {
  readDir: (dirPath: string) => Promise<FileTreeNode[]>
  readFile: (filePath: string) => Promise<DecodedFileContent>
}

/** `templates/` 直下の `.md` のみ（サブフォルダは見ない） */
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
      const parsed = workspaceTemplateFromMarkdown(file.name, content)
      if (parsed) templates.push(parsed)
    } catch {
      // 読めないファイルはスキップ
    }
  }
  return templates
}

/** 内蔵 + ワークスペース `templates/` をマージした一覧 */
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

/** `meeting-notes.md`, `meeting-notes-2.md`, ... */
export function buildUniqueTemplateFileName(
  preferredName: string,
  existingNames: Iterable<string>
): string {
  return buildUniqueFileName(preferredName, existingNames)
}
