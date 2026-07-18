import { describe, expect, it } from 'vitest'
import {
  extractCsvSchema,
  extractDataSchema,
  extractJsonSchema,
  extractYamlSchema,
  formatDataSchemaBrief,
  isDataIndexPath
} from '@/utils/data-outline'

describe('isDataIndexPath', () => {
  it('accepts csv/tsv/yaml and data-like json', () => {
    expect(isDataIndexPath('data/sales.csv')).toBe(true)
    expect(isDataIndexPath('rows.tsv')).toBe(true)
    expect(isDataIndexPath('config.yaml')).toBe(true)
    expect(isDataIndexPath('users.json')).toBe(true)
  })

  it('rejects common config json', () => {
    expect(isDataIndexPath('package.json')).toBe(false)
    expect(isDataIndexPath('tsconfig.json')).toBe(false)
    expect(isDataIndexPath('apps/web/tsconfig.app.json')).toBe(false)
    expect(isDataIndexPath('.eslintrc.json')).toBe(false)
  })
})

describe('extractCsvSchema', () => {
  it('reads columns, row count, and types', () => {
    const schema = extractCsvSchema('name,age,active\nAda,36,true\nBob,41,false\n')
    expect(schema?.kind).toBe('csv')
    expect(schema?.fields).toEqual(['name', 'age', 'active'])
    expect(schema?.rowCount).toBe(2)
    expect(schema?.fieldTypes?.age).toBe('integer')
    expect(schema?.fieldTypes?.active).toBe('boolean')
    expect(schema?.shape).toContain('columns[3]')
    expect(schema?.sample).toContain('Ada')
  })
})

describe('extractJsonSchema', () => {
  it('summarizes object arrays', () => {
    const schema = extractJsonSchema(
      JSON.stringify([
        { id: 1, name: 'a' },
        { id: 2, name: 'b', email: 'b@x.com' }
      ])
    )
    expect(schema?.kind).toBe('json')
    expect(schema?.rowCount).toBe(2)
    expect(schema?.fields).toEqual(expect.arrayContaining(['id', 'name', 'email']))
    expect(schema?.shape).toContain('array[2]')
  })

  it('summarizes plain objects', () => {
    const schema = extractJsonSchema(JSON.stringify({ host: 'localhost', port: 8080 }))
    expect(schema?.fields).toEqual(['host', 'port'])
    expect(schema?.fieldTypes?.port).toBe('number')
  })
})

describe('extractYamlSchema', () => {
  it('collects top-level keys', () => {
    const schema = extractYamlSchema('services:\n  api:\n    image: x\nvolumes:\n  data:\n')
    expect(schema?.fields).toEqual(['services', 'volumes'])
    expect(schema?.shape).toContain('yaml keys:')
  })
})

describe('extractDataSchema', () => {
  it('routes by extension and skips package.json', () => {
    expect(extractDataSchema('a.csv', 'a,b\n1,2\n')?.kind).toBe('csv')
    expect(extractDataSchema('package.json', '{"name":"x"}')).toBeNull()
  })
})

describe('formatDataSchemaBrief', () => {
  it('includes shape and types', () => {
    const brief = formatDataSchemaBrief({
      kind: 'csv',
      fields: ['a', 'b'],
      rowCount: 1,
      fieldTypes: { a: 'integer', b: 'string' },
      shape: 'csv columns[2]: a, b; rows: 1',
      sample: '1, x'
    })
    expect(brief).toContain('columns[2]')
    expect(brief).toContain('types: a:integer, b:string')
    expect(brief).toContain('sample: 1, x')
  })
})
