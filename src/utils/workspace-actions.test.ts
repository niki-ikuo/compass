import { describe, expect, it } from 'vitest'
import {
  extractBalancedJsonObject,
  findCompassActionsBlocks
} from './code-fence'
import {
  parseWorkspaceActionsFromContent,
  stripAllCompassActionsContent
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
