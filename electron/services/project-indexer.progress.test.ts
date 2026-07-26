import { mkdtemp, mkdir, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { buildProjectIndex, setIndexProgressEmitter } from './project-indexer'

describe('project-indexer progress', () => {
  it('emits increasing percent while building', async () => {
    const root = await mkdtemp(join(tmpdir(), 'compass-index-progress-'))
    await mkdir(join(root, 'docs'), { recursive: true })
    for (let i = 0; i < 8; i++) {
      await writeFile(join(root, 'docs', `note-${i}.md`), `# Note ${i}\n\nBody ${i}\n`, 'utf-8')
    }

    const percents: number[] = []
    setIndexProgressEmitter((_root, progress) => {
      percents.push(progress.percent)
    })

    try {
      await buildProjectIndex(root)
    } finally {
      setIndexProgressEmitter(null)
    }

    expect(percents.length).toBeGreaterThan(2)
    expect(percents[0]).toBe(0)
    expect(percents[percents.length - 1]).toBe(100)
    for (let i = 1; i < percents.length; i++) {
      expect(percents[i]).toBeGreaterThanOrEqual(percents[i - 1])
    }
  })
})
