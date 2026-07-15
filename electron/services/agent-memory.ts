/**
 * Compact working memory for Agent runs.
 * Important observations stay as native conversation state (re-injected),
 * instead of relying only on truncated prior tool blobs.
 */

export type AgentMemoryKind =
  | 'read'
  | 'search'
  | 'exec'
  | 'write'
  | 'note'
  | 'other'

export interface AgentMemoryEntry {
  id: string
  kind: AgentMemoryKind
  /** Short fact the model should keep in mind */
  text: string
  /** Optional workspace-relative path this note is about */
  path?: string
  createdAt: number
}

export interface AgentMemoryState {
  entries: AgentMemoryEntry[]
}

const MAX_ENTRIES = 24
const MAX_ENTRY_CHARS = 280
const MAX_MEMORY_BLOCK_CHARS = 4_500

export function createAgentMemoryState(): AgentMemoryState {
  return { entries: [] }
}

function nextId(state: AgentMemoryState, prefix: string): string {
  return `${prefix}_${state.entries.length + 1}`
}

function trimEntryText(text: string): string {
  const cleaned = text.replace(/\s+/g, ' ').trim()
  if (cleaned.length <= MAX_ENTRY_CHARS) return cleaned
  return `${cleaned.slice(0, MAX_ENTRY_CHARS - 1)}…`
}

function upsertByPath(
  state: AgentMemoryState,
  kind: AgentMemoryKind,
  path: string,
  text: string
): void {
  const existing = state.entries.findIndex(
    (e) => e.kind === kind && e.path === path
  )
  const entry: AgentMemoryEntry = {
    id: existing >= 0 ? state.entries[existing].id : nextId(state, kind),
    kind,
    path,
    text: trimEntryText(text),
    createdAt: Date.now()
  }
  if (existing >= 0) {
    state.entries[existing] = entry
  } else {
    state.entries.push(entry)
  }
  if (state.entries.length > MAX_ENTRIES) {
    state.entries = state.entries.slice(-MAX_ENTRIES)
  }
}

function pushEntry(
  state: AgentMemoryState,
  kind: AgentMemoryKind,
  text: string,
  path?: string
): void {
  state.entries.push({
    id: nextId(state, kind),
    kind,
    path,
    text: trimEntryText(text),
    createdAt: Date.now()
  })
  if (state.entries.length > MAX_ENTRIES) {
    state.entries = state.entries.slice(-MAX_ENTRIES)
  }
}

/** Explicit note from the model (`remember` tool). */
export function applyRemember(
  state: AgentMemoryState,
  args: Record<string, unknown>
): { ok: boolean; summary: string; content: string } {
  const note =
    typeof args.note === 'string'
      ? args.note.trim()
      : typeof args.text === 'string'
        ? args.text.trim()
        : ''
  if (!note) {
    return {
      ok: false,
      summary: 'note is required',
      content: 'Error: remember requires a non-empty note string'
    }
  }
  const path =
    typeof args.path === 'string' && args.path.trim()
      ? args.path.trim().replace(/\\/g, '/')
      : undefined

  pushEntry(state, 'note', note, path)
  const rendered = formatAgentMemoryForModel(state)
  return {
    ok: true,
    summary: `Remembered (${state.entries.length} notes)`,
    content: rendered ?? `Remembered:\n- ${trimEntryText(note)}`
  }
}

export function sanitizeRememberArgs(args: Record<string, unknown>): Record<string, unknown> {
  const note =
    typeof args.note === 'string'
      ? args.note
      : typeof args.text === 'string'
        ? args.text
        : ''
  const truncated = note.length > 160 ? `${note.slice(0, 160)}…` : note
  return {
    note: truncated,
    path: typeof args.path === 'string' ? args.path.slice(0, 120) : undefined,
    noteChars: note.length
  }
}

/** Auto-capture a brief from a successful tool observation. */
export function recordToolObservation(
  state: AgentMemoryState,
  toolName: string,
  args: Record<string, unknown>,
  result: { ok: boolean; summary: string; content: string }
): void {
  if (!result.ok) return

  if (toolName === 'readFile') {
    const path =
      typeof args.path === 'string' ? args.path.replace(/\\/g, '/') : ''
    if (!path || path === '.') return
    const outline = extractOutlineFromReadContent(result.content)
    const summary = result.summary.trim() || `Read ${path}`
    upsertByPath(
      state,
      'read',
      path,
      outline ? `${summary}. Outline: ${outline}` : summary
    )
    return
  }

  if (toolName === 'search') {
    const query = typeof args.query === 'string' ? args.query.trim() : ''
    if (!query) return
    const hits = extractSearchHitPaths(result.content).slice(0, 5)
    const hitPart = hits.length > 0 ? ` → ${hits.join(', ')}` : ''
    pushEntry(state, 'search', `search "${query}" — ${result.summary}${hitPart}`)
    return
  }

  if (toolName === 'exec') {
    const command = typeof args.command === 'string' ? args.command.trim() : ''
    if (!command) return
    const shortCmd =
      command.length > 80 ? `${command.slice(0, 80)}…` : command
    pushEntry(state, 'exec', `exec \`${shortCmd}\` — ${result.summary}`)
    return
  }

  if (toolName === 'verify') {
    pushEntry(state, 'exec', `verify — ${result.summary}`)
    return
  }

  if (toolName === 'proposeActions') {
    pushEntry(state, 'write', result.summary)
  }
}

function extractOutlineFromReadContent(content: string): string {
  // Prefer an explicit Outline: line from the smart-cache / read helper
  const outlineMatch = content.match(/^Outline:\s*(.+)$/m)
  if (outlineMatch) return outlineMatch[1].trim()

  const lines = content.split('\n')
  const names: string[] = []
  for (const line of lines) {
    const m =
      line.match(/^(?:export\s+)?(?:async\s+)?function\s+(\w+)/) ||
      line.match(/^(?:export\s+)?class\s+(\w+)/) ||
      line.match(/^(?:export\s+)?(?:interface|type)\s+(\w+)/) ||
      line.match(/^def\s+(\w+)/) ||
      line.match(/^class\s+(\w+)/)
    if (m) names.push(m[1])
    if (names.length >= 8) break
  }
  return names.join(', ')
}

function extractSearchHitPaths(content: string): string[] {
  const paths: string[] = []
  const seen = new Set<string>()
  for (const line of content.split('\n')) {
    // workspace-search lines look like: path:line:… or "## path"
    const hash = line.match(/^##\s+(\S+)/)
    if (hash) {
      const p = hash[1]
      if (!seen.has(p)) {
        seen.add(p)
        paths.push(p)
      }
      continue
    }
    const colon = line.match(/^([^\s:][^:]*)?:\d+/)
    if (colon?.[1] && !seen.has(colon[1])) {
      seen.add(colon[1])
      paths.push(colon[1])
    }
  }
  return paths
}

/**
 * Compact memory block for Continue / follow-up injection.
 * Returns null when empty.
 */
export function formatAgentMemoryForModel(state: AgentMemoryState): string | null {
  if (state.entries.length === 0) return null

  const header =
    '[Agent working memory — important findings kept as conversation state. Prefer these over re-reading; update with remember when you learn something durable.]'
  const lines = state.entries.map((e) => {
    const prefix = e.path ? `${e.kind}:${e.path}` : e.kind
    return `- (${prefix}) ${e.text}`
  })

  let body = lines.join('\n')
  if (header.length + body.length + 2 > MAX_MEMORY_BLOCK_CHARS) {
    // Keep newest entries
    const kept: string[] = []
    let used = header.length + 40
    for (let i = lines.length - 1; i >= 0; i--) {
      if (used + lines[i].length + 1 > MAX_MEMORY_BLOCK_CHARS) break
      kept.unshift(lines[i])
      used += lines[i].length + 1
    }
    body = ['...(older memory omitted)', ...kept].join('\n')
  }

  return `${header}\n${body}`
}

/** Rebuild memory from prior agentSteps (remember calls + heuristic summaries). */
export function rebuildMemoryFromSteps(
  steps: Array<{
    name: string
    args?: Record<string, unknown>
    status?: string
    ok?: boolean
    summary?: string
    observation?: string
  }>
): AgentMemoryState {
  const state = createAgentMemoryState()
  for (const step of steps) {
    if (step.status === 'error' || step.ok === false) continue
    if (step.name === 'remember' && step.args) {
      applyRemember(state, step.args)
      continue
    }
    // Reconstruct light auto-notes from summaries when full content is gone
    if (step.name === 'readFile' && step.args && step.summary) {
      recordToolObservation(state, 'readFile', step.args, {
        ok: true,
        summary: step.summary,
        content: step.observation ?? ''
      })
    } else if (step.name === 'search' && step.args && step.summary) {
      recordToolObservation(state, 'search', step.args, {
        ok: true,
        summary: step.summary,
        content: step.observation ?? ''
      })
    } else if (step.name === 'exec' && step.args && step.summary) {
      recordToolObservation(state, 'exec', step.args, {
        ok: true,
        summary: step.summary,
        content: ''
      })
    } else if (step.name === 'verify' && step.summary) {
      recordToolObservation(state, 'verify', step.args ?? {}, {
        ok: true,
        summary: step.summary,
        content: ''
      })
    } else if (step.name === 'proposeActions' && step.summary) {
      recordToolObservation(state, 'proposeActions', {}, {
        ok: true,
        summary: step.summary,
        content: ''
      })
    }
  }
  return state
}
