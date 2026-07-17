import type { ChatMessage, ChatSession, UseCasePreset } from '@/types'
import { DEFAULT_SETTINGS, normalizeUseCasePreset } from '@/types'

/** UI セレクトの並び（広い → 狭い。デフォルトを先頭） */
export const USE_CASE_PRESET_OPTIONS = [
  {
    id: 'general' as const,
    labelKey: 'chat.preset.general' as const,
    descKey: 'chat.preset.generalDesc' as const
  },
  {
    id: 'document' as const,
    labelKey: 'chat.preset.document' as const,
    descKey: 'chat.preset.documentDesc' as const
  },
  {
    id: 'data' as const,
    labelKey: 'chat.preset.data' as const,
    descKey: 'chat.preset.dataDesc' as const
  },
  {
    id: 'code' as const,
    labelKey: 'chat.preset.code' as const,
    descKey: 'chat.preset.codeDesc' as const
  }
]

/** 未指定時の用途（DEFAULT_SETTINGS と同期） */
export const DEFAULT_USE_CASE_PRESET: UseCasePreset = DEFAULT_SETTINGS.defaultUseCasePreset

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
 * UI 選択 → ワークスペース既定 → アプリ設定 → DEFAULT_USE_CASE_PRESET
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
    DEFAULT_USE_CASE_PRESET
  )
}

function presetFromUserMessage(message: ChatMessage): UseCasePreset | undefined {
  if (message.role !== 'user') return undefined
  return normalizeUseCasePreset(message.preset)
}
