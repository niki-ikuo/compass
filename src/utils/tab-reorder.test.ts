import { describe, expect, it } from 'vitest'
import {
  moveItemByDropIndex,
  reorderOpenSessionsById,
  resolveTabDropIndex
} from './tab-reorder'

describe('resolveTabDropIndex', () => {
  it('uses left/right half of the tab', () => {
    expect(resolveTabDropIndex(10, 0, 100, 2)).toBe(2)
    expect(resolveTabDropIndex(60, 0, 100, 2)).toBe(3)
  })
})

describe('moveItemByDropIndex', () => {
  it('moves forward and backward', () => {
    expect(moveItemByDropIndex(['A', 'B', 'C', 'D'], 0, 3)).toEqual(['B', 'C', 'A', 'D'])
    expect(moveItemByDropIndex(['A', 'B', 'C', 'D'], 3, 1)).toEqual(['A', 'D', 'B', 'C'])
  })

  it('no-ops when drop stays in place', () => {
    const items = ['A', 'B', 'C']
    expect(moveItemByDropIndex(items, 1, 1)).toBe(items)
    expect(moveItemByDropIndex(items, 1, 2)).toBe(items)
  })
})

describe('reorderOpenSessionsById', () => {
  it('reorders only open sessions', () => {
    const sessions = [
      { id: 'a', isOpen: true },
      { id: 'b', isOpen: false },
      { id: 'c', isOpen: true },
      { id: 'd', isOpen: true }
    ]
    // open: a,c,d — move d before c (dropIndex 1)
    expect(reorderOpenSessionsById(sessions, 'd', 1).map((s) => s.id)).toEqual([
      'a',
      'b',
      'd',
      'c'
    ])
  })
})
