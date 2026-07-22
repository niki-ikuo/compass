import { describe, expect, it } from 'vitest'
import { verifyCsvContent, verifyJsonContent, verifyDataFile } from '@/utils/data-verify'

describe('verifyCsvContent', () => {
  it('accepts consistent columns', () => {
    expect(verifyCsvContent('a,b\n1,2\n3,4')).toEqual([])
  })

  it('flags column mismatches', () => {
    const issues = verifyCsvContent('a,b\n1,2,3')
    expect(issues[0]?.message).toMatch(/Row 2/)
  })
  it('flags duplicate first-column keys and mixed types', () => {
    const issues = verifyCsvContent('id,age\n1,10\n1,yes\n')
    expect(issues.some((i) => i.message.includes('Duplicate key'))).toBe(true)
    expect(issues.some((i) => i.message.includes('mixes types'))).toBe(true)
  })
})

describe('verifyJsonContent', () => {
  it('flags invalid JSON', () => {
    expect(verifyJsonContent('{').length).toBeGreaterThan(0)
  })

  it('flags missing common keys in object arrays', () => {
    const issues = verifyJsonContent(
      JSON.stringify([{ id: 1, name: 'a' }, { id: 2 }, { id: 3, name: 'c' }])
    )
    expect(issues.some((i) => i.message.includes('missing key'))).toBe(true)
  })

  it('flags duplicate ids', () => {
    const issues = verifyJsonContent(
      JSON.stringify([
        { id: 1, name: 'a' },
        { id: 1, name: 'b' }
      ])
    )
    expect(issues.some((i) => i.message.includes('Duplicate'))).toBe(true)
  })
})

describe('verifyDataFile', () => {
  it('routes by extension', () => {
    expect(verifyDataFile('x.csv', 'a\n1,2')[0]?.path).toBe('x.csv')
    expect(verifyDataFile('x.txt', 'a,b')).toEqual([])
  })

  it('verifies tsv column counts', () => {
    const issues = verifyDataFile('rows.tsv', 'a\tb\n1\n')
    expect(issues.some((i) => i.message.includes('column'))).toBe(true)
    expect(issues[0]?.path).toBe('rows.tsv')
  })
})
