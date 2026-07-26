import { describe, expect, it } from 'vitest'
import {
  buildAskAcrossDataRequest,
  buildRerunDataQueryRequest,
  buildSaveDataResultRequest,
  isDataResultNotePath,
  parseDataResultFrontmatter,
  serializeDataResultMarkdown,
  sidecarDataResultCsvPath,
  sidecarDataResultMarkdownPath
} from './data-result'

describe('sidecar data result paths', () => {
  it('builds markdown and csv sidecars next to the source', () => {
    expect(sidecarDataResultMarkdownPath('data/sales.csv')).toBe('data/sales.result.md')
    expect(sidecarDataResultCsvPath('data/sales.csv')).toBe('data/sales.result.csv')
    expect(sidecarDataResultMarkdownPath('orders.json')).toBe('orders.result.md')
  })

  it('detects result note paths', () => {
    expect(isDataResultNotePath('data/sales.result.md')).toBe(true)
    expect(isDataResultNotePath('data/sales.csv')).toBe(false)
  })
})

describe('parseDataResultFrontmatter', () => {
  it('parses flat sources/sql/format', () => {
    const raw = serializeDataResultMarkdown(
      {
        sources: ['sales.csv', 'products.csv'],
        sql: 'SELECT * FROM sales LIMIT 5',
        format: 'markdown'
      },
      '# Result\n\nok\n'
    )
    const { meta, body } = parseDataResultFrontmatter(raw)
    expect(meta).toEqual({
      kind: 'data-result',
      sources: ['sales.csv', 'products.csv'],
      sql: 'SELECT * FROM sales LIMIT 5',
      format: 'markdown'
    })
    expect(body).toBe('# Result\n\nok\n')
  })

  it('parses block sql', () => {
    const raw = `---
kind: data-result
sources: a.csv
sql: |
  SELECT id
  FROM a
format: csv
---

table
`
    const { meta } = parseDataResultFrontmatter(raw)
    expect(meta?.sql).toBe('SELECT id\nFROM a')
    expect(meta?.format).toBe('csv')
  })

  it('returns null meta when kind is missing', () => {
    const { meta } = parseDataResultFrontmatter('---\nsources: a.csv\nsql: SELECT 1\n---\n')
    expect(meta).toBeNull()
  })
})

describe('buildSaveDataResultRequest', () => {
  it('builds agent/data send payload with sidecar paths', () => {
    const request = buildSaveDataResultRequest(
      ['C:/ws/data/sales.csv', 'C:/ws/data/products.json'],
      'C:/ws',
      ({ mentions, sidecarMd, sidecarCsv }) => `${mentions} -> ${sidecarMd} / ${sidecarCsv}`
    )
    expect(request).not.toBeNull()
    expect(request!.mode).toBe('agent')
    expect(request!.preset).toBe('data')
    expect(request!.text).toBe(
      '@[data/sales.csv] @[data/products.json] -> data/sales.result.md / data/sales.result.csv'
    )
    expect(request!.contextRefs).toHaveLength(2)
  })

  it('rejects non-tabular paths', () => {
    expect(
      buildSaveDataResultRequest(['C:/ws/notes.md'], 'C:/ws', () => 'x')
    ).toBeNull()
  })
})

describe('buildAskAcrossDataRequest', () => {
  it('builds multi-file ask payload', () => {
    const request = buildAskAcrossDataRequest(
      ['C:/ws/a.csv', 'C:/ws/b.csv'],
      'C:/ws',
      ({ mentions }) => `ask ${mentions}`
    )
    expect(request?.text).toBe('ask @[a.csv] @[b.csv]')
    expect(request?.mode).toBe('agent')
    expect(request?.preset).toBe('data')
  })
})

describe('buildRerunDataQueryRequest', () => {
  it('rebuilds agent request from a result note', () => {
    const note = serializeDataResultMarkdown(
      {
        sources: ['data/sales.csv'],
        sql: 'SELECT count(*) AS n FROM sales',
        format: 'markdown'
      },
      'n = 3\n'
    )
    const request = buildRerunDataQueryRequest(
      'C:/ws/data/sales.result.md',
      note,
      'C:/ws',
      ({ mention, sources, sql, sidecarMd, sidecarCsv }) =>
        `${mention}|${sources}|${sql}|${sidecarMd}|${sidecarCsv}`
    )
    expect(request).not.toBeNull()
    expect(request!.mode).toBe('agent')
    expect(request!.preset).toBe('data')
    expect(request!.text).toBe(
      '@[data/sales.result.md]|data/sales.csv|SELECT count(*) AS n FROM sales|data/sales.result.md|data/sales.result.csv'
    )
    expect(request!.contextRefs.map((r) => r.path)).toEqual([
      'C:/ws/data/sales.result.md',
      'C:/ws/data/sales.csv'
    ])
  })
})
