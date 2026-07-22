import { describe, expect, it } from 'vitest'
import {
  extractBalancedJsonObject,
  findCompassActionsBlocks
} from './code-fence'
import {
  parseWorkspaceActionsFromContent,
  stripAllCompassActionsContent,
  toWorkspaceRelativePath,
  normalizeWorkspaceActionPath,
  normalizeWorkspaceActions,
  inferWorkspaceActionsFromCodeBlocks
} from './workspace-actions'

describe('extractBalancedJsonObject', () => {
  it('extracts nested objects', () => {
    const text = 'prefix {"a":{"b":1},"c":2} tail'
    expect(extractBalancedJsonObject(text, 7)).toBe('{"a":{"b":1},"c":2}')
  })

  it('ignores braces inside JSON strings', () => {
    const text = '{"content":"has { and } braces"}'
    expect(extractBalancedJsonObject(text, 0)).toBe(text)
  })

  it('ignores escaped quotes inside strings', () => {
    const text = '{"content":"say \\"hi\\" please"}'
    expect(extractBalancedJsonObject(text, 0)).toBe(text)
  })
})

describe('findCompassActionsBlocks / nested fences', () => {
  it('parses writeFile content that embeds markdown code fences', () => {
    const doc = [
      '# GPX説明',
      '',
      '## 例',
      '',
      '```xml',
      '<trkpt lat="34.2846586" lon="134.1024476"/>',
      '```',
      '',
      '## まとめ',
      '',
      '経路を確認できます。'
    ].join('\n')

    const payload = {
      actions: [{ type: 'writeFile', path: 'データ/説明書類.md', content: doc }]
    }
    const json = JSON.stringify(payload)
    const content = ['作成します。', '', '```compass-actions', json, '```'].join('\n')

    const blocks = findCompassActionsBlocks(content)
    expect(blocks).toHaveLength(1)
    expect(blocks[0].json).toBe(json)

    const actions = parseWorkspaceActionsFromContent(content)
    expect(actions).toEqual([
      { type: 'writeFile', path: 'データ/説明書類.md', content: doc }
    ])

    expect(stripAllCompassActionsContent(content)).toBe('作成します。')
  })

  it('still parses simple fenced actions without nested fences', () => {
    const content = `\`\`\`compass-actions
{"actions":[{"type":"mkdir","path":"データ"}]}
\`\`\``
    expect(parseWorkspaceActionsFromContent(content)).toEqual([
      { type: 'mkdir', path: 'データ' }
    ])
  })

  it('parses bare compass-actions JSON without fences', () => {
    const content = `compass-actions
{"actions":[{"type":"writeFile","path":"a.md","content":"hi"}]}`
    expect(parseWorkspaceActionsFromContent(content)).toEqual([
      { type: 'writeFile', path: 'a.md', content: 'hi' }
    ])
  })

  it('does not stop at the first nested fence like the old regex did', () => {
    const content = [
      '```compass-actions',
      '{"actions":[{"type":"writeFile","path":"doc.md","content":"```xml\\n<trkpt/>\\n```\\n続き"}]}',
      '```'
    ].join('\n')

    // Old non-greedy regex would capture only up to the first ``` inside content.
    const actions = parseWorkspaceActionsFromContent(content)
    expect(actions).toHaveLength(1)
    expect(actions[0]).toMatchObject({
      type: 'writeFile',
      path: 'doc.md'
    })
    if (actions[0]?.type === 'writeFile') {
      expect(actions[0].content).toContain('```xml')
      expect(actions[0].content).toContain('続き')
    }
  })
})

describe('toWorkspaceRelativePath', () => {
  const root = 'C:/Users/niki/Desktop/研究プロジェクト'

  it('keeps nested Japanese relative paths', () => {
    expect(toWorkspaceRelativePath(root, 'データ/売上.csv')).toBe('データ/売上.csv')
  })

  it('strips an absolute workspace prefix without dropping folders', () => {
    expect(toWorkspaceRelativePath(root, `${root}/データ/売上.csv`)).toBe('データ/売上.csv')
  })

  it('handles Windows drive-letter case differences', () => {
    if (process.platform !== 'win32') return
    expect(toWorkspaceRelativePath(root, 'c:/Users/niki/Desktop/研究プロジェクト/資料/a.md')).toBe(
      '資料/a.md'
    )
  })
})

describe('normalizeWorkspaceActionPath', () => {
  const root = 'C:/Users/niki/Desktop/資料'

  it('does not strip a Japanese folder prefix without pathExists', () => {
    expect(normalizeWorkspaceActionPath(root, '資料/メモ.md')).toBe('資料/メモ.md')
  })

  it('keeps a real same-named child folder when it exists', () => {
    expect(
      normalizeWorkspaceActionPath(root, '資料/メモ.md', {
        pathExists: (abs) => abs.replace(/\\/g, '/').endsWith('/資料/資料/メモ.md')
      })
    ).toBe('資料/メモ.md')
  })

  it('strips a mistaken workspace-name prefix when the nested path does not exist', () => {
    expect(
      normalizeWorkspaceActionPath(root, '資料/メモ.md', {
        pathExists: () => false
      })
    ).toBe('メモ.md')
  })

  it('preserves unrelated Japanese folders', () => {
    expect(
      normalizeWorkspaceActionPath(root, 'ドキュメント/仕様.md', {
        pathExists: () => false
      })
    ).toBe('ドキュメント/仕様.md')
  })
})

describe('normalizeWorkspaceActions', () => {
  it('normalizes proposeActions paths with exists-aware stripping', () => {
    const root = 'C:/work/プロジェクト'
    const actions = normalizeWorkspaceActions(
      root,
      [{ type: 'writeFile', path: 'プロジェクト/src/a.ts', content: 'x' }],
      { pathExists: () => false }
    )
    expect(actions).toEqual([{ type: 'writeFile', path: 'src/a.ts', content: 'x' }])
  })
})

describe('inferWorkspaceActionsFromCodeBlocks', () => {
  const root = 'C:/work/app'

  it('infers a Japanese path with spaces from prose', () => {
    const content = [
      '西日本放送給与大臣ERP/西日本放送給与大臣ERP Class Library/設定.md を更新します。',
      '',
      '```md',
      '# 設定',
      '```'
    ].join('\n')

    expect(inferWorkspaceActionsFromCodeBlocks(content, root, null)).toEqual([
      {
        type: 'writeFile',
        path: '西日本放送給与大臣ERP/西日本放送給与大臣ERP Class Library/設定.md',
        content: '# 設定'
      }
    ])
  })

  it('infers a path with spaces from backticks', () => {
    const content = ['Update `My Documents/read me.md`:', '', '```md', 'hi', '```'].join('\n')
    expect(inferWorkspaceActionsFromCodeBlocks(content, root, null)).toEqual([
      { type: 'writeFile', path: 'My Documents/read me.md', content: 'hi' }
    ])
  })

  it('prefers the active file path when provided', () => {
    const content = ['```ts', 'console.log(1)', '```'].join('\n')
    expect(
      inferWorkspaceActionsFromCodeBlocks(
        content,
        root,
        `${root}/西日本放送給与大臣ERP/西日本放送給与大臣ERP Class Library/a.ts`
      )
    ).toEqual([
      {
        type: 'writeFile',
        path: '西日本放送給与大臣ERP/西日本放送給与大臣ERP Class Library/a.ts',
        content: 'console.log(1)'
      }
    ])
  })
})
