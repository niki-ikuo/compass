import { existsSync } from 'fs'
import { dirname, join, resolve } from 'path'
import * as pty from 'node-pty'
import type { WebContents } from 'electron'

export interface TerminalShell {
  id: string
  label: string
  path: string
  args: string[]
}

interface ActiveTerminal {
  id: string
  pty: pty.IPty
  cwd: string
  shellId: string
  webContents: WebContents
  outputBuffer: string
}

const OUTPUT_BUFFER_LIMIT = 100_000
const activeTerminals = new Map<string, ActiveTerminal>()
/** Intentional kills (tab close, cleanup) must not surface as user-visible exits. */
const intentionallyKilled = new Set<string>()

function fileExists(path: string): boolean {
  try {
    return existsSync(path)
  } catch {
    return false
  }
}

function detectGitBash(): string | null {
  const candidates = [
    process.env.ProgramFiles && join(process.env.ProgramFiles, 'Git', 'bin', 'bash.exe'),
    process.env['ProgramFiles(x86)'] &&
      join(process.env['ProgramFiles(x86)'], 'Git', 'bin', 'bash.exe'),
    process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Programs', 'Git', 'bin', 'bash.exe')
  ].filter(Boolean) as string[]

  return candidates.find(fileExists) ?? null
}

function detectWsl(): string | null {
  const wslPath = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'wsl.exe')
  return fileExists(wslPath) ? wslPath : null
}

function detectPowerShell(): string | null {
  const pwsh = process.env.ProgramFiles
    ? join(process.env.ProgramFiles, 'PowerShell', '7', 'pwsh.exe')
    : null
  if (pwsh && fileExists(pwsh)) return pwsh

  const legacy = join(
    process.env.SystemRoot ?? 'C:\\Windows',
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe'
  )
  return fileExists(legacy) ? legacy : null
}

export function listAvailableShells(): TerminalShell[] {
  const shells: TerminalShell[] = []

  const powershell = detectPowerShell()
  if (powershell) {
    shells.push({
      id: 'powershell',
      label: powershell.endsWith('pwsh.exe') ? 'PowerShell 7' : 'PowerShell',
      path: powershell,
      args: []
    })
  }

  const cmdPath = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'cmd.exe')
  if (fileExists(cmdPath)) {
    shells.push({ id: 'cmd', label: 'コマンド プロンプト', path: cmdPath, args: [] })
  }

  const gitBash = detectGitBash()
  if (gitBash) {
    shells.push({ id: 'bash', label: 'Git Bash', path: gitBash, args: ['--login', '-i'] })
  }

  const wsl = detectWsl()
  if (wsl) {
    shells.push({ id: 'wsl', label: 'WSL', path: wsl, args: [] })
  }

  return shells
}

function resolveShell(shellId?: string): TerminalShell | null {
  const shells = listAvailableShells()
  if (shells.length === 0) return null
  if (shellId) {
    return shells.find((shell) => shell.id === shellId) ?? shells[0]
  }
  return shells[0]
}

function quoteWindowsPath(path: string): string {
  if (path.includes(' ')) return `"${path}"`
  return path
}

function buildCdCommand(shellId: string, cwd: string): string {
  const quoted = quoteWindowsPath(cwd)
  switch (shellId) {
    case 'cmd':
      return `cd /d ${quoted}\r`
    case 'bash':
    case 'wsl':
      return `cd ${quoted.replace(/\\/g, '/')}\r`
    default:
      return `Set-Location -LiteralPath ${quoted}\r`
  }
}

function sanitizeEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  const result: Record<string, string> = {}
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined) result[key] = value
  }
  return result
}

function getGitInstallRoot(bashPath: string): string {
  return resolve(dirname(bashPath), '..')
}

function prependToPath(env: Record<string, string>, ...segments: string[]): void {
  const pathKey = Object.keys(env).find((k) => k.toLowerCase() === 'path') ?? 'Path'
  const existing = env[pathKey] ?? ''
  const existingLower = existing.toLowerCase().split(';').filter(Boolean)
  const toPrepend = segments.filter((segment) => !existingLower.includes(segment.toLowerCase()))
  if (toPrepend.length > 0) {
    env[pathKey] = [...toPrepend, existing].filter(Boolean).join(';')
  }
}

/** Git Bash needs MSYS env + ConPTY on Windows to avoid winpty fork failures. */
function buildSpawnEnv(shell: TerminalShell): Record<string, string> {
  const env = sanitizeEnv(process.env)

  if (shell.id === 'bash') {
    const gitRoot = getGitInstallRoot(shell.path)
    env.MSYSTEM = 'MINGW64'
    env.MSYS = 'win'
    env.CHERE_INVOKING = '1'
    env.TERM = 'xterm-256color'
    env.GIT_INSTALL_ROOT = gitRoot
    prependToPath(env, join(gitRoot, 'bin'), join(gitRoot, 'usr', 'bin'))
  }

  return env
}

function buildSpawnOptions(shell: TerminalShell, cwd: string): pty.IWindowsPtyForkOptions {
  const options: pty.IWindowsPtyForkOptions = {
    name: 'xterm-256color',
    cols: 80,
    rows: 24,
    cwd,
    env: buildSpawnEnv(shell)
  }

  if (process.platform === 'win32') {
    options.useConpty = true
  }

  return options
}

function appendOutputBuffer(terminal: ActiveTerminal, data: string): void {
  terminal.outputBuffer += data
  if (terminal.outputBuffer.length > OUTPUT_BUFFER_LIMIT) {
    terminal.outputBuffer = terminal.outputBuffer.slice(-OUTPUT_BUFFER_LIMIT)
  }
}

function spawnPty(
  id: string,
  cwd: string,
  shell: TerminalShell,
  webContents: WebContents
): { ok: true; shellId: string; replay: string } | { ok: false; error: string } {
  try {
    const ptyProcess = pty.spawn(shell.path, shell.args, buildSpawnOptions(shell, cwd))
    const record: ActiveTerminal = {
      id,
      pty: ptyProcess,
      cwd,
      shellId: shell.id,
      webContents,
      outputBuffer: ''
    }
    activeTerminals.set(id, record)

    ptyProcess.onData((data) => {
      const current = activeTerminals.get(id)
      if (!current) return
      appendOutputBuffer(current, data)
      const target = current.webContents
      if (!target.isDestroyed()) {
        target.send('terminal:data', id, data)
      }
    })

    ptyProcess.onExit(({ exitCode }) => {
      activeTerminals.delete(id)
      const wasIntentional = intentionallyKilled.delete(id)
      const target = record.webContents
      if (!wasIntentional && !target.isDestroyed()) {
        target.send('terminal:exit', id, exitCode)
      }
    })

    return { ok: true, shellId: shell.id, replay: '' }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false, error: message }
  }
}

/**
 * Create or reuse a PTY for a tab. React StrictMode remounts must NOT spawn a
 * second process — the PTY lives until the tab is explicitly closed.
 */
export function createTerminal(
  id: string,
  cwd: string,
  shellId: string | undefined,
  webContents: WebContents,
  _session?: number
): { ok: true; shellId: string; replay: string } | { ok: false; error: string } {
  const shell = resolveShell(shellId)
  if (!shell) {
    return { ok: false, error: '利用可能なシェルが見つかりません' }
  }

  if (!fileExists(cwd)) {
    return { ok: false, error: 'ワークスペースフォルダが存在しません' }
  }

  const existing = activeTerminals.get(id)
  if (existing) {
    // Shell switch for the same tab → replace process
    if (existing.shellId !== shell.id) {
      killTerminal(id)
      return spawnPty(id, cwd, shell, webContents)
    }

    existing.webContents = webContents
    if (existing.cwd !== cwd && fileExists(cwd)) {
      existing.cwd = cwd
      existing.pty.write(buildCdCommand(existing.shellId, cwd))
    }
    return { ok: true, shellId: existing.shellId, replay: existing.outputBuffer }
  }

  return spawnPty(id, cwd, shell, webContents)
}

export function writeTerminal(id: string, data: string): boolean {
  const terminal = activeTerminals.get(id)
  if (!terminal) return false
  try {
    terminal.pty.write(data)
    return true
  } catch {
    return false
  }
}

export function resizeTerminal(id: string, cols: number, rows: number): void {
  const terminal = activeTerminals.get(id)
  if (!terminal) return
  if (cols > 0 && rows > 0) {
    try {
      terminal.pty.resize(cols, rows)
    } catch {
      // ignore resize on exiting process
    }
  }
}

export function killTerminal(id: string, _session?: number): void {
  const terminal = activeTerminals.get(id)
  if (!terminal) return
  intentionallyKilled.add(id)
  try {
    terminal.pty.kill()
  } catch {
    intentionallyKilled.delete(id)
  }
  activeTerminals.delete(id)
}

export function killAllTerminals(): void {
  for (const id of [...activeTerminals.keys()]) {
    killTerminal(id)
  }
}

export function setTerminalCwd(id: string, cwd: string): void {
  const terminal = activeTerminals.get(id)
  if (!terminal || !fileExists(cwd)) return
  terminal.cwd = cwd
  terminal.pty.write(buildCdCommand(terminal.shellId, cwd))
}

export function setAllTerminalsCwd(cwd: string): void {
  for (const terminal of activeTerminals.values()) {
    setTerminalCwd(terminal.id, cwd)
  }
}

export function hasTerminal(id: string): boolean {
  return activeTerminals.has(id)
}
