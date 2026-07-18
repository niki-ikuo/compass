import { describe, expect, it, vi } from 'vitest'
import type { FileTreeNode } from '@/types'
import {
  buildSaveTemplateActions,
  buildUniqueTemplateFileName,
  DOC_TEMPLATE_IDS,
  draftsFromEffectiveTemplates,
  ensureUniqueTemplateId,
  extractTemplateLabelFromBody,
  getDocTemplate,
  listDocTemplates,
  listEffectiveDocTemplates,
  loadWorkspaceDocTemplates,
  mergeDocTemplates,
  normalizeTemplateFileName,
  parseTemplateFrontmatter,
  reindexDraftOrders,
  serializeWorkspaceTemplateMarkdown,
  slugifyTemplateId,
  templateIdFromFileName,
  workspaceTemplateFromMarkdown,
  WORKSPACE_TEMPLATES_DIR
} from '@/utils/doc-templates'

describe('doc-templates', () => {
  it('lists four built-in templates for ja and en', () => {
    expect(listDocTemplates('ja')).toHaveLength(4)
    expect(listDocTemplates('en')).toHaveLength(4)
    expect(DOC_TEMPLATE_IDS).toContain('meeting-notes')
    expect(listDocTemplates('ja')[0].source).toBe('builtin')
  })

  it('returns localized markdown bodies', () => {
    expect(getDocTemplate('meeting-notes', 'ja').body).toContain('# 議事録')
    expect(getDocTemplate('meeting-notes', 'en').body).toContain('# Meeting notes')
    expect(getDocTemplate('procedure', 'ja').body).toContain('## 手順')
    expect(getDocTemplate('data-memo', 'en').body).toContain('## Schema')
  })

  it('builds unique file names', () => {
    expect(buildUniqueTemplateFileName('meeting-notes.md', [])).toBe('meeting-notes.md')
    expect(
      buildUniqueTemplateFileName('meeting-notes.md', ['meeting-notes.md', 'Meeting-Notes-2.md'])
    ).toBe('meeting-notes-3.md')
  })

  it('extracts label from first ATX heading', () => {
    expect(extractTemplateLabelFromBody('# 週次レポート\n\n本文')).toBe('週次レポート')
    expect(extractTemplateLabelFromBody('本文だけ')).toBeNull()
    expect(extractTemplateLabelFromBody('## 見出し2のみ')).toBeNull()
  })

  it('parses workspace markdown into a template', () => {
    const parsed = workspaceTemplateFromMarkdown(
      'weekly-report.md',
      '# 週次レポート\n\n- 進捗:\n'
    )
    expect(parsed).toEqual({
      id: 'weekly-report',
      defaultFileName: 'weekly-report.md',
      label: '週次レポート',
      body: '# 週次レポート\n\n- 進捗:\n',
      source: 'workspace',
      order: undefined,
      storagePath: undefined
    })
    expect(templateIdFromFileName('Meeting-Notes.md')).toBe('Meeting-Notes')
  })

  it('parses and serializes frontmatter metadata', () => {
    const raw = [
      '---',
      'label: 週次レポート',
      'fileName: weekly.md',
      'order: 50',
      '---',
      '',
      '# body',
      ''
    ].join('\n')

    const parsed = workspaceTemplateFromMarkdown('weekly-report.md', raw, '/ws/.compass/templates/weekly-report.md')
    expect(parsed).toMatchObject({
      id: 'weekly-report',
      label: '週次レポート',
      defaultFileName: 'weekly.md',
      body: '# body\n',
      order: 50,
      storagePath: '/ws/.compass/templates/weekly-report.md'
    })

    const serialized = serializeWorkspaceTemplateMarkdown({
      id: 'weekly-report',
      label: '週次レポート',
      defaultFileName: 'weekly.md',
      body: '# body\n',
      order: 50
    })
    expect(parseTemplateFrontmatter(serialized).meta).toEqual({
      label: '週次レポート',
      fileName: 'weekly.md',
      order: 50
    })
    expect(parseTemplateFrontmatter(serialized).body).toBe('# body\n')
  })

  it('merges workspace overrides and sorts by order', () => {
    const builtins = listDocTemplates('ja')
    const override = workspaceTemplateFromMarkdown(
      'meeting-notes.md',
      ['---', 'label: 社内議事録', 'fileName: notes.md', 'order: 250', '---', '', '# 社内議事録', ''].join(
        '\n'
      )
    )!
    const extra = workspaceTemplateFromMarkdown(
      'weekly.md',
      ['---', 'label: 週次', 'order: 50', '---', '', '# 週次', ''].join('\n')
    )!
    const merged = mergeDocTemplates(builtins, [extra, override])

    expect(merged.map((item) => item.id)).toEqual([
      'weekly',
      'procedure',
      'plan-memo',
      'meeting-notes',
      'data-memo'
    ])
    expect(merged.find((item) => item.id === 'meeting-notes')).toMatchObject({
      source: 'workspace',
      label: '社内議事録',
      defaultFileName: 'notes.md'
    })
  })

  it('loads workspace templates from .compass/templates/ and merges', async () => {
    const nodes: FileTreeNode[] = [
      {
        name: 'meeting-notes.md',
        path: `/ws/${WORKSPACE_TEMPLATES_DIR}/meeting-notes.md`,
        isDirectory: false
      },
      {
        name: 'incident.md',
        path: `/ws/${WORKSPACE_TEMPLATES_DIR}/incident.md`,
        isDirectory: false
      },
      {
        name: 'nested',
        path: `/ws/${WORKSPACE_TEMPLATES_DIR}/nested`,
        isDirectory: true,
        children: []
      }
    ]
    const fs = {
      readDir: vi.fn(async () => nodes),
      readFile: vi.fn(async (filePath: string) => {
        if (filePath.endsWith('meeting-notes.md')) {
          return { content: '# 上書き議事録\n', encoding: 'utf8' as const }
        }
        return { content: '# インシデント\n', encoding: 'utf8' as const }
      })
    }

    const workspace = await loadWorkspaceDocTemplates('/ws', fs)
    expect(workspace).toHaveLength(2)
    expect(fs.readDir).toHaveBeenCalledWith(`/ws/${WORKSPACE_TEMPLATES_DIR}`, {
      missingOk: true
    })

    const effective = await listEffectiveDocTemplates('/ws', 'ja', fs)
    expect(effective).toHaveLength(5)
    expect(effective.find((t) => t.id === 'meeting-notes')?.body).toContain('# 上書き議事録')
    expect(effective.find((t) => t.id === 'incident')?.label).toBe('インシデント')
  })

  it('falls back to builtins when .compass/templates/ is missing', async () => {
    const fs = {
      readDir: vi.fn(async () => []),
      readFile: vi.fn()
    }
    const list = await listEffectiveDocTemplates('/ws', 'en', fs)
    expect(fs.readDir).toHaveBeenCalledWith(`/ws/${WORKSPACE_TEMPLATES_DIR}`, {
      missingOk: true
    })
    expect(list).toHaveLength(4)
    expect(list.every((t) => t.source === 'builtin')).toBe(true)
  })

  it('builds save actions for drafts and deletions', () => {
    const actions = buildSaveTemplateActions(
      [
        {
          id: 'weekly',
          label: '週次',
          defaultFileName: 'weekly.md',
          body: '# 週次\n',
          order: 0
        }
      ],
      ['weekly', 'old']
    )

    expect(actions[0]).toEqual({ type: 'mkdir', path: WORKSPACE_TEMPLATES_DIR })
    const write = actions.find((action) => action.type === 'writeFile')
    expect(write).toMatchObject({
      type: 'writeFile',
      path: `${WORKSPACE_TEMPLATES_DIR}/weekly.md`
    })
    if (write?.type === 'writeFile') {
      expect(write.content).toContain('label: 週次')
      expect(write.content).toContain('# 週次')
    }
    expect(actions).toContainEqual({
      type: 'deleteFile',
      path: `${WORKSPACE_TEMPLATES_DIR}/old.md`
    })
  })

  it('helps draft management helpers', () => {
    expect(normalizeTemplateFileName('note')).toBe('note.md')
    expect(slugifyTemplateId('週次 レポート.md')).toBe('template')
    expect(ensureUniqueTemplateId('weekly', ['weekly', 'weekly-2'])).toBe('weekly-3')
    const drafts = draftsFromEffectiveTemplates(listDocTemplates('en'), (t) => t.id)
    expect(reindexDraftOrders(drafts.map((d) => ({ ...d, order: 999 }))).map((d) => d.order)).toEqual([
      0, 100, 200, 300
    ])
  })
})
