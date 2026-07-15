import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import { existsSync } from 'fs'
import { basename, delimiter, dirname, isAbsolute, join, relative, resolve } from 'path'
import { redactSecrets } from '../../src/utils/redact'
import { t } from '../../src/i18n/runtime'
import { resolveInsideWorkspace } from './filesystem'
import { detectGitBash } from './terminal'

const DEFAULT_TIMEOUT_MS = 30_000
const MAX_TIMEOUT_MS = 120_000
const MAX_OUTPUT_CHARS = 64_000
const MAX_COMMAND_CHARS = 4_000

/**
 * 危険度:
 * - blocked: 実行不可（機械／ワークスペース丸ごと破壊など）
 * - needs_approval: 書き込み・削除など — ユーザー承認後のみ実行
 * - allowed: テスト・lint・読取系などそのまま実行
 */
export type AgentExecRiskLevel = 'blocked' | 'needs_approval' | 'allowed'

export type AgentExecRiskKind = 'system' | 'workspace_wipe' | 'write' | 'none'

export interface AgentExecRiskClassification {
  level: AgentExecRiskLevel
  kind: AgentExecRiskKind
  reason: string
}

/** マシン／OS を壊しうるコマンド（無条件拒否） */
const SYSTEM_DENY_PATTERNS: RegExp[] = [
  /\brm\s+-rf\s+\/($|\s)/i,
  /\brm\s+(-[a-zA-Z]*\s+)*\/\s*$/i,
  /\b(?:del|rmdir|Remove-Item)\b.*\b(?:C:\\|D:\\|\\\\)\b/i,
  /\bformat\s+[a-z]:/i,
  /\b(?:shutdown|reboot|halt|poweroff)\b/i,
  /\bmkfs\b/i,
  /\bdd\s+.*\bof=/i,
  /:\(\)\s*\{\s*:\|:\s*&\s*\}\s*;/,
  /\breg\s+delete\b/i,
  /\b(?:curl|wget)\b[^|\n]*\|\s*(?:ba)?sh\b/i,
  /\bInvoke-Expression\b/i,
  /\bIEX\s*\(/i,
  /\bDownloadString\b/i,
  /\bDownloadFile\b/i,
  /\bStart-Process\b/i,
  /\bcmd\s*\/c\s+.*(rd|rmdir)\s+\/s/i,
  /\bcipher\s*\/w:/i,
  /\bdiskpart\b/i
]

/**
 * ワークスペース全体を消しうるコマンド（無条件拒否）。
 * 例: rm -rf . / * / $PWD
 */
const WORKSPACE_WIPE_PATTERNS: RegExp[] = [
  /\brm\s+(?:-[a-zA-Z]*\s+)*(?:--\s+)?(?:\.\/|\.|\\|\*|\$PWD|\"\$PWD\"|'\$PWD'|`\$PWD`)(?:\s|$)/i,
  /\brm\s+(?:-[a-zA-Z]*\s+)+rf?\s+(?:\.\/|\.|\*)(?:\s|$)/i,
  /\brm\s+-r(?:f)?\s+(?:--\s+)?(?:\.\/|\.|\*)(?:\s|$)/i,
  /\bgit\s+clean\s+[^\n]*-[^\n]*x/i,
  /\b(?:rd|rmdir)\s+(?:\/s\s+)?(?:\/q\s+)?(?:\.|\\\.)(?:\s|$)/i,
  /\bRemove-Item\b[^\n]*-(?:Recurse|Force)[^\n]*(?:\.|\*)(?:\s|$|;|\|)/i,
  /\b(?:rm|del)\s+(?:\/s\s+)?(?:\/q\s+|\/f\s+)*(?:\*|\\.|\.)(?:\s|$)/i
]

/**
 * 書き込み・削除・破壊的 git など — 承認ゲート対象。
 * （ブロック済みのパターンには先にマッチさせない）
 */
const WRITE_APPROVAL_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /\brm\b/i, reason: 'file/directory deletion (rm)' },
  { pattern: /\brmdir\b/i, reason: 'directory removal (rmdir)' },
  { pattern: /\b(?:del|erase)\b/i, reason: 'file deletion (del)' },
  { pattern: /\bRemove-Item\b/i, reason: 'PowerShell Remove-Item' },
  { pattern: /\b(?:mv|move|ren|rename)\b/i, reason: 'move/rename' },
  { pattern: /\bcp\s+(?:-[a-zA-Z]*\s+)*r/i, reason: 'recursive copy (cp -r)' },
  { pattern: /\bgit\s+reset\s+--hard\b/i, reason: 'git reset --hard' },
  { pattern: /\bgit\s+clean\b/i, reason: 'git clean' },
  { pattern: /\bgit\s+push\b[^\n]*(?:-f|--force|--force-with-lease)\b/i, reason: 'force git push' },
  { pattern: /\bnpm\s+(?:publish|unpublish)\b/i, reason: 'npm publish/unpublish' },
  { pattern: /\bpnpm\s+publish\b/i, reason: 'pnpm publish' },
  { pattern: /\byarn\s+publish\b/i, reason: 'yarn publish' },
  { pattern: /\bchmod\b/i, reason: 'chmod' },
  { pattern: /\bchown\b/i, reason: 'chown' },
  { pattern: /\bsudo\b/i, reason: 'sudo' },
  { pattern: /\b(?:kill|pkill|killall)\b/i, reason: 'process kill' },
  { pattern: /\btruncate\b/i, reason: 'truncate' },
  { pattern: /\bshred\b/i, reason: 'shred' },
  { pattern: /\bdd\b/i, reason: 'dd' },
  { pattern: /\bmkfifo\b/i, reason: 'mkfifo' },
  { pattern: /\bln\s+-s?f?\b/i, reason: 'symlink create/overwrite' },
  { pattern: /\btee\b/i, reason: 'tee (writes files)' },
  { pattern: /\binstall\s+-m\b/i, reason: 'install -m' },
  { pattern: /\bsed\s+-i\b/i, reason: 'in-place sed' },
  { pattern: /\bperl\s+-i\b/i, reason: 'in-place perl' }
]

export interface AgentExecOptions {
  workspaceRoot: string
  command: string
  /** ワークスペース相対の cwd（省略時はルート） */
  cwd?: string
  timeoutMs?: number
  signal: AbortSignal
  /**
   * true のとき needs_approval 分類でも実行する（Runner が承認済みの場合）。
   * blocked は常に拒否。
   */
  approvalGranted?: boolean
}

export interface AgentExecResult {
  ok: boolean
  exitCode: number | null
  timedOut: boolean
  killed: boolean
  denied: boolean
  /** 承認が必要だが未承認のとき true */
  needsApproval?: boolean
  risk?: AgentExecRiskClassification
  cwd: string
  shell: string
  stdout: string
  stderr: string
  summary: string
  content: string
}

function normalizeSlashes(path: string): string {
  return path.replace(/\\/g, '/')
}

function resolveExecCwd(workspaceRoot: string, cwdArg?: string): string {
  const root = resolve(workspaceRoot)
  let raw = (cwdArg ?? '.').trim().replace(/\\/g, '/')
  while (raw.length > 1 && raw.endsWith('/')) {
    raw = raw.slice(0, -1)
  }

  if (!raw || raw === '.' || raw === './') {
    return resolveInsideWorkspace(workspaceRoot, '.', { allowRoot: true })
  }

  if (isAbsolute(raw) || /^[a-zA-Z]:/.test(raw)) {
    const abs = resolve(raw)
    const rel = relative(root, abs)
    if (rel.startsWith('..') || isAbsolute(rel)) {
      throw new Error(t('fs.outsideWorkspace', { path: raw }))
    }
    return abs
  }

  const rootName = basename(root)
  const sameName =
    raw === rootName ||
    (process.platform === 'win32' && raw.toLowerCase() === rootName.toLowerCase())
  if (sameName && !existsSync(resolve(root, raw))) {
    return resolveInsideWorkspace(workspaceRoot, '.', { allowRoot: true })
  }

  return resolveInsideWorkspace(workspaceRoot, raw, { allowRoot: true })
}

/**
 * exec コマンドの危険度を分類する。
 * blocked > needs_approval > allowed の順で評価。
 */
export function classifyAgentExecCommand(command: string): AgentExecRiskClassification {
  const trimmed = command.trim()
  if (!trimmed) {
    return { level: 'blocked', kind: 'system', reason: 'command is empty' }
  }
  if (trimmed.length > MAX_COMMAND_CHARS) {
    return {
      level: 'blocked',
      kind: 'system',
      reason: `command exceeds ${MAX_COMMAND_CHARS} characters`
    }
  }

  for (const pattern of SYSTEM_DENY_PATTERNS) {
    if (pattern.test(trimmed)) {
      return {
        level: 'blocked',
        kind: 'system',
        reason: 'command blocked by system safety deny list'
      }
    }
  }

  for (const pattern of WORKSPACE_WIPE_PATTERNS) {
    if (pattern.test(trimmed)) {
      return {
        level: 'blocked',
        kind: 'workspace_wipe',
        reason: 'command would wipe the workspace root (blocked)'
      }
    }
  }

  for (const entry of WRITE_APPROVAL_PATTERNS) {
    if (entry.pattern.test(trimmed)) {
      return {
        level: 'needs_approval',
        kind: 'write',
        reason: entry.reason
      }
    }
  }

  return { level: 'allowed', kind: 'none', reason: 'allowed' }
}

/** @deprecated classifyAgentExecCommand を使う。互換のため残す */
export function findDeniedCommandReason(command: string): string | null {
  const risk = classifyAgentExecCommand(command)
  if (risk.level === 'blocked') return risk.reason
  return null
}

function truncateOutput(text: string): { text: string; truncated: boolean } {
  if (text.length <= MAX_OUTPUT_CHARS) return { text, truncated: false }
  return {
    text: `${text.slice(0, MAX_OUTPUT_CHARS)}\n…(truncated)`,
    truncated: true
  }
}

function buildGitBashEnv(bashPath: string): NodeJS.ProcessEnv {
  const gitRoot = resolve(dirname(bashPath), '..')
  const env: NodeJS.ProcessEnv = { ...process.env }
  env.MSYSTEM = 'MINGW64'
  env.MSYS = 'win'
  env.CHERE_INVOKING = '1'
  env.GIT_INSTALL_ROOT = gitRoot
  const prefix = [join(gitRoot, 'bin'), join(gitRoot, 'usr', 'bin')].join(delimiter)
  const currentPath = env.PATH || env.Path || ''
  env.PATH = `${prefix}${delimiter}${currentPath}`
  env.Path = env.PATH
  return env
}

type SpawnedShell = {
  child: ChildProcessWithoutNullStreams
  shellLabel: string
}

/**
 * Windows: prefer Git Bash so POSIX commands (date, python, npm scripts) work.
 * Fall back to cmd.exe when Git Bash is unavailable.
 */
function spawnShell(command: string, cwd: string): SpawnedShell {
  if (process.platform === 'win32') {
    const gitBash = detectGitBash()
    if (gitBash) {
      return {
        child: spawn(gitBash, ['-lc', command], {
          cwd,
          env: buildGitBashEnv(gitBash),
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'pipe']
        }) as unknown as ChildProcessWithoutNullStreams,
        shellLabel: 'git-bash'
      }
    }

    const comspec = process.env.ComSpec || 'cmd.exe'
    return {
      child: spawn(comspec, ['/d', '/s', '/c', command], {
        cwd,
        env: process.env,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe']
      }) as unknown as ChildProcessWithoutNullStreams,
      shellLabel: 'cmd'
    }
  }

  return {
    child: spawn('/bin/sh', ['-c', command], {
      cwd,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe']
    }) as unknown as ChildProcessWithoutNullStreams,
    shellLabel: '/bin/sh'
  }
}

function deniedResult(
  reason: string,
  risk: AgentExecRiskClassification,
  cwd = '.'
): AgentExecResult {
  return {
    ok: false,
    exitCode: null,
    timedOut: false,
    killed: false,
    denied: true,
    needsApproval: false,
    risk,
    cwd,
    shell: 'none',
    stdout: '',
    stderr: '',
    summary: reason,
    content: `Error: ${reason}`
  }
}

/**
 * Agent 用の短命・非対話コマンド実行。
 * ユーザー向け PTY とは分離する。
 */
export async function runAgentExec(options: AgentExecOptions): Promise<AgentExecResult> {
  const command = typeof options.command === 'string' ? options.command : ''
  const risk = classifyAgentExecCommand(command)

  if (risk.level === 'blocked') {
    return deniedResult(risk.reason, risk)
  }

  if (risk.level === 'needs_approval' && !options.approvalGranted) {
    return {
      ok: false,
      exitCode: null,
      timedOut: false,
      killed: false,
      denied: false,
      needsApproval: true,
      risk,
      cwd: options.cwd || '.',
      shell: 'none',
      stdout: '',
      stderr: '',
      summary: `approval required: ${risk.reason}`,
      content: `Error: approval required before running this command (${risk.reason})`
    }
  }

  let cwdAbs: string
  try {
    cwdAbs = resolveExecCwd(options.workspaceRoot, options.cwd)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return {
      ok: false,
      exitCode: null,
      timedOut: false,
      killed: false,
      denied: false,
      risk,
      cwd: options.cwd || '.',
      shell: 'none',
      stdout: '',
      stderr: '',
      summary: message,
      content: `Error: ${message}`
    }
  }

  const cwdRel = normalizeSlashes(relative(resolve(options.workspaceRoot), cwdAbs)) || '.'
  const timeoutMs = Math.min(
    Math.max(1_000, options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    MAX_TIMEOUT_MS
  )

  if (options.signal.aborted) {
    return {
      ok: false,
      exitCode: null,
      timedOut: false,
      killed: true,
      denied: false,
      risk,
      cwd: cwdRel,
      shell: 'none',
      stdout: '',
      stderr: '',
      summary: 'aborted',
      content: 'Error: aborted before start'
    }
  }

  return await new Promise<AgentExecResult>((resolvePromise) => {
    let settled = false
    let timedOut = false
    let killed = false
    let stdout = ''
    let stderr = ''
    let child: ChildProcessWithoutNullStreams
    let shellLabel = 'unknown'
    let timer: ReturnType<typeof setTimeout> | undefined

    const finish = (result: AgentExecResult): void => {
      if (settled) return
      settled = true
      options.signal.removeEventListener('abort', onAbort)
      if (timer) clearTimeout(timer)
      resolvePromise(result)
    }

    const onAbort = (): void => {
      killed = true
      try {
        child.kill()
      } catch {
        // ignore
      }
    }

    try {
      const spawned = spawnShell(command, cwdAbs)
      child = spawned.child
      shellLabel = spawned.shellLabel
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      finish({
        ok: false,
        exitCode: null,
        timedOut: false,
        killed: false,
        denied: false,
        risk,
        cwd: cwdRel,
        shell: shellLabel,
        stdout: '',
        stderr: '',
        summary: message,
        content: `Error: ${message}`
      })
      return
    }

    options.signal.addEventListener('abort', onAbort)

    timer = setTimeout(() => {
      timedOut = true
      try {
        child.kill()
      } catch {
        // ignore
      }
    }, timeoutMs)

    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      if (stdout.length < MAX_OUTPUT_CHARS * 2) stdout += chunk
    })
    child.stderr.on('data', (chunk: string) => {
      if (stderr.length < MAX_OUTPUT_CHARS * 2) stderr += chunk
    })

    child.on('error', (err) => {
      const message = err.message
      finish({
        ok: false,
        exitCode: null,
        timedOut,
        killed,
        denied: false,
        risk,
        cwd: cwdRel,
        shell: shellLabel,
        stdout: truncateOutput(stdout).text,
        stderr: truncateOutput(stderr).text,
        summary: message,
        content: `Error: ${message}`
      })
    })

    child.on('close', (code) => {
      const out = truncateOutput(stdout)
      const errOut = truncateOutput(stderr)
      const exitCode = code
      const ok = !timedOut && !killed && exitCode === 0
      const flags = [
        timedOut ? 'timed out' : null,
        killed ? 'killed' : null,
        out.truncated || errOut.truncated ? 'output truncated' : null
      ]
        .filter(Boolean)
        .join(', ')

      const summary = flags
        ? `exit ${exitCode ?? 'null'} (${flags}) in ${cwdRel}`
        : `exit ${exitCode ?? 'null'} in ${cwdRel}`

      const content = [
        `# exec`,
        `command: ${redactSecrets(command)}`,
        `shell: ${shellLabel}`,
        `cwd: ${cwdRel}`,
        `exitCode: ${exitCode}`,
        risk.level !== 'allowed' ? `risk: ${risk.level} (${risk.reason})` : null,
        timedOut ? 'timedOut: true' : null,
        killed ? 'killed: true' : null,
        '',
        '## stdout',
        redactSecrets(out.text) || '(empty)',
        '',
        '## stderr',
        redactSecrets(errOut.text) || '(empty)'
      ]
        .filter((line) => line !== null)
        .join('\n')

      finish({
        ok,
        exitCode,
        timedOut,
        killed,
        denied: false,
        risk,
        cwd: cwdRel,
        shell: shellLabel,
        stdout: out.text,
        stderr: errOut.text,
        summary,
        content
      })
    })
  })
}
