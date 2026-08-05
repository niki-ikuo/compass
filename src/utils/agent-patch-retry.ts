import { t } from '../i18n/runtime'
import { isPatchMismatchMessage } from './apply-error'

/**
 * Same exact applyPatch fingerprint may fail this many times before further retries are blocked.
 * 1 = after the first mismatch, repeating the identical patch is rejected.
 */
export const MAX_IDENTICAL_PATCH_FAILURES = 1

/** After this many patch-mismatch failures on one path, nudge writeFile instead of applyPatch. */
export const WRITEFILE_FALLBACK_AFTER_PATH_FAILURES = 2

export type PatchRetryState = {
  /** fingerprint → how many times this exact patch already failed */
  identicalFailures: Map<string, number>
  /** path → patch-mismatch failure count this run */
  pathFailures: Map<string, number>
}

export type ApplyPatchActionLike = {
  type: 'applyPatch'
  path: string
  patch: string
}

export function createPatchRetryState(): PatchRetryState {
  return {
    identicalFailures: new Map(),
    pathFailures: new Map()
  }
}

/** Normalize path + patch text into a stable fingerprint for identical-retry detection. */
export function fingerprintApplyPatch(path: string, patch: string): string {
  const normalizedPath = path.replace(/\\/g, '/').trim()
  const normalizedPatch = patch.replace(/\r\n/g, '\n').trim()
  return `${normalizedPath}\0${normalizedPatch}`
}

export function extractApplyPatchActions(
  actions: Array<{ type?: string; path?: string; patch?: string }>
): ApplyPatchActionLike[] {
  const out: ApplyPatchActionLike[] = []
  for (const action of actions) {
    if (action?.type !== 'applyPatch') continue
    if (typeof action.path !== 'string' || !action.path.trim()) continue
    if (typeof action.patch !== 'string' || !action.patch.trim()) continue
    out.push({
      type: 'applyPatch',
      path: action.path.replace(/\\/g, '/').trim(),
      patch: action.patch
    })
  }
  return out
}

/**
 * If any applyPatch in this proposal already failed MAX_IDENTICAL_PATCH_FAILURES times
 * with the exact same fingerprint, return a blocking error message.
 */
export function getIdenticalPatchBlockMessage(
  state: PatchRetryState,
  actions: Array<{ type?: string; path?: string; patch?: string }>
): string | null {
  const patches = extractApplyPatchActions(actions)
  if (patches.length === 0) return null

  const blockedPaths: string[] = []
  for (const patch of patches) {
    const fp = fingerprintApplyPatch(patch.path, patch.patch)
    const failures = state.identicalFailures.get(fp) ?? 0
    if (failures >= MAX_IDENTICAL_PATCH_FAILURES) {
      blockedPaths.push(patch.path)
    }
  }
  if (blockedPaths.length === 0) return null

  const uniquePaths = [...new Set(blockedPaths)]
  return formatIdenticalPatchBlockedGuidance(uniquePaths)
}

/**
 * Record a patch-mismatch failure and return model guidance (force re-read + optional writeFile).
 * Returns null when the error is not a patch mismatch.
 */
export function recordPatchMismatchFailure(
  state: PatchRetryState,
  actions: Array<{ type?: string; path?: string; patch?: string }>,
  errorMessage: string
): string | null {
  if (!isPatchMismatchMessage(errorMessage)) return null

  const patches = extractApplyPatchActions(actions)
  const paths = new Set<string>()

  if (patches.length > 0) {
    for (const patch of patches) {
      const fp = fingerprintApplyPatch(patch.path, patch.patch)
      state.identicalFailures.set(fp, (state.identicalFailures.get(fp) ?? 0) + 1)
      state.pathFailures.set(patch.path, (state.pathFailures.get(patch.path) ?? 0) + 1)
      paths.add(patch.path)
    }
  } else {
    // Fallback: still try to extract paths from any actions for re-read guidance.
    for (const action of actions) {
      if (typeof action.path === 'string' && action.path.trim()) {
        const path = action.path.replace(/\\/g, '/').trim()
        state.pathFailures.set(path, (state.pathFailures.get(path) ?? 0) + 1)
        paths.add(path)
      }
    }
  }

  if (paths.size === 0) {
    return formatPatchMismatchForceRereadGuidance(['(affected file)'], false)
  }

  const pathList = [...paths]
  const preferWriteFile = pathList.some(
    (path) => (state.pathFailures.get(path) ?? 0) >= WRITEFILE_FALLBACK_AFTER_PATH_FAILURES
  )
  return formatPatchMismatchForceRereadGuidance(pathList, preferWriteFile)
}

export function pathsNeedingForceRead(state: PatchRetryState): string[] {
  return [...state.pathFailures.keys()]
}

export function formatPatchMismatchForceRereadGuidance(
  paths: string[],
  preferWriteFile: boolean
): string {
  const pathList = paths.join(', ')
  const forceRead = t('ai.agentPatchMismatchForceReread', { paths: pathList })
  if (!preferWriteFile) return forceRead
  return [forceRead, t('ai.agentPatchMismatchWriteFileFallback', { paths: pathList })].join('\n')
}

export function formatIdenticalPatchBlockedGuidance(paths: string[]): string {
  const pathList = paths.join(', ')
  return t('ai.agentPatchSameHunkBlocked', { paths: pathList })
}

export { isPatchMismatchMessage }
