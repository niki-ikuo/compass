import { watch, type FSWatcher } from 'fs'
import type { WebContents } from 'electron'
import type { IndexBuildResult } from '../../src/types'
import { buildProjectIndex, isSourcePath, sameWorkspaceRoot } from './project-indexer'

const DEBOUNCE_MS = 800

let watcher: FSWatcher | null = null
let watchedRoot: string | null = null
let debounceTimer: ReturnType<typeof setTimeout> | null = null
let targetWebContents: WebContents | null = null
let rebuildQueued = false
let rebuilding = false

function clearDebounce(): void {
  if (debounceTimer) {
    clearTimeout(debounceTimer)
    debounceTimer = null
  }
}

function sendStatus(status: 'indexing' | 'ready' | 'error', workspaceRoot: string): void {
  if (!targetWebContents || targetWebContents.isDestroyed()) return
  targetWebContents.send('index:status', status, workspaceRoot)
}

function sendUpdated(result: IndexBuildResult): void {
  if (!targetWebContents || targetWebContents.isDestroyed()) return
  targetWebContents.send('index:updated', result)
}

async function runRebuild(): Promise<void> {
  const root = watchedRoot
  if (!root) return

  if (rebuilding) {
    rebuildQueued = true
    return
  }

  rebuilding = true
  rebuildQueued = false
  sendStatus('indexing', root)

  try {
    const result = await buildProjectIndex(root)
    // Ignore results if the user switched workspaces while rebuilding.
    if (watchedRoot && sameWorkspaceRoot(watchedRoot, root)) {
      sendUpdated(result)
      sendStatus('ready', root)
    }
  } catch {
    if (watchedRoot && sameWorkspaceRoot(watchedRoot, root)) {
      sendStatus('error', root)
    }
  } finally {
    rebuilding = false
    if (rebuildQueued && watchedRoot) {
      rebuildQueued = false
      void runRebuild()
    }
  }
}

function scheduleRebuild(): void {
  clearDebounce()
  debounceTimer = setTimeout(() => {
    debounceTimer = null
    void runRebuild()
  }, DEBOUNCE_MS)
}

export function startIndexWatcher(workspaceRoot: string, webContents: WebContents): void {
  stopIndexWatcher()

  watchedRoot = workspaceRoot
  targetWebContents = webContents

  try {
    watcher = watch(workspaceRoot, { recursive: true }, (_eventType, filename) => {
      if (!filename) {
        scheduleRebuild()
        return
      }
      const relativePath = filename.toString().replace(/\\/g, '/')
      if (!isSourcePath(relativePath)) return
      scheduleRebuild()
    })

    watcher.on('error', () => {
      // Keep the app usable even if the watcher fails (e.g. permission issues).
      stopIndexWatcher()
    })
  } catch {
    watcher = null
    watchedRoot = null
  }
}

export function stopIndexWatcher(): void {
  clearDebounce()
  rebuildQueued = false
  rebuilding = false

  if (watcher) {
    try {
      watcher.close()
    } catch {
      // ignore close errors
    }
    watcher = null
  }

  watchedRoot = null
  targetWebContents = null
}

export function getWatchedWorkspaceRoot(): string | null {
  return watchedRoot
}
