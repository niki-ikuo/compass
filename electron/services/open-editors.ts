import { mkdir, readFile, writeFile } from 'fs/promises'
import { join } from 'path'
import type { PersistedEditorViewKind, PersistedOpenTab, WorkspaceOpenEditors } from '../../src/types'

const COMPASS_DIR = '.compass'
const OPEN_EDITORS_FILE = 'open-editors.json'
const HISTORY_VERSION = 1

export type { PersistedEditorViewKind, PersistedOpenTab, WorkspaceOpenEditors }

function getOpenEditorsPath(workspaceRoot: string): string {
  return join(workspaceRoot, COMPASS_DIR, OPEN_EDITORS_FILE)
}

export function createEmptyOpenEditors(): WorkspaceOpenEditors {
  return { version: HISTORY_VERSION, activeFilePath: null, openTabs: [] }
}

function isPersistedViewKind(value: unknown): value is PersistedEditorViewKind {
  return value === 'text' || value === 'image' || value === 'pdf' || value === 'browser'
}

function normalizeTab(tab: unknown): PersistedOpenTab | null {
  if (!tab || typeof tab !== 'object') return null
  const t = tab as Partial<PersistedOpenTab>
  if (typeof t.path !== 'string' || !t.path.trim()) return null

  const viewKind = isPersistedViewKind(t.viewKind) ? t.viewKind : 'text'
  if (viewKind === 'browser') {
    const browserUrl = typeof t.browserUrl === 'string' ? t.browserUrl : 'about:blank'
    return { path: t.path, viewKind, browserUrl }
  }

  return { path: t.path, viewKind }
}

export async function loadOpenEditors(workspaceRoot: string): Promise<WorkspaceOpenEditors> {
  try {
    const raw = await readFile(getOpenEditorsPath(workspaceRoot), 'utf-8')
    const parsed = JSON.parse(raw) as Partial<WorkspaceOpenEditors>
    const openTabs = Array.isArray(parsed.openTabs)
      ? parsed.openTabs.map(normalizeTab).filter((tab): tab is PersistedOpenTab => tab !== null)
      : []

    const preferredActive =
      typeof parsed.activeFilePath === 'string' &&
      openTabs.some((tab) => tab.path === parsed.activeFilePath)
        ? parsed.activeFilePath
        : (openTabs[openTabs.length - 1]?.path ?? null)

    return {
      version: HISTORY_VERSION,
      activeFilePath: preferredActive,
      openTabs
    }
  } catch {
    return createEmptyOpenEditors()
  }
}

export async function saveOpenEditors(
  workspaceRoot: string,
  editors: WorkspaceOpenEditors
): Promise<void> {
  const openTabs = Array.isArray(editors.openTabs)
    ? editors.openTabs.map(normalizeTab).filter((tab): tab is PersistedOpenTab => tab !== null)
    : []
  const activeFilePath =
    typeof editors.activeFilePath === 'string' &&
    openTabs.some((tab) => tab.path === editors.activeFilePath)
      ? editors.activeFilePath
      : (openTabs[openTabs.length - 1]?.path ?? null)

  const compassDir = join(workspaceRoot, COMPASS_DIR)
  await mkdir(compassDir, { recursive: true })
  await writeFile(
    getOpenEditorsPath(workspaceRoot),
    JSON.stringify(
      {
        version: HISTORY_VERSION,
        activeFilePath,
        openTabs
      } satisfies WorkspaceOpenEditors,
      null,
      2
    ),
    'utf-8'
  )
}
