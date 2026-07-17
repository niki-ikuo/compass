import type { LocaleId } from '@/i18n'
import { DEFAULT_LOCALE } from '@/i18n'
import { buildUniqueFileName } from '@/utils/unique-file-name'

export type DocTemplateId = 'meeting-notes' | 'procedure' | 'plan-memo' | 'data-memo'

export interface DocTemplate {
  id: DocTemplateId
  /** 既定ファイル名（.md 付き） */
  defaultFileName: string
  /** i18n ラベルキー */
  labelKey:
    | 'template.meetingNotes'
    | 'template.procedure'
    | 'template.planMemo'
    | 'template.dataMemo'
  body: string
}

const TEMPLATES_JA: Record<DocTemplateId, Omit<DocTemplate, 'id' | 'labelKey'>> = {
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

const TEMPLATES_EN: Record<DocTemplateId, Omit<DocTemplate, 'id' | 'labelKey'>> = {
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

const LABEL_KEYS: Record<DocTemplateId, DocTemplate['labelKey']> = {
  'meeting-notes': 'template.meetingNotes',
  procedure: 'template.procedure',
  'plan-memo': 'template.planMemo',
  'data-memo': 'template.dataMemo'
}

export const DOC_TEMPLATE_IDS: DocTemplateId[] = [
  'meeting-notes',
  'procedure',
  'plan-memo',
  'data-memo'
]

export function getDocTemplate(
  id: DocTemplateId,
  locale: LocaleId = DEFAULT_LOCALE
): DocTemplate {
  const table = locale === 'en' ? TEMPLATES_EN : TEMPLATES_JA
  const entry = table[id]
  return {
    id,
    labelKey: LABEL_KEYS[id],
    defaultFileName: entry.defaultFileName,
    body: entry.body
  }
}

export function listDocTemplates(locale: LocaleId = DEFAULT_LOCALE): DocTemplate[] {
  return DOC_TEMPLATE_IDS.map((id) => getDocTemplate(id, locale))
}

/** `meeting-notes.md`, `meeting-notes-2.md`, ... */
export function buildUniqueTemplateFileName(
  preferredName: string,
  existingNames: Iterable<string>
): string {
  return buildUniqueFileName(preferredName, existingNames)
}
