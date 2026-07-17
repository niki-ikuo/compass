import { existsSync } from 'fs'
import { readFile } from 'fs/promises'
import { join } from 'path'
import type { UseCasePreset } from '../../src/types'
import { normalizeUseCasePreset, DEFAULT_SETTINGS } from '../../src/types'
import { runAgentExec, type AgentExecResult } from './agent-exec'
import { runUseCaseLightVerify, shouldRunShellVerify } from './agent-verify-light'

export type AgentVerifyCheck = 'test' | 'lint' | 'typecheck' | 'headings' | 'schema'

export type AgentVerifyCommandSource = 'script' | 'fallback' | 'missing'

export interface ResolvedVerifyCommand {
  check: 'test' | 'lint' | 'typecheck'
  command: string | null
  source: AgentVerifyCommandSource
  /** npm script name when source === 'script' */
  scriptName?: string
  reason?: string
}

export interface AgentVerifyOptions {
  workspaceRoot: string
  checks?: Array<'test' | 'lint' | 'typecheck'>
  cwd?: string
  timeoutMs?: number
  signal: AbortSignal
  /** 用途プリセット — document/data は軽量チェック、code は従来の shell verify */
  preset?: UseCasePreset | null
  /** 変更ファイル等の相対パス（document/data light verify 用） */
  paths?: string[]
}

export interface AgentVerifyCheckResult {
  check: AgentVerifyCheck
  command: string | null
  source: AgentVerifyCommandSource
  scriptName?: string
  skipped: boolean
  ok: boolean
  summary: string
  exitCode: number | null
  stdout: string
  stderr: string
}

export interface AgentVerifyResult {
  ok: boolean
  checks: AgentVerifyCheckResult[]
  summary: string
  content: string
}

const ALL_CHECKS: Array<'test' | 'lint' | 'typecheck'> = ['test', 'lint', 'typecheck']

const SCRIPT_CANDIDATES: Record<'test' | 'lint' | 'typecheck', string[]> = {
  test: ['test', 'test:unit', 'test:ci', 'vitest', 'jest'],
  lint: ['lint', 'lint:check', 'eslint', 'check:lint'],
  typecheck: ['typecheck', 'type-check', 'type:check', 'tsc', 'check:types']
}

type PackageManager = 'npm' | 'pnpm' | 'yarn' | 'bun'

type PackageJsonLite = {
  scripts?: Record<string, string>
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
}

function normalizeChecks(raw: unknown): Array<'test' | 'lint' | 'typecheck'> {
  if (!Array.isArray(raw) || raw.length === 0) return [...ALL_CHECKS]
  const out: Array<'test' | 'lint' | 'typecheck'> = []
  for (const item of raw) {
    if (item === 'test' || item === 'lint' || item === 'typecheck') {
      if (!out.includes(item)) out.push(item)
    }
  }
  return out.length > 0 ? out : [...ALL_CHECKS]
}

export function normalizeVerifyChecks(raw: unknown): Array<'test' | 'lint' | 'typecheck'> {
  return normalizeChecks(raw)
}

function detectPackageManager(root: string): PackageManager {
  if (existsSync(join(root, 'pnpm-lock.yaml'))) return 'pnpm'
  if (existsSync(join(root, 'yarn.lock'))) return 'yarn'
  if (existsSync(join(root, 'bun.lockb')) || existsSync(join(root, 'bun.lock'))) return 'bun'
  return 'npm'
}

function runScriptCommand(pm: PackageManager, script: string): string {
  switch (pm) {
    case 'pnpm':
      return `pnpm run ${script}`
    case 'yarn':
      return `yarn ${script}`
    case 'bun':
      return `bun run ${script}`
    default:
      return `npm run ${script}`
  }
}

function execBinCommand(pm: PackageManager, binArgs: string): string {
  switch (pm) {
    case 'pnpm':
      return `pnpm exec ${binArgs}`
    case 'yarn':
      return `yarn ${binArgs}`
    case 'bun':
      return `bunx ${binArgs}`
    default:
      return `npx --no-install ${binArgs}`
  }
}

async function readPackageJson(root: string): Promise<PackageJsonLite | null> {
  const path = join(root, 'package.json')
  if (!existsSync(path)) return null
  try {
    const raw = await readFile(path, 'utf8')
    const parsed = JSON.parse(raw) as PackageJsonLite
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
}

function findScript(
  scripts: Record<string, string> | undefined,
  check: 'test' | 'lint' | 'typecheck'
): string | null {
  if (!scripts) return null
  for (const name of SCRIPT_CANDIDATES[check]) {
    if (typeof scripts[name] === 'string' && scripts[name].trim()) return name
  }
  return null
}

function hasDep(pkg: PackageJsonLite, name: string): boolean {
  return Boolean(pkg.dependencies?.[name] || pkg.devDependencies?.[name])
}

function resolveNodeFallback(
  root: string,
  pkg: PackageJsonLite,
  pm: PackageManager,
  check: 'test' | 'lint' | 'typecheck'
): ResolvedVerifyCommand | null {
  if (check === 'typecheck' && existsSync(join(root, 'tsconfig.json'))) {
    return {
      check,
      command: execBinCommand(pm, 'tsc --noEmit'),
      source: 'fallback',
      reason: 'tsconfig.json present; no typecheck script'
    }
  }
  if (check === 'lint' && (hasDep(pkg, 'eslint') || hasDep(pkg, 'eslint-config'))) {
    return {
      check,
      command: execBinCommand(pm, 'eslint .'),
      source: 'fallback',
      reason: 'eslint dependency present; no lint script'
    }
  }
  if (check === 'test' && (hasDep(pkg, 'vitest') || hasDep(pkg, 'jest'))) {
    const bin = hasDep(pkg, 'vitest') ? 'vitest run' : 'jest'
    return {
      check,
      command: execBinCommand(pm, bin),
      source: 'fallback',
      reason: `${bin.split(' ')[0]} dependency present; no test script`
    }
  }
  return null
}

function resolveNonNodeFallback(
  root: string,
  check: 'test' | 'lint' | 'typecheck'
): ResolvedVerifyCommand | null {
  if (existsSync(join(root, 'Cargo.toml'))) {
    if (check === 'test') {
      return { check, command: 'cargo test', source: 'fallback', reason: 'Cargo.toml' }
    }
    if (check === 'typecheck') {
      return { check, command: 'cargo check', source: 'fallback', reason: 'Cargo.toml' }
    }
    if (check === 'lint') {
      return {
        check,
        command: 'cargo clippy -- -D warnings',
        source: 'fallback',
        reason: 'Cargo.toml'
      }
    }
  }
  if (existsSync(join(root, 'go.mod'))) {
    if (check === 'test') {
      return { check, command: 'go test ./...', source: 'fallback', reason: 'go.mod' }
    }
    if (check === 'typecheck') {
      return { check, command: 'go build ./...', source: 'fallback', reason: 'go.mod' }
    }
  }
  if (
    existsSync(join(root, 'pyproject.toml')) ||
    existsSync(join(root, 'pytest.ini')) ||
    existsSync(join(root, 'setup.cfg'))
  ) {
    if (check === 'test') {
      return { check, command: 'pytest', source: 'fallback', reason: 'Python project markers' }
    }
  }
  return null
}

/**
 * Resolve which shell commands to run for the requested verify checks.
 * Pure-ish (async only for package.json); safe to unit-test with a fixture root.
 */
export async function resolveVerifyCommands(
  workspaceRoot: string,
  checks: Array<'test' | 'lint' | 'typecheck'> = ALL_CHECKS
): Promise<ResolvedVerifyCommand[]> {
  const pkg = await readPackageJson(workspaceRoot)
  const pm = detectPackageManager(workspaceRoot)
  const resolved: ResolvedVerifyCommand[] = []

  for (const check of checks) {
    if (pkg) {
      const scriptName = findScript(pkg.scripts, check)
      if (scriptName) {
        resolved.push({
          check,
          command: runScriptCommand(pm, scriptName),
          source: 'script',
          scriptName
        })
        continue
      }
      const nodeFallback = resolveNodeFallback(workspaceRoot, pkg, pm, check)
      if (nodeFallback) {
        resolved.push(nodeFallback)
        continue
      }
    }

    const other = resolveNonNodeFallback(workspaceRoot, check)
    if (other) {
      resolved.push(other)
      continue
    }

    resolved.push({
      check,
      command: null,
      source: 'missing',
      reason: 'no matching script or safe fallback found'
    })
  }

  return resolved
}

function formatCheckBlock(result: AgentVerifyCheckResult): string {
  const lines = [
    `## ${result.check}`,
    `source: ${result.source}${result.scriptName ? ` (${result.scriptName})` : ''}`,
    `command: ${result.command ?? '(none)'}`,
    `ok: ${result.ok}`,
    result.skipped ? 'skipped: true' : null,
    result.exitCode !== null ? `exitCode: ${result.exitCode}` : null,
    `summary: ${result.summary}`,
    '',
    '### stdout',
    result.stdout || '(empty)',
    '',
    '### stderr',
    result.stderr || '(empty)'
  ]
  return lines.filter((line) => line !== null).join('\n')
}

/**
 * Run structured verify checks (test / lint / typecheck) via agent-exec templates,
 * plus use-case light checks for document / data presets.
 */
export async function runAgentVerify(options: AgentVerifyOptions): Promise<AgentVerifyResult> {
  const results: AgentVerifyCheckResult[] = []

  if (shouldRunShellVerify(options.preset)) {
    const checks = normalizeChecks(options.checks)
    const resolved = await resolveVerifyCommands(options.workspaceRoot, checks)

    for (const entry of resolved) {
      if (!entry.command) {
        results.push({
          check: entry.check,
          command: null,
          source: entry.source,
          scriptName: entry.scriptName,
          skipped: true,
          ok: true,
          summary: entry.reason ?? 'no command',
          exitCode: null,
          stdout: '',
          stderr: ''
        })
        continue
      }

      if (options.signal.aborted) {
        results.push({
          check: entry.check,
          command: entry.command,
          source: entry.source,
          scriptName: entry.scriptName,
          skipped: true,
          ok: false,
          summary: 'aborted',
          exitCode: null,
          stdout: '',
          stderr: ''
        })
        break
      }

      const execResult: AgentExecResult = await runAgentExec({
        workspaceRoot: options.workspaceRoot,
        command: entry.command,
        cwd: options.cwd,
        timeoutMs: options.timeoutMs,
        signal: options.signal
      })

      results.push({
        check: entry.check,
        command: entry.command,
        source: entry.source,
        scriptName: entry.scriptName,
        skipped: false,
        ok: execResult.ok,
        summary: execResult.summary,
        exitCode: execResult.exitCode,
        stdout: execResult.stdout,
        stderr: execResult.stderr
      })
    }
  }

  if (!options.signal.aborted) {
    const light = await runUseCaseLightVerify({
      workspaceRoot: options.workspaceRoot,
      preset: options.preset,
      paths: options.paths
    })
    results.push(...light)
  }

  const runnable = results.filter((r) => !r.skipped)
  const failed = runnable.filter((r) => !r.ok)
  const skipped = results.filter((r) => r.skipped)
  const allMissing =
    results.length > 0 && results.every((r) => r.skipped && r.source === 'missing')
  const ok =
    results.length === 0
      ? true
      : runnable.length > 0
        ? failed.length === 0
        : allMissing

  const summaryParts: string[] = []
  if (results.length === 0) {
    summaryParts.push('verify skipped for this use case')
  } else if (runnable.length === 0) {
    summaryParts.push('no verify commands available')
  } else if (ok) {
    summaryParts.push(`verify ok (${runnable.map((r) => r.check).join(', ')})`)
  } else {
    summaryParts.push(
      `verify failed: ${failed.map((r) => r.check).join(', ') || 'unknown'}`
    )
  }
  if (skipped.length > 0) {
    summaryParts.push(`skipped ${skipped.map((r) => r.check).join(', ')}`)
  }

  const content = [
    '# verify',
    `ok: ${ok}`,
    `summary: ${summaryParts.join('; ')}`,
    '',
    ...results.map(formatCheckBlock)
  ].join('\n')

  return {
    ok,
    checks: results,
    summary: summaryParts.join('; '),
    content
  }
}

/** Nudge appended after successful proposeActions apply (code preset). */
export const VERIFY_AFTER_APPLY_NUDGE =
  'After applying changes, run the verify tool (test / lint / typecheck as available) or an equivalent exec command before finishing. If verify fails, fix with proposeActions and verify again. If verify only skips because scripts are missing, do not mention that in the final reply—the timeline already shows it.'

export function getVerifyAfterApplyNudge(preset?: UseCasePreset | null): string {
  const resolved = normalizeUseCasePreset(preset) ?? DEFAULT_SETTINGS.defaultUseCasePreset
  if (resolved === 'document') {
    return 'After applying changes, run the verify tool to check markdown heading structure (broken ATX / level jumps) on the edited files. If verify fails, fix with proposeActions and verify again.'
  }
  if (resolved === 'data') {
    return 'After applying changes, run the verify tool to check CSV column counts and JSON/YAML shape on the edited files. If verify fails, fix with proposeActions and verify again.'
  }
  if (resolved === 'general') {
    return 'After applying changes, you may run verify if helpful; for general workspace tidying it is optional.'
  }
  return VERIFY_AFTER_APPLY_NUDGE
}