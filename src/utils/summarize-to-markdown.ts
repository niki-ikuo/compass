import { formatContextMention } from './chat-mentions'
import {
  isExtractableDocumentPath,
  sidecarSummaryMarkdownPath
} from './extractable-document'
import type { ChatContextRef, ChatMode, UseCasePreset } from '@/types'
import { getFileName } from './language'

export type SummarizeToMarkdownRequest = {
  text: string
  mode: ChatMode
  preset: UseCasePreset
  contextRef: ChatContextRef
}

/** PDF / .docx を Markdown サイドカーへ要約するチャット送信内容を組み立てる */
export function buildSummarizeToMarkdownRequest(
  absolutePath: string,
  workspaceRoot: string | null,
  promptTemplate: (vars: { mention: string; sidecar: string }) => string
): SummarizeToMarkdownRequest | null {
  if (!isExtractableDocumentPath(absolutePath)) return null

  const mention = formatContextMention(absolutePath, false, workspaceRoot)
  const relativeLabel = mention.slice(2, -1) // strip @[ ]
  const sidecar = sidecarSummaryMarkdownPath(relativeLabel)
  const contextRef: ChatContextRef = {
    path: absolutePath,
    name: getFileName(absolutePath),
    isDirectory: false
  }

  return {
    text: promptTemplate({ mention, sidecar }),
    mode: 'edit',
    preset: 'document',
    contextRef
  }
}
