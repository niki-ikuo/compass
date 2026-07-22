import { describe, expect, it } from 'vitest'
import { parseDataTableRows, tableNameFromPath } from '@/utils/data-rows'
import { buildDataProfile, formatDataProfile } from '@/utils/data-profile'
import { assertSelectOnlySql } from '@/utils/data-sql-guard'

describe('tableNameFromPath', () => {
  it('sanitizes basename', () => {
    expect(tableNameFromPath('data/sales-2024.csv')).toBe('sales_2024')
    expect(tableNameFromPath('1bad.json')).toBe('t_1bad')
  })
})

describe('parseDataTableRows', () => {
  it('parses csv with coercion', () => {
    const table = parseDataTableRows(
      'sales.csv',
      'name,age,active\nAda,36,true\nBob,,false\n'
    )
    expect('error' in table).toBe(false)
    if ('error' in table) return
    expect(table.columns).toEqual(['name', 'age', 'active'])
    expect(table.rows).toEqual([
      ['Ada', 36, true],
      ['Bob', null, false]
    ])
  })

  it('parses json object arrays', () => {
    const table = parseDataTableRows(
      'users.json',
      JSON.stringify([
        { id: 1, name: 'Ada' },
        { id: 2, name: 'Bob', role: 'admin' }
      ])
    )
    expect('error' in table).toBe(false)
    if ('error' in table) return
    expect(table.columns).toEqual(['id', 'name', 'role'])
    expect(table.rows[1]).toEqual([2, 'Bob', 'admin'])
  })

  it('rejects yaml for tabular parse', () => {
    const table = parseDataTableRows('x.yaml', 'a: 1\n')
    expect(table).toMatchObject({ error: expect.stringContaining('YAML') })
  })
})

describe('buildDataProfile', () => {
  it('reports null rates and uniques', () => {
    const table = parseDataTableRows('t.csv', 'id,name\n1,Ada\n2,\n1,Ada\n')
    expect('error' in table).toBe(false)
    if ('error' in table) return
    const profile = buildDataProfile(table)
    expect(profile.rowCount).toBe(3)
    const nameCol = profile.columns.find((c) => c.name === 'name')
    expect(nameCol?.nullCount).toBe(1)
    expect(nameCol?.uniqueCount).toBe(1)
    expect(formatDataProfile(profile)).toContain('table: t')
  })
})

describe('assertSelectOnlySql', () => {
  it('allows select and with', () => {
    expect(assertSelectOnlySql('SELECT * FROM t LIMIT 5').ok).toBe(true)
    expect(assertSelectOnlySql('WITH x AS (SELECT 1) SELECT * FROM x').ok).toBe(true)
  })

  it('rejects writes and multi-statements', () => {
    expect(assertSelectOnlySql('DELETE FROM t').ok).toBe(false)
    expect(assertSelectOnlySql('SELECT 1; SELECT 2').ok).toBe(false)
    expect(assertSelectOnlySql('SELECT * INTO dest FROM t').ok).toBe(false)
  })

  it('allows replace() function but not REPLACE statement', () => {
    expect(assertSelectOnlySql(`SELECT replace(name, 'a', 'b') FROM t`).ok).toBe(true)
    expect(assertSelectOnlySql('REPLACE INTO t VALUES (1)').ok).toBe(false)
  })
})
