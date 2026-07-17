/** 用途ロール + モード制約の system プロンプト合成 */
export function composeSystemPrompt(rolePrompt: string, modePrompt: string): string {
  return `${rolePrompt}\n\n${modePrompt}`
}

/** code は現行互換のため reminder なし。document / data / general のみ短いヒント */
export function getUseCasePresetReminderKey(
  preset: string | null | undefined
): 'ai.preset.document.reminder' | 'ai.preset.data.reminder' | 'ai.preset.general.reminder' | null {
  if (preset === 'document') return 'ai.preset.document.reminder'
  if (preset === 'data') return 'ai.preset.data.reminder'
  if (preset === 'general') return 'ai.preset.general.reminder'
  return null
}
