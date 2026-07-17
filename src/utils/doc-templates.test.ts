import { describe, expect, it } from 'vitest'
import {
  buildUniqueTemplateFileName,
  DOC_TEMPLATE_IDS,
  getDocTemplate,
  listDocTemplates
} from '@/utils/doc-templates'

describe('doc-templates', () => {
  it('lists four built-in templates for ja and en', () => {
    expect(listDocTemplates('ja')).toHaveLength(4)
    expect(listDocTemplates('en')).toHaveLength(4)
    expect(DOC_TEMPLATE_IDS).toContain('meeting-notes')
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
})
