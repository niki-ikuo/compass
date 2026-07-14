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

/** 明らかに危険なコマンドパターン（deny-list 優先） */
const DENY_PATTERNS: RegExp[] = [
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

export interface AgentExecOptions {
  workspaceRoot: string
  command: string
  /** ワークスペース相対の cwd（省略時はルート） */
  cwd?: string
  timeoutMs?: number
  signal: AbortSignal
}

export interface AgentExecResult {
  ok: boolean
  exitCode: number | null
  timedOut: boolean
  killed: boolean
  denied: boolean
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

export function findDeniedCommandReason(command: string): string | null {
  const trimmed = command.trim()
  if (!trimmed) return 'command is empty'
  if (trimmed.length > MAX_COMMAND_CHARS) {
    return `command exceeds ${MAX_COMMAND_CHARS} characters`
  }
  for (const pattern of DENY_PATTERNS) {
    if (pattern.test(trimmed)) {
      return 'command blocked by safety deny list'
    }
  }
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
        }) as ChildProcessWithoutNullStreams,
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
      }) as ChildProcessWithoutNullStreams,
      shellLabel: 'cmd'
    }
  }

  return {
    child: spawn('/bin/sh', ['-c', command], {
      cwd,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe']
    }) as ChildProcessWithoutNullStreams,
    shellLabel: '/bin/sh'
  }
}

/**
 * Agent 用の短命・非対話コマンド実行。
 * ユーザー向け PTY とは分離する。
 */
export async function runAgentExec(options: AgentExecOptions): Promise<AgentExecResult> {
  const command = typeof options.command === 'string' ? options.command : ''
  const denyReason = findDeniedCommandReason(command)
  if (denyReason) {
    return {
      ok: false,
      exitCode: null,
      timedOut: false,
      killed: false,
      denied: true,
      cwd: '.',
      shell: 'none',
      stdout: '',
      stderr: '',
      summary: denyReason,
      content: `Error: ${denyReason}`
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
