/** Electron IPC などが付ける接頭辞を除き、ユーザー向けの本文だけ返す */
export function getErrorMessage(err: unknown, fallback: string): string {
  const raw =
    err instanceof Error ? err.message : typeof err === 'string' ? err : ''
  if (!raw.trim()) return fallback

  const ipcMatch = raw.match(
    /^Error invoking remote method '[^']+':\s*(?:Error:\s*)?([\s\S]+)$/i
  )
  const message = (ipcMatch?.[1] ?? raw).trim()
  return message || fallback
}
