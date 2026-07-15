/**
 * Smart in-run cache for Agent readFile results.
 * Prevents re-dumping the same file into the model context when mtime is unchanged.
 */

export interface CachedReadEntry {
  relativePath: string
  mtimeMs: number
  size: number
  charCount: number
  /** Compact outline (symbols / headings) */
  outline: string
  /** First-read full content returned to the model */
  content: string
  readCount: number
}

export interface AgentReadCache {
  entries: Map<string, CachedReadEntry>
}

const MAX_CACHED_FILES = 40
const MAX_OUTLINE_CHARS = 400

export function createAgentReadCache(): AgentReadCache {
  return { entries: new Map() }
}

function normalizePath(relativePath: string): string {
  return relativePath.replace(/\\/g, '/').replace(/^\.\//, '')
}

/** Build a short outline from file text for cache-hit replies. */
export function buildFileOutline(relativePath: string, text: string): string {
  const names: string[] = []
  const lines = text.split('\n')
  const isPy = relativePath.endsWith('.py')
  const isMd = /\.(md|mdx)$/i.test(relativePath)

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    let match: RegExpMatchArray | null = null

    if (isMd) {
      match = line.match(/^#{1,3}\s+(.+)$/)
      if (match) names.push(`# ${match[1].trim()}`)
    } else if (isPy) {
      if ((match = line.match(/^(?:async\s+)?def\s+(\w+)/))) {
        names.push(`${match[1]}@L${i + 1}`)
      } else if ((match = line.match(/^class\s+(\w+)/))) {
        names.push(`class ${match[1]}@L${i + 1}`)
      }
    } else {
      if ((match = line.match(/(?:export\s+)?(?:async\s+)?function\s+(\w+)/))) {
        names.push(`${match[1]}()@L${i + 1}`)
      } else if ((match = line.match(/(?:export\s+)?class\s+(\w+)/))) {
        names.push(`class ${match[1]}@L${i + 1}`)
      } else if ((match = line.match(/(?:export\s+)?interface\s+(\w+)/))) {
        names.push(`interface ${match[1]}@L${i + 1}`)
      } else if ((match = line.match(/(?:export\s+)?type\s+(\w+)\s*=/))) {
        names.push(`type ${match[1]}@L${i + 1}`)
      } else if ((match = line.match(/export\s+(?:default\s+)?(?:async\s+)?(?:function|class)\s+(\w+)/))) {
        names.push(`export ${match[1]}@L${i + 1}`)
      }
    }
    if (names.length >= 12) break
  }

  const outline = names.join(', ')
  if (outline.length <= MAX_OUTLINE_CHARS) return outline
  return `${outline.slice(0, MAX_OUTLINE_CHARS - 1)}…`
}

export function getCachedRead(
  cache: AgentReadCache,
  relativePath: string
): CachedReadEntry | undefined {
  return cache.entries.get(normalizePath(relativePath))
}

export function putCachedRead(
  cache: AgentReadCache,
  entry: Omit<CachedReadEntry, 'readCount'> & { readCount?: number }
): CachedReadEntry {
  const key = normalizePath(entry.relativePath)
  const stored: CachedReadEntry = {
    ...entry,
    relativePath: key,
    readCount: entry.readCount ?? 1
  }
  cache.entries.set(key, stored)

  if (cache.entries.size > MAX_CACHED_FILES) {
    // Drop oldest insertion order
    const firstKey = cache.entries.keys().next().value
    if (firstKey) cache.entries.delete(firstKey)
  }
  return stored
}

export function invalidateCachedRead(
  cache: AgentReadCache,
  relativePath: string
): void {
  cache.entries.delete(normalizePath(relativePath))
}

export function invalidateCachedPaths(
  cache: AgentReadCache,
  paths: string[]
): void {
  for (const p of paths) invalidateCachedRead(cache, p)
}

/**
 * Format a cache-hit observation so the model knows content is already in-thread.
 */
export function formatCacheHit(entry: CachedReadEntry): {
  ok: true
  summary: string
  content: string
} {
  entry.readCount += 1
  const outline = entry.outline || '(no symbols extracted)'
  return {
    ok: true,
    summary: `Cached ${entry.relativePath} (unchanged, skip full re-read)`,
    content: [
      `# ${entry.relativePath} [cached — already read this run]`,
      `chars: ${entry.charCount}`,
      `mtimeMs: ${entry.mtimeMs}`,
      `size: ${entry.size}`,
      `reads: ${entry.readCount}`,
      `Outline: ${outline}`,
      '',
      'Full contents were returned on the earlier readFile in this conversation.',
      'Prefer that observation or Agent working memory. Pass force=true to re-read from disk.'
    ].join('\n')
  }
}
