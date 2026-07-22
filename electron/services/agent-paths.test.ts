import { describe, expect, it } from 'vitest'
import { normalizeAgentRelativePath } from './agent-paths'

describe('normalizeAgentRelativePath', () => {
  const root = 'C:/Users/dev/my-app'

  it('defaults empty paths to workspace root', () => {
    expect(normalizeAgentRelativePath(root, undefined)).toBe('.')
    expect(normalizeAgentRelativePath(root, '')).toBe('.')
    expect(normalizeAgentRelativePath(root, './')).toBe('.')
  })

  it('can keep empty path when defaultToRoot is false', () => {
    expect(normalizeAgentRelativePath(root, '', { defaultToRoot: false })).toBe('')
  })

  it('keeps normal relative paths', () => {
    expect(normalizeAgentRelativePath(root, 'src/index.ts')).toBe('src/index.ts')
    expect(normalizeAgentRelativePath(root, 'src/')).toBe('src')
  })

  it('maps an absolute path under the workspace to relative', () => {
    expect(normalizeAgentRelativePath(root, 'C:/Users/dev/my-app/src/a.ts')).toBe('src/a.ts')
    expect(normalizeAgentRelativePath(root, 'C:/Users/dev/my-app')).toBe('.')
  })

  it('treats bare workspace folder name as root when no same-named child exists', () => {
    expect(
      normalizeAgentRelativePath(root, 'my-app', {
        pathExists: () => false
      })
    ).toBe('.')
  })

  it('keeps bare workspace folder name when a same-named child exists', () => {
    expect(
      normalizeAgentRelativePath(root, 'my-app', {
        pathExists: () => true
      })
    ).toBe('my-app')
  })

  it('strips a mistaken workspace-name prefix when nested path is absent', () => {
    expect(
      normalizeAgentRelativePath('C:/Users/dev/資料', '資料/メモ.md', {
        pathExists: () => false
      })
    ).toBe('メモ.md')
  })

  it('keeps workspace-name prefix when that nested folder exists', () => {
    expect(
      normalizeAgentRelativePath('C:/Users/dev/資料', '資料/メモ.md', {
        pathExists: (abs) => abs.replace(/\\/g, '/').endsWith('/資料/資料/メモ.md')
      })
    ).toBe('資料/メモ.md')
  })
})
