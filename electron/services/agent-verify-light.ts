import { readFile } from 'fs/promises'
import { existsSync } from 'fs'
import { join } from 'path'
import type { UseCasePreset } from '../../src/types'
import { normalizeUseCasePreset, DEFAULT_SETTINGS } from '../../src/types'
import { validateMarkdownDocument } from '../../src/utils/markdown-outline'
import { verifyDataFile } from '../../src/utils/data-verify'
import type { AgentVerifyCheckResult } from './agent-verify'

function isMarkdownPath(path: string): boolean {
  const lower = path.replace(/\\/g, '/').toLowerCase()
  return lower.endsWith('.md') || lower.endsWith('.markdown') || lower.endsWith('.mdx')
}

function isDataPath(path: string): boolean {
  const lower = path.replace(/\\/g, '/').toLowerCase()
  return (
    lower.endsWith('.csv') ||
    lower.endsWith('.json') ||
    lower.endsWith('.yaml') ||
    lower.endsWith('.yml')
  )
}

function normalizeRelativePaths(paths: string[] | undefined): string[] {
  if (!paths || paths.length === 0) return []
  const out: string[] = []
  for (const raw of paths) {
    if (typeof raw !== 'string' || !raw.trim()) continue
    const normalized = raw.replace(/\\/g, '/').replace(/^\.\//, '')
    if (!normalized || normalized.includes('..')) continue
    if (!out.includes(normalized)) out.push(normalized)
  }
  return out
}

async function readWorkspaceFile(
  workspaceRoot: string,
  relativePath: string
): Promise<string | null> {
  try {
    return await readFile(join(workspaceRoot, relativePath), 'utf-8')
  } catch {
    return null
  }
}

export async function runDocumentLightVerify(
  workspaceRoot: string,
  paths: string[] | undefined
): Promise<AgentVerifyCheckResult[]> {
  const targets = normalizeRelativePaths(paths).filter(isMarkdownPath)
  if (targets.length === 0) {
    return [
      {
        check: 'headings',
        command: null,
        source: 'missing',
        skipped: true,
        ok: true,
        summary: 'no markdown paths to check',
        exitCode: null,
        stdout: '',
        stderr: ''
      }
    ]
  }

  const issueLines: string[] = []
  for (const rel of targets) {
    const content = await readWorkspaceFile(workspaceRoot, rel)
    if (content === null) {
      issueLines.push(`${rel}: file not readable`)
      continue
    }
    const issues = validateMarkdownDocument(content, {
      relativePath: rel,
      fileExists: (workspaceRelativePath) =>
        existsSync(join(workspaceRoot, workspaceRelativePath))
    })
    for (const issue of issues) {
      issueLines.push(`${rel}:L${issue.line} ${issue.message}`)
    }
  }

  const ok = issueLines.length === 0
  return [
    {
      check: 'headings',
      command: null,
      source: 'fallback',
      skipped: false,
      ok,
      summary: ok
        ? `document ok (${targets.length} file(s))`
        : `document failed (${issueLines.length} issue(s))`,
      exitCode: ok ? 0 : 1,
      stdout: ok ? targets.map((p) => `ok ${p}`).join('\n') : issueLines.join('\n'),
      stderr: ''
    }
  ]
}

export async function runDataLightVerify(
  workspaceRoot: string,
  paths: string[] | undefined
): Promise<AgentVerifyCheckResult[]> {
  const targets = normalizeRelativePaths(paths).filter(isDataPath)
  if (targets.length === 0) {
    return [
      {
        check: 'schema',
        command: null,
        source: 'missing',
        skipped: true,
        ok: true,
        summary: 'no data paths to check',
        exitCode: null,
        stdout: '',
        stderr: ''
      }
    ]
  }

  const issueLines: string[] = []
  for (const rel of targets) {
    const content = await readWorkspaceFile(workspaceRoot, rel)
    if (content === null) {
      issueLines.push(`${rel}: file not readable`)
      continue
    }
    for (const issue of verifyDataFile(rel, content)) {
      issueLines.push(`${rel}: ${issue.message}`)
    }
  }

  const ok = issueLines.length === 0
  return [
    {
      check: 'schema',
      command: null,
      source: 'fallback',
      skipped: false,
      ok,
      summary: ok
        ? `schema ok (${targets.length} file(s))`
        : `schema failed (${issueLines.length} issue(s))`,
      exitCode: ok ? 0 : 1,
      stdout: ok ? targets.map((p) => `ok ${p}`).join('\n') : issueLines.join('\n'),
      stderr: ''
    }
  ]
}

/** preset に応じた軽量 verify 結果（code は空 = shell のみ） */
export async function runUseCaseLightVerify(options: {
  workspaceRoot: string
  preset?: UseCasePreset | null
  paths?: string[]
}): Promise<AgentVerifyCheckResult[]> {
  const preset = normalizeUseCasePreset(options.preset) ?? DEFAULT_SETTINGS.defaultUseCasePreset
  if (preset === 'document') {
    return runDocumentLightVerify(options.workspaceRoot, options.paths)
  }
  if (preset === 'data') {
    return runDataLightVerify(options.workspaceRoot, options.paths)
  }
  return []
}

export function shouldRunShellVerify(preset?: UseCasePreset | null): boolean {
  const resolved = normalizeUseCasePreset(preset) ?? DEFAULT_SETTINGS.defaultUseCasePreset
  return resolved === 'code'
}
