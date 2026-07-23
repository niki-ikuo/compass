import { mkdir, readFile, writeFile } from 'fs/promises'
import { join } from 'path'
import type { WorkspaceExplorerState } from '../../src/types'

const COMPASS_DIR = '.compass'
const EXPLORER_STATE_FILE = 'explorer-state.json'
const HISTORY_VERSION = 1

export type { WorkspaceExplorerState }

function getExplorerStatePath(workspaceRoot: string): string {
  return join(workspaceRoot, COMPASS_DIR, EXPLORER_STATE_FILE)
}

export function createEmptyExplorerState(): WorkspaceExplorerState {
  return {
    version: HISTORY_VERSION,
    expandedDirs: [],
    selectedPaths: [],
    lastSelectedPath: null
  }
}

function normalizePathList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const result: string[] = []
  for (const entry of value) {
    if (typeof entry !== 'string' || !entry.trim()) continue
    const normalized = entry.replace(/\\/g, '/')
    if (seen.has(normalized)) continue
    seen.add(normalized)
    result.push(normalized)
  }
  return result
}

function normalizeLastSelectedPath(value: unknown, selectedPaths: string[]): string | null {
  if (typeof value !== 'string' || !value.trim()) return null
  const normalized = value.replace(/\\/g, '/')
  return selectedPaths.includes(normalized) ? normalized : (selectedPaths[selectedPaths.length - 1] ?? null)
}

/** ファイルが無い／壊れている場合は `null`（呼び出し側でデフォルト展開を使う） */
export async function loadExplorerState(
  workspaceRoot: string
): Promise<WorkspaceExplorerState | null> {
  try {
    const raw = await readFile(getExplorerStatePath(workspaceRoot), 'utf-8')
    const parsed = JSON.parse(raw) as Partial<WorkspaceExplorerState>
    const selectedPaths = normalizePathList(parsed.selectedPaths)
    return {
      version: HISTORY_VERSION,
      expandedDirs: normalizePathList(parsed.expandedDirs),
      selectedPaths,
      lastSelectedPath: normalizeLastSelectedPath(parsed.lastSelectedPath, selectedPaths)
    }
  } catch {
    return null
  }
}

export async function saveExplorerState(
  workspaceRoot: string,
  state: WorkspaceExplorerState
): Promise<void> {
  const expandedDirs = normalizePathList(state.expandedDirs)
  const selectedPaths = normalizePathList(state.selectedPaths)
  const lastSelectedPath = normalizeLastSelectedPath(state.lastSelectedPath, selectedPaths)
  const compassDir = join(workspaceRoot, COMPASS_DIR)
  await mkdir(compassDir, { recursive: true })
  await writeFile(
    getExplorerStatePath(workspaceRoot),
    JSON.stringify(
      {
        version: HISTORY_VERSION,
        expandedDirs,
        selectedPaths,
        lastSelectedPath
      } satisfies WorkspaceExplorerState,
      null,
      2
    ),
    'utf-8'
  )
}
