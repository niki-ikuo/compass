import { PINNED_ACTIONS_BAR_MAX, type ChatMode, type PinnedAction } from '@/types'

export function createPinnedActionId(): string {
  return `pinned-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

export function pickBarPinnedActions(actions: PinnedAction[]): PinnedAction[] {
  return actions.filter((action) => action.pinned).slice(0, PINNED_ACTIONS_BAR_MAX)
}

export function canPinMore(actions: PinnedAction[], exceptId?: string): boolean {
  return (
    actions.filter((action) => action.pinned && action.id !== exceptId).length <
    PINNED_ACTIONS_BAR_MAX
  )
}

export function createBlankPinnedAction(label: string): PinnedAction {
  return {
    id: createPinnedActionId(),
    label,
    prompt: '',
    mode: 'ask',
    pinned: true
  }
}

export const PINNED_ACTION_MODE_OPTIONS: ChatMode[] = ['ask', 'edit', 'agent']
