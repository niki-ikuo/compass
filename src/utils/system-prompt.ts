import { CONTEXT_BUDGET, truncateToTokenBudget } from './context-budget'

/** 用途ロール + モード制約の system プロンプト合成 */
export function composeSystemPrompt(rolePrompt: string, modePrompt: string): string {
  return `${rolePrompt}\n\n${modePrompt}`
}

/**
 * Trim and budget a user-authored role overlay.
 * Empty / whitespace-only → null (caller should keep the preset role).
 */
export function normalizeCustomRolePrompt(
  text: string | null | undefined,
  maxTokens: number = CONTEXT_BUDGET.roleTokens,
  truncatedNotice = '\n…(truncated to fit context budget)'
): string | null {
  const trimmed = typeof text === 'string' ? text.trim() : ''
  if (!trimmed) return null
  return truncateToTokenBudget(trimmed, maxTokens, truncatedNotice)
}

/** Prefer a custom role overlay; otherwise the built-in preset role. */
export function resolveRolePromptLayer(
  presetRole: string,
  customRole: string | null | undefined,
  maxTokens: number = CONTEXT_BUDGET.roleTokens,
  truncatedNotice = '\n…(truncated to fit context budget)'
): string {
  return normalizeCustomRolePrompt(customRole, maxTokens, truncatedNotice) ?? presetRole
}

/** code は reminder なし。document / data / general のみ短いヒント */
export function getUseCasePresetReminderKey(
  preset: string | null | undefined
): 'ai.preset.document.reminder' | 'ai.preset.data.reminder' | 'ai.preset.general.reminder' | null {
  if (preset === 'document') return 'ai.preset.document.reminder'
  if (preset === 'data') return 'ai.preset.data.reminder'
  if (preset === 'general') return 'ai.preset.general.reminder'
  return null
}
