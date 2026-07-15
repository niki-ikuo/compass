import { describe, expect, it } from 'vitest'
import {
  classifyAgentExecCommand,
  findDeniedCommandReason
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
