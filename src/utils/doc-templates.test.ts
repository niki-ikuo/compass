import { describe, expect, it, vi } from 'vitest'
import type { FileTreeNode } from '@/types'
import {
  buildUniqueTemplateFileName,
  DOC_TEMPLATE_IDS,
  extractTemplateLabelFromBody,
  getDocTemplate,
  listDocTemplates,
  listEffectiveDocTemplates,
  loadWorkspaceDocTemplates,
  mergeDocTemplates,
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
      source: 'workspace'
    })
    expect(templateIdFromFileName('Meeting-Notes.md')).toBe('Meeting-Notes')
  })

  it('merges workspace overrides and appends extras', () => {
    const builtins = listDocTemplates('ja')
    const override = workspaceTemplateFromMarkdown(
      'meeting-notes.md',
      '# 社内議事録\n\n- 日時:\n'
    )!
    const extra = workspaceTemplateFromMarkdown('weekly.md', '# 週次\n')!
    const merged = mergeDocTemplates(builtins, [extra, override])

    expect(merged).toHaveLength(5)
    expect(merged[0]).toMatchObject({
      id: 'meeting-notes',
      source: 'workspace',
      label: '社内議事録',
      body: expect.stringContaining('# 社内議事録')
    })
    expect(merged[4]).toMatchObject({ id: 'weekly', label: '週次' })
  })

  it('loads workspace templates from templates/ and merges', async () => {
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
    expect(fs.readDir).toHaveBeenCalledWith(`/ws/${WORKSPACE_TEMPLATES_DIR}`)

    const effective = await listEffectiveDocTemplates('/ws', 'ja', fs)
    expect(effective).toHaveLength(5)
    expect(effective[0].body).toContain('# 上書き議事録')
    expect(effective.find((t) => t.id === 'incident')?.label).toBe('インシデント')
  })

  it('falls back to builtins when templates/ is missing', async () => {
    const fs = {
      readDir: vi.fn(async () => {
        throw new Error('ENOENT')
      }),
      readFile: vi.fn()
    }
    const list = await listEffectiveDocTemplates('/ws', 'en', fs)
    expect(list).toHaveLength(4)
    expect(list.every((t) => t.source === 'builtin')).toBe(true)
  })
})
