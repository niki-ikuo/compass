export interface AgentLintDiagnostic {
  path: string
  line: number
  column: number
  message: string
  source: 'tsc' | 'eslint' | 'other'
}

/** `file(line,col): error TSxxxx: message` */
const TSC_LINE =
  /^(.+?)\((\d+),(\d+)\):\s+(?:error|warning)\s+TS\d+:\s*(.+)$/

/** unix eslint: `path:line:col: message [Error/...]` */
const ESLINT_UNIX = /^(.+?):(\d+):(\d+):\s+(.+)$/

export function parseTscDiagnostics(output: string): AgentLintDiagnostic[] {
  const out: AgentLintDiagnostic[] = []
  for (const raw of output.split(/\r?\n/)) {
    const line = raw.trim()
    const match = TSC_LINE.exec(line)
    if (!match) continue
    out.push({
      path: normalizeSlashes(match[1]),
      line: Number(match[2]),
      column: Number(match[3]),
      message: match[4].trim(),
      source: 'tsc'
    })
  }
  return out
}

export function parseEslintUnixDiagnostics(output: string): AgentLintDiagnostic[] {
  const out: AgentLintDiagnostic[] = []
  for (const raw of output.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('Oops') || line.startsWith('Error:')) continue
    const match = ESLINT_UNIX.exec(line)
    if (!match) continue
    // Avoid swallowing tsc-shaped lines that also match path:line:col
    if (/\(\d+,\d+\):/.test(line)) continue
    out.push({
      path: normalizeSlashes(match[1]),
      line: Number(match[2]),
      column: Number(match[3]),
      message: match[4].trim(),
      source: 'eslint'
    })
  }
  return out
}

export function filterDiagnosticsToPaths(
  diagnostics: AgentLintDiagnostic[],
  relativePaths: string[]
): AgentLintDiagnostic[] {
  const wanted = new Set(relativePaths.map((p) => normalizeSlashes(p).toLowerCase()))
  if (wanted.size === 0) return diagnostics
  return diagnostics.filter((d) => {
    const n = normalizeSlashes(d.path).toLowerCase()
    for (const w of wanted) {
      if (n === w || n.endsWith(`/${w}`) || n.endsWith(`\\${w}`)) return true
      if (n.endsWith(w) && (n.length === w.length || n[n.length - w.length - 1] === '/')) {
        return true
      }
    }
    return false
  })
}

export function formatDiagnosticsForModel(diagnostics: AgentLintDiagnostic[]): string {
  if (diagnostics.length === 0) return 'No diagnostics on the given paths.'
  return diagnostics
    .map((d) => `${d.path}:${d.line}:${d.column} [${d.source}] ${d.message}`)
    .join('\n')
}

function normalizeSlashes(path: string): string {
  return path.replace(/\\/g, '/')
}
