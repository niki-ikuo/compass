/**
 * Workspace listing / walk ignore helpers.
 * Keep rules small and explicit — not a full gitignore engine.
 */

/** Word / Excel lock files created while a document is open (e.g. ~$report.xlsx). */
export function isOfficeLockFileName(name: string): boolean {
  return name.startsWith('~$')
}

/** Skip this directory entry when walking or listing the workspace tree. */
export function shouldSkipWorkspaceEntry(name: string, isDirectory: boolean): boolean {
  if (!isDirectory && isOfficeLockFileName(name)) return true
  return false
}
