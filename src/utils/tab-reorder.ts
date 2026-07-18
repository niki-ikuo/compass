/** エディタタブ並べ替え用 DnD MIME */
export const EDITOR_TAB_REORDER_MIME = 'application/x-compass-editor-tab'

/** チャットタブ並べ替え用 DnD MIME */
export const CHAT_TAB_REORDER_MIME = 'application/x-compass-chat-tab'

export function hasTabReorderDrag(dataTransfer: DataTransfer, mime: string): boolean {
  return dataTransfer.types.includes(mime)
}

/** タブ中央より左ならそのインデックス、右ならインデックス+1（挿入位置） */
export function resolveTabDropIndex(
  clientX: number,
  tabLeft: number,
  tabWidth: number,
  tabIndex: number
): number {
  const mid = tabLeft + tabWidth / 2
  return clientX < mid ? tabIndex : tabIndex + 1
}

/**
 * fromIndex の要素を dropIndex（移動前配列での挿入位置）へ移す。
 * 位置が変わらない場合は元配列を返す。
 */
export function moveItemByDropIndex<T>(items: T[], fromIndex: number, dropIndex: number): T[] {
  if (
    fromIndex < 0 ||
    fromIndex >= items.length ||
    dropIndex < 0 ||
    dropIndex > items.length ||
    dropIndex === fromIndex ||
    dropIndex === fromIndex + 1
  ) {
    return items
  }

  const next = [...items]
  const [item] = next.splice(fromIndex, 1)
  const insertAt = dropIndex > fromIndex ? dropIndex - 1 : dropIndex
  next.splice(insertAt, 0, item)
  return next
}

/** 開いているセッションだけ並べ替え、閉じたセッションの相対位置は維持 */
export function reorderOpenSessionsById<T extends { id: string; isOpen?: boolean }>(
  sessions: T[],
  fromId: string,
  dropIndexAmongOpen: number
): T[] {
  const openIndexes: number[] = []
  const openSessions: T[] = []
  for (let i = 0; i < sessions.length; i++) {
    if (sessions[i].isOpen) {
      openIndexes.push(i)
      openSessions.push(sessions[i])
    }
  }

  const fromOpenIndex = openSessions.findIndex((s) => s.id === fromId)
  if (fromOpenIndex < 0) return sessions

  const reorderedOpen = moveItemByDropIndex(openSessions, fromOpenIndex, dropIndexAmongOpen)
  if (reorderedOpen === openSessions) return sessions

  const next = [...sessions]
  for (let i = 0; i < openIndexes.length; i++) {
    next[openIndexes[i]] = reorderedOpen[i]
  }
  return next
}
