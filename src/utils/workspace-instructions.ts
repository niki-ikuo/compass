const ATX_HEADING = /^(#{1,2})\s+(.+?)\s*#*\s*$/

export type WorkspaceInstructionHeadingKind = 'role' | 'rules' | 'terms' | 'other'

export interface ParsedWorkspaceInstructions {
  role: string | null
  rules: string | null
  terms: string | null
}

function normalizeHeading(text: string): string {
  return text.trim().toLowerCase().replace(/[：:]/g, '').replace(/\s+/g, ' ')
}

/** Classify an ATX heading as role, rules, terms, or something else. */
export function classifyInstructionHeading(text: string): WorkspaceInstructionHeadingKind {
  const n = normalizeHeading(text)
  if (n === '役割' || n === '役割プロンプト' || n === 'role' || n === 'role prompt') {
    return 'role'
  }
  if (
    n === 'ルール' ||
    n === 'ワークスペースルール' ||
    n === 'rules' ||
    n === 'workspace rules'
  ) {
    return 'rules'
  }
  if (
    n === '用語' ||
    n === '用語対' ||
    n === '用語集' ||
    n === 'terms' ||
    n === 'glossary'
  ) {
    return 'terms'
  }
  return 'other'
}

function emptyToNull(text: string): string | null {
  const trimmed = text.trim()
  return trimmed.length > 0 ? trimmed : null
}

type InstructionBucket = 'role' | 'rules' | 'terms'

/**
 * Split `.compass/instructions.md` into role, rules, and terms.
 * H1/H2 titled 役割/Role, ルール/Rules, 用語/Terms switch buckets.
 * Nested headings stay in the current bucket. Text before the first matching heading is rules.
 * No role heading → the whole file is rules (preset role stays) unless a terms heading appears.
 */
export function parseWorkspaceInstructions(markdown: string): ParsedWorkspaceInstructions {
  const text = markdown.replace(/\r\n/g, '\n')
  if (!text.trim()) return { role: null, rules: null, terms: null }

  const lines = text.split('\n')
  let inFence = false
  let bucket: InstructionBucket = 'rules'
  const roleLines: string[] = []
  const rulesLines: string[] = []
  const termsLines: string[] = []
  let sawRoleHeading = false
  let sawRulesHeading = false
  let sawTermsHeading = false

  const push = (line: string) => {
    if (bucket === 'role') roleLines.push(line)
    else if (bucket === 'terms') termsLines.push(line)
    else rulesLines.push(line)
  }

  for (const line of lines) {
    const fence = line.match(/^(`{3,}|~{3,})/)
    if (fence) {
      inFence = !inFence
      push(line)
      continue
    }
    if (!inFence) {
      const match = line.match(ATX_HEADING)
      if (match) {
        const kind = classifyInstructionHeading(match[2])
        if (kind === 'role') {
          sawRoleHeading = true
          bucket = 'role'
          continue
        }
        if (kind === 'rules') {
          sawRulesHeading = true
          bucket = 'rules'
          continue
        }
        if (kind === 'terms') {
          sawTermsHeading = true
          bucket = 'terms'
          continue
        }
      }
    }
    push(line)
  }

  if (!sawRoleHeading && !sawRulesHeading && !sawTermsHeading) {
    return { role: null, rules: emptyToNull(text), terms: null }
  }

  return {
    role: emptyToNull(roleLines.join('\n')),
    rules: emptyToNull(rulesLines.join('\n')),
    terms: emptyToNull(termsLines.join('\n'))
  }
}

/** Drop a leading H1/H2 of the given kind so wrapping `# 役割` does not nest duplicates. */
export function stripLeadingSectionHeading(
  body: string,
  kind: Exclude<WorkspaceInstructionHeadingKind, 'other'>
): string {
  const lines = body.replace(/\r\n/g, '\n').split('\n')
  let i = 0
  while (i < lines.length && lines[i].trim() === '') i++
  const match = lines[i]?.match(ATX_HEADING)
  if (match && classifyInstructionHeading(match[2]) === kind) {
    i += 1
    while (i < lines.length && lines[i].trim() === '') i++
    return lines.slice(i).join('\n').trim()
  }
  return body.trim()
}

export type InstructionSectionHeadings = {
  role: string
  rules: string
  terms: string
}

export const DEFAULT_INSTRUCTION_HEADINGS_JA: InstructionSectionHeadings = {
  role: '役割',
  rules: 'ルール',
  terms: '用語'
}

export const DEFAULT_INSTRUCTION_HEADINGS_EN: InstructionSectionHeadings = {
  role: 'Role',
  rules: 'Rules',
  terms: 'Terms'
}

export function defaultInstructionHeadings(
  locale: 'ja' | 'en'
): InstructionSectionHeadings {
  return locale === 'ja' ? DEFAULT_INSTRUCTION_HEADINGS_JA : DEFAULT_INSTRUCTION_HEADINGS_EN
}

/** Hint lines for an empty Terms section. No parseable preferred|avoid pairs. */
export function buildDefaultTermsHint(locale: 'ja' | 'en'): string {
  if (locale === 'ja') {
    return [
      '空なら検査しません。定義は書かないでください。1行に1つの表記対を書きます。',
      '# API Key | apikey, APIキー'
    ].join('\n')
  }
  return [
    'Leave empty to skip checks. Do not write definitions. Write one pair per line.',
    '# API Key | apikey, APIキー'
  ].join('\n')
}

export function buildInstructionsMarkdownFromLegacy(
  role: string | null | undefined,
  rules: string | null | undefined,
  headings: InstructionSectionHeadings = DEFAULT_INSTRUCTION_HEADINGS_EN,
  terms?: string | null | undefined
): string | null {
  const roleBody = role?.trim() ? stripLeadingSectionHeading(role, 'role') : ''
  const rulesBody = rules?.trim() ? stripLeadingSectionHeading(rules, 'rules') : ''
  const termsBody = terms?.trim() ? stripLeadingSectionHeading(terms, 'terms') : ''
  if (!roleBody && !rulesBody && !termsBody) return null
  const locale: 'ja' | 'en' = headings.role === '役割' ? 'ja' : 'en'
  const termsSection = termsBody || buildDefaultTermsHint(locale)
  return [
    `# ${headings.role}`,
    '',
    roleBody,
    '',
    `# ${headings.rules}`,
    '',
    rulesBody,
    '',
    `# ${headings.terms}`,
    '',
    termsSection,
    ''
  ].join('\n')
}
