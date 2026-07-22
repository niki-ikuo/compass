import { describe, expect, it } from 'vitest'
import { getCodeLabel } from '@/utils/chat-content'

describe('getCodeLabel path inference', () => {
  it('reads Unicode and spaced paths from language tags', () => {
    const { label } = getCodeLabel(
      'ts:西日本放送給与大臣ERP/西日本放送給与大臣ERP Class Library/a.ts',
      'export {}'
    )
    expect(label).toBe('西日本放送給与大臣ERP/西日本放送給与大臣ERP Class Library/a.ts')
  })

  it('reads spaced paths from // file: comments', () => {
    const { label } = getCodeLabel(
      'typescript',
      '// file: My Documents/read me.ts\nexport const x = 1\n'
    )
    expect(label).toBe('My Documents/read me.ts')
  })

  it('reads spaced paths from # filename comments', () => {
    const { label } = getCodeLabel(
      'python',
      '# filename: 西日本放送給与大臣ERP/西日本放送給与大臣ERP Class Library/util.py\nprint(1)\n'
    )
    expect(label).toBe('西日本放送給与大臣ERP/西日本放送給与大臣ERP Class Library/util.py')
  })

  it('reads spaced paths from HTML file comments', () => {
    const { label } = getCodeLabel(
      'html',
      '<!-- file: docs/read me.html -->\n<html></html>\n'
    )
    expect(label).toBe('docs/read me.html')
  })
})
