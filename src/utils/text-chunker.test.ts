import { describe, expect, it } from 'vitest'
import { chunkFileContent } from './text-chunker'

describe('text-chunker', () => {
  it('chunks markdown by headings with summaries', () => {
    const content = [
      '# Title',
      '',
      'Intro paragraph about the product.',
      '',
      '## Setup',
      '',
      'Install dependencies and run the app.',
      '',
      '## Search',
      '',
      'Hybrid search finds notes by meaning.'
    ].join('\n')

    const chunks = chunkFileContent('docs/guide.md', content, 'markdown')
    expect(chunks.length).toBeGreaterThanOrEqual(2)
    const setup = chunks.find((c) => c.heading === 'Setup')
    expect(setup).toBeTruthy()
    expect(setup?.startLine).toBe(5)
    expect(setup?.summary.toLowerCase()).toContain('install')
  })

  it('chunks plain text by line windows', () => {
    const lines = Array.from({ length: 90 }, (_, i) => `line ${i + 1}`)
    const chunks = chunkFileContent('notes/log.txt', lines.join('\n'), 'plaintext')
    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks[0].startLine).toBe(1)
    expect(chunks[0].endLine).toBeLessThanOrEqual(40)
  })
})
