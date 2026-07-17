import type { ChatMessage, ChatSession, UseCasePreset } from '@/types'
import { normalizeUseCasePreset } from '@/types'

/** 全セッションから、最も最近送信された user メッセージの用途プリセットを返す */
export function resolveLastSentUseCasePreset(
  sessions: Array<Pick<ChatSession, 'messages'>>
): UseCasePreset | undefined {
  let best: { preset: UseCasePreset; timestamp: number } | undefined

  for (const session of sessions) {
    for (const message of session.messages) {
      const preset = presetFromUserMessage(message)
      if (!preset) continue
      if (!best || message.timestamp >= best.timestamp) {
        best = { preset, timestamp: message.timestamp }
      }
    }
  }

  return best?.preset
}

/**
 * 用途プリセットの解決順:
 * UI 選択 → ワークスペース既定 → アプリ設定 → code
 */
export function resolveEffectiveUseCasePreset(options: {
  uiPreset?: unknown
  workspacePreset?: unknown
  appPreset?: unknown
}): UseCasePreset {
  return (
    normalizeUseCasePreset(options.uiPreset) ??
    normalizeUseCasePreset(options.workspacePreset) ??
    normalizeUseCasePreset(options.appPreset) ??
    'code'
  )
}

function presetFromUserMessage(message: ChatMessage): UseCasePreset | undefined {
  if (message.role !== 'user') return undefined
  return normalizeUseCasePreset(message.preset)
}
