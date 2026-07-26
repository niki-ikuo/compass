import { describe, expect, it } from 'vitest'
import { isIgnoredPath, isSourcePath } from './project-indexer'

describe('isSourcePath (text-index policy)', () => {
  it('includes text files that were outside the old allowlist', () => {
    expect(isSourcePath('notes.txt')).toBe(true)
    expect(isSourcePath('src/Form1.vb')).toBe(true)
    expect(isSourcePath('docs/page.mdx')).toBe(true)
    expect(isSourcePath('Makefile')).toBe(true)
  })

  it('still includes previous allowlist languages', () => {
    expect(isSourcePath('app.ts')).toBe(true)
    expect(isSourcePath('readme.md')).toBe(true)
    expect(isSourcePath('rows.csv')).toBe(true)
  })

  it('excludes binary / media / Office and ignored trees', () => {
    expect(isSourcePath('dist/app.js')).toBe(false)
    expect(isSourcePath('node_modules/x/index.js')).toBe(false)
    expect(isSourcePath('bin/tool.exe')).toBe(false)
    expect(isSourcePath('assets/photo.png')).toBe(false)
    expect(isSourcePath('docs/spec.pdf')).toBe(false)
    expect(isSourcePath('sheets/data.xlsx')).toBe(false)
  })
})

describe('isIgnoredPath', () => {
  it('ignores compass and VCS trees', () => {
    expect(isIgnoredPath('.compass/files.json')).toBe(true)
    expect(isIgnoredPath('.git/config')).toBe(true)
    expect(isIgnoredPath('src/main.ts')).toBe(false)
  })
})
