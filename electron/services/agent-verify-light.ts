import { readFile } from 'fs/promises'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import type { UseCasePreset } from '../../src/types'
import { normalizeUseCasePreset, DEFAULT_SETTINGS } from '../../src/types'
import {
  parseGlossaryMarkdown,
  validateMarkdownDocument,
  type MarkdownHeadingIssue
} from '../../src/utils/markdown-outline'
import { verifyDataFile } from '../../src/utils/data-verify'
import type { AgentVerifyCheckResult } from './agent-verify'
import { decodeFileBuffer } from './encoding'

function isMarkdownPath(path: string): boolean {
  const lower = path.replace(/\\/g, '/').toLowerCase()
  return lower.endsWith('.md') || lower.endsWith('.markdown') || lower.endsWith('.mdx')
}

function isDataPath(path: string): boolean {
  const lower = path.replace(/\\/g, '/').toLowerCase()
  return (
    lower.endsWith('.csv') ||
    lower.endsWith('.tsv') ||
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
    const buffer = await readFile(join(workspaceRoot, relativePath))
    return decodeFileBuffer(buffer).content
  } catch {
    return null
  }
}

async function loadGlossaryTerms(workspaceRoot: string) {
  const glossaryPath = join(workspaceRoot, '.compass', 'glossary.md')
  if (!existsSync(glossaryPath)) return []
  const content = await readWorkspaceFile(workspaceRoot, '.compass/glossary.md')
  if (content === null) return []
  return parseGlossaryMarkdown(content)
}

function isHeadingIssue(issue: MarkdownHeadingIssue): boolean {
  return (
    issue.kind === 'broken_atx' ||
    issue.kind === 'empty_heading' ||
    issue.kind === 'level_jump' ||
    issue.kind === 'duplicate_heading'
  )
}

function isLinkIssue(issue: MarkdownHeadingIssue): boolean {
  return (
    issue.kind === 'broken_link' ||
    issue.kind === 'broken_anchor' ||
    issue.kind === 'broken_media'
  )
}

function checkResult(
  check: AgentVerifyCheckResult['check'],
  issueLines: string[],
  targetCount: number,
  emptySummary: string,
  okSummary: string,
  failSummary: (n: number) => string
): AgentVerifyCheckResult {
  if (targetCount === 0) {
    return {
      check,
      command: null,
      source: 'missing',
      skipped: true,
      ok: true,
      summary: emptySummary,
      exitCode: null,
      stdout: '',
      stderr: ''
    }
  }
  const ok = issueLines.length === 0
  return {
    check,
    command: null,
    source: 'fallback',
    skipped: false,
    ok,
    summary: ok ? okSummary : failSummary(issueLines.length),
    exitCode: ok ? 0 : 1,
    stdout: ok ? `ok (${targetCount} file(s))` : issueLines.join('\n'),
    stderr: ''
  }
}

export async function runDocumentLightVerify(
  workspaceRoot: string,
  paths: string[] | undefined
): Promise<AgentVerifyCheckResult[]> {
  const targets = normalizeRelativePaths(paths).filter(isMarkdownPath)
  if (targets.length === 0) {
    return [
      checkResult('headings', [], 0, 'no markdown paths to check', '', () => ''),
      checkResult('links', [], 0, 'no markdown paths to check', '', () => ''),
      checkResult('glossary', [], 0, 'no markdown paths to check', '', () => '')
    ]
  }

  const glossaryTerms = await loadGlossaryTerms(workspaceRoot)
  const headingLines: string[] = []
  const linkLines: string[] = []
  const glossaryLines: string[] = []

  for (const rel of targets) {
    const content = await readWorkspaceFile(workspaceRoot, rel)
    if (content === null) {
      headingLines.push(`${rel}: file not readable`)
      continue
    }
    const issues = validateMarkdownDocument(content, {
      relativePath: rel,
      fileExists: (workspaceRelativePath) =>
        existsSync(join(workspaceRoot, workspaceRelativePath)),
      readFile: (workspaceRelativePath) => {
        // Sync bridge for anchor checks across files (small docs only).
        try {
          const buffer = readFileSync(join(workspaceRoot, workspaceRelativePath))
          return decodeFileBuffer(buffer).content
        } catch {
          return null
        }
      },
      glossaryTerms
    })
    for (const issue of issues) {
      const line = `${rel}:L${issue.line} ${issue.message}`
      if (isHeadingIssue(issue)) headingLines.push(line)
      else if (isLinkIssue(issue)) linkLines.push(line)
      else if (issue.kind === 'term_mismatch') glossaryLines.push(line)
      else headingLines.push(line)
    }
  }

  return [
    checkResult(
      'headings',
      headingLines,
      targets.length,
      'no markdown paths to check',
      `headings ok (${targets.length} file(s))`,
      (n) => `headings failed (${n} issue(s))`
    ),
    checkResult(
      'links',
      linkLines,
      targets.length,
      'no markdown paths to check',
      `links ok (${targets.length} file(s))`,
      (n) => `links failed (${n} issue(s))`
    ),
    checkResult(
      'glossary',
      glossaryLines,
      glossaryTerms.length === 0 ? 0 : targets.length,
      glossaryTerms.length === 0 ? 'no glossary.md; skipped' : 'no markdown paths to check',
      `glossary ok (${targets.length} file(s))`,
      (n) => `glossary failed (${n} issue(s))`
    )
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
