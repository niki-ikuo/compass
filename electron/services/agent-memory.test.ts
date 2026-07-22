import { describe, expect, it } from 'vitest'
import {
  applyRemember,
  createAgentMemoryState,
  formatAgentMemoryForModel,
  rebuildMemoryFromSteps,
  recordToolObservation
} from './agent-memory'

describe('applyRemember', () => {
  it('stores a durable note', () => {
    const state = createAgentMemoryState()
    const result = applyRemember(state, {
      note: 'Bug is in resolvePath when cwd is Windows-style',
      path: 'electron/services/agent-paths.ts'
    })

    expect(result.ok).toBe(true)
    expect(state.entries).toHaveLength(1)
    expect(state.entries[0].kind).toBe('note')
    expect(state.entries[0].path).toBe('electron/services/agent-paths.ts')
    expect(formatAgentMemoryForModel(state)).toContain('Bug is in resolvePath')
  })

  it('rejects empty notes', () => {
    const state = createAgentMemoryState()
    expect(applyRemember(state, { note: '  ' }).ok).toBe(false)
    expect(state.entries).toHaveLength(0)
  })
})

describe('recordToolObservation', () => {
  it('upserts readFile notes by path', () => {
    const state = createAgentMemoryState()
    recordToolObservation(
      state,
      'readFile',
      { path: 'src/foo.ts' },
      {
        ok: true,
        summary: 'Read src/foo.ts (120 chars)',
        content: '# src/foo.ts\nexport function bar() {}\n'
      }
    )
    recordToolObservation(
      state,
      'readFile',
      { path: 'src/foo.ts' },
      {
        ok: true,
        summary: 'Read src/foo.ts (200 chars)',
        content: '# src/foo.ts\nOutline: bar()@L2\nexport function bar() {}\nexport class Baz {}\n'
      }
    )

    expect(state.entries.filter((e) => e.kind === 'read')).toHaveLength(1)
    expect(state.entries[0].text).toContain('Read src/foo.ts')
  })

  it('records search hits', () => {
    const state = createAgentMemoryState()
    recordToolObservation(
      state,
      'search',
      { query: 'AgentMemory' },
      {
        ok: true,
        summary: '2 matches in 1 files',
        content: '## electron/services/agent-memory.ts\n1: ...'
      }
    )
    expect(state.entries[0].kind).toBe('search')
    expect(state.entries[0].text).toContain('AgentMemory')
    expect(state.entries[0].text).toContain('agent-memory.ts')
  })

  it('skips failed tools', () => {
    const state = createAgentMemoryState()
    recordToolObservation(
      state,
      'readFile',
      { path: 'missing.ts' },
      { ok: false, summary: 'ENOENT', content: 'Error: ENOENT' }
    )
    expect(state.entries).toHaveLength(0)
  })
})

describe('rebuildMemoryFromSteps', () => {
  it('replays remember and tool summaries', () => {
    const state = rebuildMemoryFromSteps([
      {
        name: 'readFile',
        args: { path: 'a.ts' },
        ok: true,
        status: 'done',
        summary: 'Read a.ts (10 chars)',
        observation: '# a.ts\nexport const x = 1\n'
      },
      {
        name: 'remember',
        args: { note: 'x is the config flag' },
        ok: true,
        status: 'done'
      }
    ])

    expect(state.entries.some((e) => e.kind === 'read')).toBe(true)
    expect(state.entries.some((e) => e.kind === 'note' && e.text.includes('config flag'))).toBe(
      true
    )
  })

  it('replays profileData and queryData summaries', () => {
    const state = rebuildMemoryFromSteps([
      {
        name: 'profileData',
        args: { path: 'sales.csv' },
        ok: true,
        status: 'done',
        summary: 'sales: 3 rows × 2 cols'
      },
      {
        name: 'queryData',
        args: { path: 'sales.csv', sql: 'SELECT COUNT(*) FROM t' },
        ok: true,
        status: 'done',
        summary: '1 row(s)'
      }
    ])

    expect(state.entries.some((e) => e.kind === 'read' && e.text.includes('profileData'))).toBe(
      true
    )
    expect(state.entries.some((e) => e.kind === 'search' && e.text.includes('queryData'))).toBe(
      true
    )
  })
})
