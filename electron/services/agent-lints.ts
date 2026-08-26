import { existsSync } from 'fs'
import { join } from 'path'
import type { AgentLintDiagnostic } from '../../src/utils/agent-lint-parse'
import {
  filterDiagnosticsToPaths,
  formatDiagnosticsForModel,
  parseEslintUnixDiagnostics,
  parseTscDiagnostics
} from '../../src/utils/agent-lint-parse'
import { runAgentExec } from './agent-exec'
import { normalizeAgentRelativePath } from './agent-paths'
import { resolveInsideWorkspace } from './filesystem'

function quoteArg(value: string): string {
  if (!/[ \t"]/.test(value)) return value
  return `"${value.replace(/"/g, '\\"')}"`
}

function toRelative(workspaceRoot: string, pathArg: string): string {
  return normalizeAgentRelativePath(workspaceRoot, pathArg, { defaultToRoot: false })
}

export async function runAgentLints(options: {
  workspaceRoot: string
  paths: string[]
  signal: AbortSignal
}): Promise<{ ok: boolean; summary: string; content: string }> {
  const { workspaceRoot, signal } = options
  const relPaths = options.paths
    .filter((p): p is string => typeof p === 'string' && p.trim().length > 0)
    .map((p) => toRelative(workspaceRoot, p))
    .filter((p) => p && p !== '.')
    .slice(0, 40)

  if (relPaths.length === 0) {
    return {
      ok: false,
      summary: 'paths required',
      content: 'Error: readLints requires one or more relative file paths'
    }
  }

  for (const rel of relPaths) {
    try {
      resolveInsideWorkspace(workspaceRoot, rel)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return { ok: false, summary: message, content: `Error: ${message}` }
    }
  }

  const diagnostics: AgentLintDiagnostic[] = []
  const notes: string[] = []
  const hasTsconfig = existsSync(join(workspaceRoot, 'tsconfig.json'))
  const tsFiles = relPaths.filter((p) => /\.(ts|tsx|mts|cts)$/i.test(p))

  if (hasTsconfig && tsFiles.length > 0) {
    const tsc = await runAgentExec({
      workspaceRoot,
      command: 'npx --no-install tsc --noEmit --pretty false',
      timeoutMs: 60_000,
      signal,
      approvalGranted: true
    })
    if (tsc.denied) {
      notes.push(`tsc skipped: ${tsc.summary}`)
    } else {
      const parsed = filterDiagnosticsToPaths(
        parseTscDiagnostics(`${tsc.stdout}\n${tsc.stderr}`),
        tsFiles
      )
      diagnostics.push(...parsed)
      if (!tsc.ok && parsed.length === 0) {
        notes.push(`tsc exited ${tsc.exitCode ?? '?'} with no path-filtered diagnostics`)
      }
    }
  }

  const jsLike = relPaths.filter((p) => /\.(js|jsx|mjs|cjs|ts|tsx|mts|cts|vue)$/i.test(p))
  if (jsLike.length > 0) {
    const eslintBin =
      existsSync(join(workspaceRoot, 'node_modules', 'eslint')) ||
      existsSync(join(workspaceRoot, 'eslint.config.js')) ||
      existsSync(join(workspaceRoot, 'eslint.config.mjs')) ||
      existsSync(join(workspaceRoot, '.eslintrc.js')) ||
      existsSync(join(workspaceRoot, '.eslintrc.cjs')) ||
      existsSync(join(workspaceRoot, '.eslintrc.json'))
    if (eslintBin) {
      const args = jsLike.map((p) => quoteArg(p)).join(' ')
      const lint = await runAgentExec({
        workspaceRoot,
        command: `npx --no-install eslint --no-error-on-unmatched-pattern -f unix ${args}`,
        timeoutMs: 60_000,
        signal,
        approvalGranted: true
      })
      if (lint.denied) {
        notes.push(`eslint skipped: ${lint.summary}`)
      } else {
        const parsed = filterDiagnosticsToPaths(
          parseEslintUnixDiagnostics(`${lint.stdout}\n${lint.stderr}`),
          jsLike
        )
        diagnostics.push(...parsed)
      }
    }
  }

  if (diagnostics.length === 0 && notes.length === 0 && !hasTsconfig) {
    return {
      ok: true,
      summary: 'no diagnostics tools',
      content:
        'No TypeScript/ESLint diagnostics ran (no tsconfig.json / eslint config for these paths). Use verify for project scripts.'
    }
  }

  const body = [
    `# readLints (${relPaths.join(', ')})`,
    formatDiagnosticsForModel(diagnostics),
    notes.length > 0 ? notes.join('\n') : ''
  ]
    .filter(Boolean)
    .join('\n\n')

  return {
    ok: diagnostics.length === 0,
    summary:
      diagnostics.length === 0
        ? 'no diagnostics'
        : `${diagnostics.length} diagnostic(s)`,
    content: body
  }
}
