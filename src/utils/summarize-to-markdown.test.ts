import { describe, expect, it } from 'vitest'
import { buildSummarizeToMarkdownRequest } from './summarize-to-markdown'

describe('buildSummarizeToMarkdownRequest', () => {
  it('builds edit/document send payload with sidecar path', () => {
    const request = buildSummarizeToMarkdownRequest(
      'C:/ws/docs/report.pdf',
      'C:/ws',
      ({ mention, sidecar }) => `${mention} -> ${sidecar}`
    )
    expect(request).not.toBeNull()
    expect(request!.mode).toBe('edit')
    expect(request!.preset).toBe('document')
    expect(request!.text).toBe('@[docs/report.pdf] -> docs/report.summary.md')
    expect(request!.contextRef.path).toBe('C:/ws/docs/report.pdf')
  })

  it('rejects non-extractable paths', () => {
    expect(
      buildSummarizeToMarkdownRequest('C:/ws/a.txt', 'C:/ws', () => 'x')
    ).toBeNull()
  })
})
