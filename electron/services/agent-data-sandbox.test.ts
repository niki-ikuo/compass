import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { afterEach, describe, expect, it } from 'vitest'
import {
  createAgentDataSandbox,
  disposeAgentDataSandbox,
  profileDataFile,
  queryDataFiles,
  resolveSqlJsWasmPath
} from './agent-data-sandbox'

const roots: string[] = []

function makeRoot(name: string): string {
  const root = join(
    tmpdir(),
    `compass-data-sb-${name}-${Date.now()}-${Math.random().toString(36).slice(2)}`
  )
  mkdirSync(root, { recursive: true })
  roots.push(root)
  return root
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    try {
      rmSync(root, { recursive: true, force: true })
    } catch {
      // ignore
    }
  }
})

describe('resolveSqlJsWasmPath', () => {
  it('resolves an existing sql-wasm.wasm next to sql.js', () => {
    const wasmPath = resolveSqlJsWasmPath()
    expect(wasmPath.replace(/\\/g, '/')).toMatch(/sql-wasm\.wasm$/)
    expect(existsSync(wasmPath)).toBe(true)
    // Non-trivial binary (guards empty / missing file masquerading as ok)
    expect(readFileSync(wasmPath).byteLength).toBeGreaterThan(1000)
  })
})

describe('agent-data-sandbox', () => {
  it('profiles and queries a csv via SQLite', async () => {
    const root = makeRoot('csv')
    writeFileSync(
      join(root, 'sales.csv'),
      'category,amount\nfood,10\nfood,5\nbooks,20\n'
    )
    const sandbox = await createAgentDataSandbox()
    try {
      const profile = await profileDataFile(sandbox, root, 'sales.csv')
      expect(profile.ok).toBe(true)
      expect(profile.content).toContain('category:')
      expect(profile.summary).toMatch(/^imported sales ← sales\.csv \(3×2\)$/)

      const query = await queryDataFiles(sandbox, root, {
        path: 'sales.csv',
        sql: 'SELECT category, SUM(amount) AS total FROM t GROUP BY category ORDER BY total DESC'
      })
      expect(query.ok).toBe(true)
      expect(query.summary).toMatch(/^cached sales ← sales\.csv \(3×2\) · \d+ row\(s\)$/)
      expect(query.content).toContain('food')
      expect(query.content).toMatch(/15|20/)

      const profileAgain = await profileDataFile(sandbox, root, 'sales.csv')
      expect(profileAgain.ok).toBe(true)
      expect(profileAgain.summary).toMatch(/^cached sales ← sales\.csv \(3×2\)$/)
    } finally {
      disposeAgentDataSandbox(sandbox)
    }
  })

  it('rejects mutating sql', async () => {
    const root = makeRoot('deny')
    writeFileSync(join(root, 'a.csv'), 'id\n1\n')
    const sandbox = await createAgentDataSandbox()
    try {
      const result = await queryDataFiles(sandbox, root, {
        path: 'a.csv',
        sql: 'DELETE FROM t'
      })
      expect(result.ok).toBe(false)
      expect(result.content).toMatch(/read-only|SELECT/i)
    } finally {
      disposeAgentDataSandbox(sandbox)
    }
  })

  it('supports json arrays and joins by basename tables', async () => {
    const root = makeRoot('join')
    writeFileSync(
      join(root, 'users.json'),
      JSON.stringify([
        { id: 1, name: 'Ada' },
        { id: 2, name: 'Bob' }
      ])
    )
    writeFileSync(
      join(root, 'orders.csv'),
      'user_id,total\n1,100\n1,40\n2,10\n'
    )
    const sandbox = await createAgentDataSandbox()
    try {
      const result = await queryDataFiles(sandbox, root, {
        paths: ['users.json', 'orders.csv'],
        sql: 'SELECT u.name, SUM(o.total) AS spent FROM users u JOIN orders o ON u.id = o.user_id GROUP BY u.name ORDER BY spent DESC'
      })
      expect(result.ok).toBe(true)
      expect(result.summary).toMatch(/imported users ← users\.json \(2×2\)/)
      expect(result.summary).toMatch(/imported orders ← orders\.csv \(3×2\)/)
      expect(result.content).toContain('Ada')
      expect(result.content).toMatch(/140/)
    } finally {
      disposeAgentDataSandbox(sandbox)
    }
  })

  it('decodes Shift_JIS CSV the same way as the editor', async () => {
    const root = makeRoot('sjis')
    const iconv = (await import('iconv-lite')).default
    const csv = '名前,金額\n田中,100\n佐藤,200\n'
    writeFileSync(join(root, 'sales.csv'), iconv.encode(csv, 'CP932'))

    const sandbox = await createAgentDataSandbox()
    try {
      const profile = await profileDataFile(sandbox, root, 'sales.csv')
      expect(profile.ok).toBe(true)
      expect(profile.content).toContain('田中')
      expect(profile.content).not.toContain('\uFFFD')

      const query = await queryDataFiles(sandbox, root, {
        path: 'sales.csv',
        sql: 'SELECT * FROM t'
      })
      // Japanese headers become underscores via uniqueColumns; values must stay readable
      expect(query.ok).toBe(true)
      expect(query.content).toContain('田中')
      expect(query.content).toContain('佐藤')
      expect(query.content).not.toContain('\uFFFD')
    } finally {
      disposeAgentDataSandbox(sandbox)
    }
  })

  it('initializes SQLite via wasmBinary (packaging-safe path)', async () => {
    const sandbox = await createAgentDataSandbox()
    try {
      expect(sandbox.db).toBeTruthy()
      const result = sandbox.db.exec('SELECT 1 AS ok')
      expect(result[0]?.values?.[0]?.[0]).toBe(1)
    } finally {
      disposeAgentDataSandbox(sandbox)
    }
  })
})
