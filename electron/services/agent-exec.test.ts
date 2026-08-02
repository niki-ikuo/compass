import { mkdtemp } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { beforeAll, describe, expect, it } from 'vitest'
import {
  classifyAgentExecCommand,
  findDeniedCommandReason,
  runAgentExec
} from './agent-exec'

describe('classifyAgentExecCommand', () => {
  it('allows common feedback commands', () => {
    for (const command of ['npm test', 'npm run lint', 'git status', 'tsc --noEmit']) {
      expect(classifyAgentExecCommand(command).level).toBe('allowed')
    }
  })

  it('blocks system-destructive commands', () => {
    expect(classifyAgentExecCommand('rm -rf /').level).toBe('blocked')
    expect(classifyAgentExecCommand('format c:').level).toBe('blocked')
    expect(classifyAgentExecCommand('rm -rf /').kind).toBe('system')
  })

  it('blocks workspace-wipe commands', () => {
    for (const command of ['rm -rf .', 'rm -rf ./', 'rm -rf *', 'git clean -fdx']) {
      const risk = classifyAgentExecCommand(command)
      expect(risk.level, command).toBe('blocked')
      expect(risk.kind, command).toBe('workspace_wipe')
    }
  })

  it('requires approval for write/mutating commands', () => {
    const cases = [
      'rm -rf node_modules',
      'rm src/tmp.txt',
      'git reset --hard HEAD',
      'chmod +x scripts/run.sh',
      'sudo apt install foo'
    ]
    for (const command of cases) {
      const risk = classifyAgentExecCommand(command)
      expect(risk.level, command).toBe('needs_approval')
      expect(risk.kind, command).toBe('write')
    }
  })

  it('blocks empty and oversized commands', () => {
    expect(classifyAgentExecCommand('').level).toBe('blocked')
    expect(classifyAgentExecCommand('   ').level).toBe('blocked')
    expect(classifyAgentExecCommand('x'.repeat(5_000)).level).toBe('blocked')
  })
})

describe('findDeniedCommandReason', () => {
  it('returns a reason only for blocked commands', () => {
    expect(findDeniedCommandReason('rm -rf .')).toMatch(/wipe|blocked/i)
    expect(findDeniedCommandReason('npm test')).toBeNull()
    expect(findDeniedCommandReason('rm file.txt')).toBeNull()
  })
})

describe('runAgentExec timeout and abort', () => {
  /** Long-lived grandchild that keeps stdio open (reproduces http.server hang). */
  const hangCommand = 'node -e "setInterval(()=>{},1000)"'
  let workspaceRoot: string

  beforeAll(async () => {
    workspaceRoot = await mkdtemp(join(tmpdir(), 'compass-agent-exec-'))
  })

  it('settles with timedOut when a long-running command exceeds timeoutMs', async () => {
    const started = Date.now()
    const result = await runAgentExec({
      workspaceRoot,
      command: hangCommand,
      timeoutMs: 2_000,
      signal: new AbortController().signal
    })
    const elapsed = Date.now() - started

    expect(result.timedOut).toBe(true)
    expect(result.ok).toBe(false)
    // Must not hang waiting for close forever (timeout + kill grace + buffer)
    expect(elapsed).toBeLessThan(10_000)
  }, 15_000)

  it('settles with killed when abort fires during a long-running command', async () => {
    const controller = new AbortController()
    const started = Date.now()
    const pending = runAgentExec({
      workspaceRoot,
      command: hangCommand,
      timeoutMs: 60_000,
      signal: controller.signal
    })
    setTimeout(() => controller.abort(), 400)
    const result = await pending
    const elapsed = Date.now() - started

    expect(result.killed).toBe(true)
    expect(result.ok).toBe(false)
    expect(elapsed).toBeLessThan(10_000)
  }, 15_000)
})
