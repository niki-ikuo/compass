import { describe, expect, it } from 'vitest'
import {
  buildFileOutline,
  createAgentReadCache,
  formatCacheHit,
  getCachedRead,
  invalidateCachedPaths,
  putCachedRead
} from './agent-read-cache'

describe('buildFileOutline', () => {
  it('extracts TS symbols with line numbers', () => {
    const outline = buildFileOutline(
      'src/foo.ts',
      [
        'export function alpha() {}',
        'export class Beta {}',
        'interface Gamma {}',
        'type Delta = string'
      ].join('\n')
    )
    expect(outline).toContain('alpha()@L1')
    expect(outline).toContain('class Beta@L2')
    expect(outline).toContain('interface Gamma@L3')
    expect(outline).toContain('type Delta@L4')
  })

  it('extracts markdown headings', () => {
    const outline = buildFileOutline('README.md', '# Title\n\n## Section\n')
    expect(outline).toContain('# Title')
    expect(outline).toContain('# Section')
  })
})

describe('AgentReadCache', () => {
  it('stores and returns cache hits', () => {
    const cache = createAgentReadCache()
    putCachedRead(cache, {
      relativePath: 'src/a.ts',
      mtimeMs: 100,
      size: 50,
      charCount: 40,
      outline: 'foo()@L1',
      content: '# src/a.ts\n...'
    })

    const hit = getCachedRead(cache, './src/a.ts')
    expect(hit?.outline).toBe('foo()@L1')

    const formatted = formatCacheHit(hit!)
    expect(formatted.summary).toContain('Cached')
    expect(formatted.content).toContain('[cached')
    expect(formatted.content).toContain('force=true')
    expect(hit!.readCount).toBe(2)
  })

  it('invalidates paths after writes', () => {
    const cache = createAgentReadCache()
    putCachedRead(cache, {
      relativePath: 'src/a.ts',
      mtimeMs: 1,
      size: 1,
      charCount: 1,
      outline: '',
      content: 'x'
    })
    putCachedRead(cache, {
      relativePath: 'src/b.ts',
      mtimeMs: 1,
      size: 1,
      charCount: 1,
      outline: '',
      content: 'y'
    })
    invalidateCachedPaths(cache, ['src/a.ts'])
    expect(getCachedRead(cache, 'src/a.ts')).toBeUndefined()
    expect(getCachedRead(cache, 'src/b.ts')).toBeDefined()
  })
})
