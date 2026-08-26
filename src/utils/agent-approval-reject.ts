/**
 * proposeActions プレビュー却下の意図。
 * stop  = 観測を残してラン終了（他 todo へ進まない）
 * revise = 観測を返して続行（同じ目標の再提案を促す）
 */
export type ProposeActionsRejectIntent = 'stop' | 'revise'

export const PROPOSE_ACTIONS_REJECT_STOP_DETAIL =
  'User rejected the proposed workspace actions and asked to stop. They were not applied. Do not continue with other todos or propose further changes; wait for the next user message.'

export const PROPOSE_ACTIONS_REJECT_REVISE_DETAIL =
  'User rejected the proposed workspace actions and asked for a revision. They were not applied. Propose a revised set of actions for the same goal; do not advance to unrelated todos.'

/** ファイル単位ですべて拒否し、1件も適用しなかったとき */
export const PROPOSE_ACTIONS_REJECT_STOP_PARTIAL_DETAIL =
  'User rejected the proposed file changes (partial) and asked to stop. Remaining items were cleared without apply. Do not continue with other todos or propose further changes; wait for the next user message.'

export function detailForProposeActionsReject(intent: ProposeActionsRejectIntent): string {
  return intent === 'revise'
    ? PROPOSE_ACTIONS_REJECT_REVISE_DETAIL
    : PROPOSE_ACTIONS_REJECT_STOP_DETAIL
}

/** エディタでファイル単位に採用/拒否し、プレビューが空になったときの承認結果 */
export function buildFileUnitPreviewApproval(
  applied: string[],
  rejected: string[]
): { approved: boolean; detail: string } {
  if (applied.length === 0) {
    return { approved: false, detail: PROPOSE_ACTIONS_REJECT_STOP_PARTIAL_DETAIL }
  }
  if (rejected.length === 0) {
    return {
      approved: true,
      detail: `User approved and applied ${applied.length} workspace action(s):\n${applied
        .map((path) => `- ${path}`)
        .join('\n')}`
    }
  }
  return {
    approved: true,
    detail: [
      'User partially resolved the proposed workspace actions.',
      `Applied:\n${applied.map((path) => `- ${path}`).join('\n')}`,
      `Rejected:\n${rejected.map((path) => `- ${path}`).join('\n')}`
    ].join('\n')
  }
}

/**
 * 承認 resolve の detail から却下意図を判定。
 * 適用失敗の再提案依頼は revise。意図不明のフル却下は stop（安全側）。
 */
export function parseProposeActionsRejectIntent(
  detail: string | null | undefined
): ProposeActionsRejectIntent | null {
  if (!detail?.trim()) return null
  const text = detail.trim()

  if (/apply failed/i.test(text)) return 'revise'
  if (/asked for a revision/i.test(text)) return 'revise'
  if (/asked to stop/i.test(text)) return 'stop'

  // 旧メッセージ・supersede / workspace closed などは stop 寄り
  if (/User rejected the proposed workspace actions/i.test(text)) return 'stop'
  if (/User rejected the proposed file changes \(partial\)/i.test(text)) return 'stop'

  return null
}
