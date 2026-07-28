import { readdir, readFile, stat } from 'fs/promises'
import { join, relative } from 'path'
import { shouldSkipWorkspaceEntry } from './fs-ignore'

const MAX_FILES = 80
const MAX_TOTAL_CHARS = 1_500_000
const MAX_EXCERPT_CHARS = 2_500

const IGNORED_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'out',
  'release',
  '.next',
  'build',
  'coverage'
])

/** Under `.compass`, only these relative prefixes/files are collected. */
function isAllowedCompassPath(relPosix: string): boolean {
  if (!relPosix.startsWith('.compass/')) return true
  const rest = relPosix.slice('.compass/'.length)
  if (
    rest.startsWith('inbox/') ||
    rest.startsWith('outbox/') ||
    rest.startsWith('digests/') ||
    rest.startsWith('templates/')
  ) {
    return true
  }
  return rest === 'rules.md' || rest === 'glossary.md'
}

function isTextCandidate(name: string): boolean {
  const lower = name.toLowerCase()
  return (
    lower.endsWith('.md') ||
    lower.endsWith('.txt') ||
    lower.endsWith('.csv') ||
    lower.endsWith('.json') ||
    lower.endsWith('.yml') ||
    lower.endsWith('.yaml') ||
    lower.endsWith('.ts') ||
    lower.endsWith('.tsx') ||
    lower.endsWith('.js') ||
    lower.endsWith('.jsx') ||
    lower.endsWith('.py') ||
    lower.endsWith('.html') ||
    lower.endsWith('.css')
  )
}

export type DigestCollectResult = {
  periodStart: string
  periodEnd: string
  digestRelativePath: string
  filesConsidered: number
  truncated: boolean
  contextBlock: string
  empty: boolean
}

function toLocalDateString(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

export async function collectDigestContext(
  workspaceRoot: string,
  now = new Date()
): Promise<DigestCollectResult> {
  const periodEnd = new Date(now)
  const periodStart = new Date(now)
  periodStart.setDate(periodStart.getDate() - 7)
  const startMs = periodStart.getTime()
  const endMs = periodEnd.getTime()

  type Hit = { abs: string; rel: string; mtimeMs: number }
  const hits: Hit[] = []

  async function walk(dir: string): Promise<void> {
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (entry.name === '.' || entry.name === '..') continue
      if (shouldSkipWorkspaceEntry(entry.name, entry.isDirectory())) continue
      if (entry.isDirectory() && IGNORED_DIRS.has(entry.name)) continue
      // Skip most of .compass except allowlist — still enter .compass to find allowlisted paths
      const abs = join(dir, entry.name)
      const rel = relative(workspaceRoot, abs).replace(/\\/g, '/')
      if (entry.isDirectory()) {
        if (entry.name === '.compass') {
          await walk(abs)
          continue
        }
        if (rel.startsWith('.compass/') && !isAllowedCompassPath(`${rel}/`)) {
          // Still allow walking inbox/outbox/digests/templates
          if (
            !rel.startsWith('.compass/inbox') &&
            !rel.startsWith('.compass/outbox') &&
            !rel.startsWith('.compass/digests') &&
            !rel.startsWith('.compass/templates')
          ) {
            continue
          }
        }
        await walk(abs)
        continue
      }
      if (!entry.isFile()) continue
      if (!isTextCandidate(entry.name)) continue
      if (!isAllowedCompassPath(rel)) continue
      try {
        const st = await stat(abs)
        if (st.mtimeMs < startMs || st.mtimeMs > endMs + 86_400_000) continue
        hits.push({ abs, rel, mtimeMs: st.mtimeMs })
      } catch {
        // skip
      }
    }
  }

  await walk(workspaceRoot)
  hits.sort((a, b) => b.mtimeMs - a.mtimeMs)

  let truncated = hits.length > MAX_FILES
  const selected = hits.slice(0, MAX_FILES)
  const parts: string[] = []
  let total = 0
  let used = 0

  for (const hit of selected) {
    try {
      const raw = await readFile(hit.abs, 'utf-8')
      const excerpt =
        raw.length > MAX_EXCERPT_CHARS
          ? `${raw.slice(0, MAX_EXCERPT_CHARS)}\n…[truncated]`
          : raw
      const block = `### ${hit.rel}\n(mtime: ${new Date(hit.mtimeMs).toISOString()})\n\n${excerpt}\n`
      if (total + block.length > MAX_TOTAL_CHARS) {
        truncated = true
        break
      }
      parts.push(block)
      total += block.length
      used += 1
    } catch {
      // skip
    }
  }

  const periodStartStr = toLocalDateString(periodStart)
  const periodEndStr = toLocalDateString(periodEnd)
  return {
    periodStart: periodStartStr,
    periodEnd: periodEndStr,
    digestRelativePath: `.compass/digests/${periodEndStr}.md`,
    filesConsidered: used,
    truncated,
    contextBlock: parts.join('\n'),
    empty: used === 0
  }
}
