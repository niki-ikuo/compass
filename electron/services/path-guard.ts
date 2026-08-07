import { existsSync, realpathSync, statSync } from 'fs'
import { dirname as pathDirname, isAbsolute, join, relative, resolve } from 'path'
import { t } from '../../src/i18n/runtime'

/** In-memory active workspace for IPC path checks (synced from workspace:setLast). */
let activeWorkspaceRoot: string | null = null

/**
 * Short-lived allowlist for external chat context paths (picker / OS drop).
 * Keys are always realpath-normalized when the file exists at registration time.
 */
const externalContextAllowlist = new Map<string, number>()
const EXTERNAL_CONTEXT_TTL_MS = 10 * 60 * 1000
const MAX_EXTERNAL_CONTEXT_BYTES = 20 * 1024 * 1024

export function setActiveWorkspaceRoot(workspaceRoot: string | null): void {
  activeWorkspaceRoot = workspaceRoot ? resolve(workspaceRoot) : null
}

export function getActiveWorkspaceRoot(): string | null {
  return activeWorkspaceRoot
}

/**
 * Ensure the client-provided workspaceRoot matches the active workspace (realpath).
 * Use for IPC that still pass workspaceRoot from the renderer.
 */
export function bindActiveWorkspaceRoot(workspaceRoot: string): string {
  if (!activeWorkspaceRoot) {
    throw new Error(t('fs.noWorkspace'))
  }
  if (typeof workspaceRoot !== 'string' || workspaceRoot.trim() === '') {
    throw new Error(t('fs.noWorkspace'))
  }
  const active = assertInsideWorkspace(activeWorkspaceRoot, activeWorkspaceRoot, {
    allowRoot: true
  })
  const requested = assertInsideWorkspace(workspaceRoot, workspaceRoot, { allowRoot: true })
  if (normalizePathKey(active) !== normalizePathKey(requested)) {
    throw new Error(t('fs.outsideWorkspace', { path: workspaceRoot }))
  }
  return active
}

export function registerExternalContextPaths(paths: string[]): void {
  const now = Date.now()
  pruneExternalContextAllowlist(now)
  for (const raw of paths) {
    if (typeof raw !== 'string' || raw.trim() === '') continue
    try {
      const abs = resolve(raw)
      if (!existsSync(abs)) continue
      const info = statSync(abs)
      if (!info.isFile()) continue
      if (info.size > MAX_EXTERNAL_CONTEXT_BYTES) continue
      const real = realpathSync(abs)
      externalContextAllowlist.set(normalizePathKey(real), now + EXTERNAL_CONTEXT_TTL_MS)
    } catch {
      // ignore invalid / unreadable paths
    }
  }
}

export function isExternalContextPathAllowed(targetPath: string): boolean {
  const now = Date.now()
  pruneExternalContextAllowlist(now)
  const abs = resolve(targetPath)
  if (!existsSync(abs)) return false
  try {
    const real = realpathSync(abs)
    return externalContextAllowlist.has(normalizePathKey(real))
  } catch {
    return false
  }
}

function pruneExternalContextAllowlist(now: number): void {
  for (const [key, expires] of externalContextAllowlist) {
    if (expires <= now) externalContextAllowlist.delete(key)
  }
}

function normalizePathKey(p: string): string {
  const resolved = resolve(p)
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}

function realpathOrSelf(targetPath: string): string {
  try {
    return realpathSync(targetPath)
  } catch {
    return resolve(targetPath)
  }
}

/**
 * Lexical + symlink-safe check that `targetPath` resolves under `workspaceRoot`.
 * For non-existent paths, validates the nearest existing ancestor via realpath.
 */
export function assertInsideWorkspace(
  workspaceRoot: string,
  targetPath: string,
  options?: { allowRoot?: boolean }
): string {
  if (typeof targetPath !== 'string') {
    throw new Error(t('fs.outsideWorkspace', { path: String(targetPath ?? '') }))
  }

  // Empty / '.' mean workspace root (only valid when allowRoot)
  const normalizedTarget = targetPath.trim() === '' ? '.' : targetPath

  const rootReal = realpathOrSelf(workspaceRoot)
  const absolutePath = isAbsolute(normalizedTarget)
    ? resolve(normalizedTarget)
    : resolve(rootReal, normalizedTarget)

  const lexicalRel = relative(rootReal, absolutePath)
  if (lexicalRel.startsWith('..') || isAbsolute(lexicalRel)) {
    throw new Error(t('fs.outsideWorkspace', { path: normalizedTarget }))
  }
  if (lexicalRel === '' && !options?.allowRoot) {
    throw new Error(t('fs.outsideWorkspace', { path: normalizedTarget }))
  }

  if (existsSync(absolutePath)) {
    const targetReal = realpathOrSelf(absolutePath)
    const realRel = relative(rootReal, targetReal)
    if (realRel.startsWith('..') || isAbsolute(realRel)) {
      throw new Error(t('fs.outsideWorkspace', { path: normalizedTarget }))
    }
    if (realRel === '' && !options?.allowRoot) {
      throw new Error(t('fs.outsideWorkspace', { path: normalizedTarget }))
    }
    return targetReal
  }

  // Non-existent path: ensure parent chain cannot escape via symlink
  let parent = pathDirname(absolutePath)
  while (true) {
    if (existsSync(parent)) {
      const parentReal = realpathOrSelf(parent)
      const parentRel = relative(rootReal, parentReal)
      if (parentRel.startsWith('..') || isAbsolute(parentRel)) {
        throw new Error(t('fs.outsideWorkspace', { path: normalizedTarget }))
      }
      const suffix = relative(parent, absolutePath)
      return join(parentReal, suffix)
    }
    const next = pathDirname(parent)
    if (next === parent) break
    parent = next
  }

  return absolutePath
}

/** Require an active workspace and assert the path is inside it. */
export function assertActiveWorkspacePath(
  targetPath: string,
  options?: { allowRoot?: boolean }
): string {
  if (!activeWorkspaceRoot) {
    throw new Error(t('fs.noWorkspace'))
  }
  return assertInsideWorkspace(activeWorkspaceRoot, targetPath, options)
}

export function assertActiveWorkspacePaths(
  paths: string[],
  options?: { allowRoot?: boolean }
): string[] {
  return paths.map((p) => assertActiveWorkspacePath(p, options))
}

/** True when path is under workspace (no throw). */
export function isPathInsideWorkspace(workspaceRoot: string, targetPath: string): boolean {
  try {
    assertInsideWorkspace(workspaceRoot, targetPath, { allowRoot: true })
    return true
  } catch {
    return false
  }
}

/** Symlink-safe check that path is under a directory (e.g. outbox). */
export function isPathUnderDir(dir: string, targetPath: string): boolean {
  try {
    const dirReal = realpathOrSelf(dir)
    if (!existsSync(targetPath)) {
      const abs = resolve(targetPath)
      const rel = relative(dirReal, abs)
      return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)
    }
    const targetReal = realpathOrSelf(targetPath)
    const rel = relative(dirReal, targetReal)
    return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)
  } catch {
    return false
  }
}

export function resetPathGuardForTests(): void {
  activeWorkspaceRoot = null
  externalContextAllowlist.clear()
}

export { isSensitivePath as isSensitiveAgentPath } from '../../src/utils/sensitive-path'
export { isSensitivePath as isSensitiveAutoApplyPath } from '../../src/utils/sensitive-path'

export type SafeApiBaseUrlOptions = {
  /** Allow RFC1918 private LAN hosts (e.g. Ollama on 192.168.x.x). Metadata always blocked. */
  allowPrivateLan?: boolean
}

/** Reject private/link-local/metadata hosts for custom API base URLs (SSRF). */
export function assertSafeApiBaseUrl(
  apiBaseUrl: string,
  options?: SafeApiBaseUrlOptions
): string {
  const trimmed = apiBaseUrl.trim()
  if (!trimmed) {
    throw new Error(t('ai.missingBaseUrl'))
  }

  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    throw new Error(t('ai.invalidBaseUrl'))
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(t('ai.invalidBaseUrl'))
  }

  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '')

  if (isMetadataHost(host)) {
    throw new Error(t('ai.privateBaseUrlBlocked'))
  }

  const isLoopback = host === 'localhost' || host === '127.0.0.1' || host === '::1'

  if (!isLoopback && isPrivateLanHost(host) && !options?.allowPrivateLan) {
    throw new Error(t('ai.privateBaseUrlBlocked'))
  }

  return trimmed.replace(/\/$/, '')
}

function isMetadataHost(host: string): boolean {
  if (host === 'metadata.google.internal') return true
  if (host === '0.0.0.0') return true
  // Link-local / cloud metadata
  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host)
  if (ipv4) {
    const [a, b] = ipv4.slice(1).map(Number)
    if (a === 169 && b === 254) return true
  }
  if (host.startsWith('fe80')) return true
  return false
}

function isPrivateLanHost(host: string): boolean {
  if (host.endsWith('.local')) return true

  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host)
  if (ipv4) {
    const parts = ipv4.slice(1).map(Number)
    if (parts.some((n) => n > 255)) return true
    const [a, b] = parts
    if (a === 10) return true
    if (a === 127) return true
    if (a === 0) return true
    if (a === 172 && b >= 16 && b <= 31) return true
    if (a === 192 && b === 168) return true
    if (a === 100 && b >= 64 && b <= 127) return true // CGNAT
    return false
  }

  if (host.includes(':')) {
    if (host.startsWith('fc') || host.startsWith('fd')) return true
  }

  return false
}
