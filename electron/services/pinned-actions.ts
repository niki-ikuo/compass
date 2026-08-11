import { mkdir, readFile, writeFile } from 'fs/promises'
import { join } from 'path'
import {
  normalizeChatMode,
  normalizeUseCasePreset,
  PINNED_ACTIONS_BAR_MAX,
  type PinnedAction,
  type WorkspacePinnedActions
} from '../../src/types'

const COMPASS_DIR = '.compass'
const PINNED_ACTIONS_FILE = 'pinned-actions.json'
const HISTORY_VERSION = 1

export type { PinnedAction, WorkspacePinnedActions }

function getPinnedActionsPath(workspaceRoot: string): string {
  return join(workspaceRoot, COMPASS_DIR, PINNED_ACTIONS_FILE)
}

export function createEmptyPinnedActions(): WorkspacePinnedActions {
  return { version: HISTORY_VERSION, actions: [] }
}

function normalizePinnedAction(raw: unknown): PinnedAction | null {
  if (!raw || typeof raw !== 'object') return null
  const item = raw as Partial<PinnedAction>
  if (typeof item.id !== 'string' || !item.id.trim()) return null
  if (typeof item.label !== 'string' || !item.label.trim()) return null
  if (typeof item.prompt !== 'string' || !item.prompt.trim()) return null
  const mode = normalizeChatMode(item.mode) ?? 'ask'
  const preset = normalizeUseCasePreset(item.preset)
  return {
    id: item.id.trim(),
    label: item.label.trim(),
    prompt: item.prompt.trim(),
    mode,
    ...(preset ? { preset } : {}),
    pinned: item.pinned === true
  }
}

/** バー表示は最大件数まで。超過分は pinned を外す */
export function normalizePinnedActionsList(actions: PinnedAction[]): PinnedAction[] {
  let pinnedCount = 0
  return actions.map((action) => {
    if (!action.pinned) return { ...action, pinned: false }
    if (pinnedCount >= PINNED_ACTIONS_BAR_MAX) {
      return { ...action, pinned: false }
    }
    pinnedCount += 1
    return { ...action, pinned: true }
  })
}

export async function loadPinnedActions(workspaceRoot: string): Promise<WorkspacePinnedActions> {
  try {
    const raw = await readFile(getPinnedActionsPath(workspaceRoot), 'utf-8')
    const parsed = JSON.parse(raw) as Partial<WorkspacePinnedActions>
    const actions = Array.isArray(parsed.actions)
      ? normalizePinnedActionsList(
          parsed.actions
            .map(normalizePinnedAction)
            .filter((action): action is PinnedAction => action !== null)
        )
      : []
    return { version: HISTORY_VERSION, actions }
  } catch {
    return createEmptyPinnedActions()
  }
}

export async function savePinnedActions(
  workspaceRoot: string,
  data: WorkspacePinnedActions
): Promise<WorkspacePinnedActions> {
  const actions = normalizePinnedActionsList(
    (Array.isArray(data.actions) ? data.actions : [])
      .map(normalizePinnedAction)
      .filter((action): action is PinnedAction => action !== null)
  )
  const payload: WorkspacePinnedActions = { version: HISTORY_VERSION, actions }
  const compassDir = join(workspaceRoot, COMPASS_DIR)
  await mkdir(compassDir, { recursive: true })
  await writeFile(getPinnedActionsPath(workspaceRoot), JSON.stringify(payload, null, 2), 'utf-8')
  return payload
}

export function pickBarPinnedActions(actions: PinnedAction[]): PinnedAction[] {
  return actions.filter((action) => action.pinned).slice(0, PINNED_ACTIONS_BAR_MAX)
}
