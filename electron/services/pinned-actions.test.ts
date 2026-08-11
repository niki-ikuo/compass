import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { afterEach, describe, expect, it } from 'vitest'
import {
  createEmptyPinnedActions,
  loadPinnedActions,
  normalizePinnedActionsList,
  pickBarPinnedActions,
  savePinnedActions
} from './pinned-actions'

function makeTempRoot(name: string): string {
  const root = join(
    tmpdir(),
    `compass-pinned-actions-${name}-${Date.now()}-${Math.random().toString(36).slice(2)}`
  )
  mkdirSync(root, { recursive: true })
  return root
}

const tempRoots: string[] = []

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe('pinned-actions', () => {
  it('returns empty when file is missing', async () => {
    const root = makeTempRoot('missing')
    tempRoots.push(root)
    await expect(loadPinnedActions(root)).resolves.toEqual(createEmptyPinnedActions())
  })

  it('round-trips actions', async () => {
    const root = makeTempRoot('roundtrip')
    tempRoots.push(root)

    const saved = await savePinnedActions(root, {
      version: 1,
      actions: [
        {
          id: 'a1',
          label: '要約',
          prompt: 'この内容を要約してください',
          mode: 'ask',
          preset: 'document',
          pinned: true
        },
        {
          id: 'a2',
          label: '体裁',
          prompt: '体裁を整えて',
          mode: 'edit',
          pinned: false
        }
      ]
    })

    expect(saved.actions).toHaveLength(2)
    const loaded = await loadPinnedActions(root)
    expect(loaded).toEqual(saved)
  })

  it('drops invalid actions and caps pinned count', async () => {
    const root = makeTempRoot('invalid')
    tempRoots.push(root)
    mkdirSync(join(root, '.compass'), { recursive: true })
    writeFileSync(
      join(root, '.compass', 'pinned-actions.json'),
      JSON.stringify({
        version: 1,
        actions: [
          { id: '', label: 'bad', prompt: 'x', mode: 'ask', pinned: true },
          { id: 'ok', label: 'OK', prompt: 'hello', mode: 'weird', pinned: true },
          {
            id: 'p1',
            label: '1',
            prompt: 'p1',
            mode: 'ask',
            pinned: true
          },
          {
            id: 'p2',
            label: '2',
            prompt: 'p2',
            mode: 'ask',
            pinned: true
          },
          {
            id: 'p3',
            label: '3',
            prompt: 'p3',
            mode: 'ask',
            pinned: true
          },
          {
            id: 'p4',
            label: '4',
            prompt: 'p4',
            mode: 'ask',
            pinned: true
          },
          {
            id: 'p5',
            label: '5',
            prompt: 'p5',
            mode: 'ask',
            pinned: true
          },
          {
            id: 'p6',
            label: '6',
            prompt: 'p6',
            mode: 'ask',
            pinned: true
          }
        ]
      }),
      'utf-8'
    )

    const loaded = await loadPinnedActions(root)
    expect(loaded.actions.map((a) => a.id)).toEqual(['ok', 'p1', 'p2', 'p3', 'p4', 'p5', 'p6'])
    expect(loaded.actions[0].mode).toBe('ask')
    expect(pickBarPinnedActions(loaded.actions).map((a) => a.id)).toEqual([
      'ok',
      'p1',
      'p2',
      'p3',
      'p4'
    ])
    expect(loaded.actions.find((a) => a.id === 'p6')?.pinned).toBe(false)
  })

  it('writes normalized payload', async () => {
    const root = makeTempRoot('write')
    tempRoots.push(root)

    await savePinnedActions(root, {
      version: 1,
      actions: [
        {
          id: '  x  ',
          label: '  Label  ',
          prompt: '  Prompt  ',
          mode: 'ask',
          pinned: true
        }
      ]
    })

    const raw = JSON.parse(readFileSync(join(root, '.compass', 'pinned-actions.json'), 'utf-8'))
    expect(raw).toEqual({
      version: 1,
      actions: [
        {
          id: 'x',
          label: 'Label',
          prompt: 'Prompt',
          mode: 'ask',
          pinned: true
        }
      ]
    })
  })

  it('normalizePinnedActionsList unpins overflow', () => {
    const actions = Array.from({ length: 6 }, (_, i) => ({
      id: `a${i}`,
      label: `L${i}`,
      prompt: `P${i}`,
      mode: 'ask' as const,
      pinned: true
    }))
    const normalized = normalizePinnedActionsList(actions)
    expect(normalized.filter((a) => a.pinned)).toHaveLength(5)
    expect(normalized[5].pinned).toBe(false)
  })
})
