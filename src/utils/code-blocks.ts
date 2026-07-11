import type { CodeBlock } from '@/types'
import { CODE_FENCE_REGEX } from './code-fence'

export function extractCodeBlocks(content: string): CodeBlock[] {
  const blocks: CodeBlock[] = []
  let match: RegExpExecArray | null

  CODE_FENCE_REGEX.lastIndex = 0
  while ((match = CODE_FENCE_REGEX.exec(content)) !== null) {
    blocks.push({
      language: match[1] || 'plaintext',
      code: match[2].trimEnd()
    })
  }

  return blocks
}

export interface DiffLine {
  type: 'add' | 'remove' | 'same'
  content: string
}

export function computeLineDiff(oldText: string, newText: string): DiffLine[] {
  const oldLines = oldText.split('\n')
  const newLines = newText.split('\n')
  const result: DiffLine[] = []

  const maxLen = Math.max(oldLines.length, newLines.length)
  for (let i = 0; i < maxLen; i++) {
    const oldLine = oldLines[i]
    const newLine = newLines[i]

    if (oldLine === undefined && newLine !== undefined) {
      result.push({ type: 'add', content: newLine })
    } else if (oldLine !== undefined && newLine === undefined) {
      result.push({ type: 'remove', content: oldLine })
    } else if (oldLine !== newLine) {
      if (oldLine !== undefined) result.push({ type: 'remove', content: oldLine })
      if (newLine !== undefined) result.push({ type: 'add', content: newLine })
    } else {
      result.push({ type: 'same', content: oldLine })
    }
  }

  return result
}

export function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}
