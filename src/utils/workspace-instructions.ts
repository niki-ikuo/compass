const ATX_HEADING = /^(#{1,2})\s+(.+?)\s*#*\s*$/

export type WorkspaceInstructionHeadingKind = 'role' | 'rules' | 'other'

export interface ParsedWorkspaceInstructions {
  role: string | null
  rules: string | null
}

function normalizeHeading(text: string): string {
  return text.trim().toLowerCase().replace(/[：:]/g, '').replace(/\s+/g, ' ')
}

/** Classify an ATX heading as the role section, rules section, or something else. */
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
  return 'other'
}

function emptyToNull(text: string): string | null {
  const trimmed = text.trim()
  return trimmed.length > 0 ? trimmed : null
}

/**
 * Split `.compass/instructions.md` into the system role overlay and user-context rules.
 * H1/H2 titled 役割/Role switch the role bucket; ルール/Rules switch the rules bucket.
 * Nested headings stay in the current bucket. Text before the first matching heading is rules.
 * No role heading → the whole file is rules (preset role stays).
 */
export function parseWorkspaceInstructions(markdown: string): ParsedWorkspaceInstructions {
  const text = markdown.replace(/\r\n/g, '\n')
  if (!text.trim()) return { role: null, rules: null }

  const lines = text.split('\n')
  let inFence = false
  let bucket: 'role' | 'rules' = 'rules'
  const roleLines: string[] = []
  const rulesLines: string[] = []
  let sawRoleHeading = false
  let sawRulesHeading = false

  for (const line of lines) {
    const fence = line.match(/^(`{3,}|~{3,})/)
    if (fence) {
      inFence = !inFence
      if (bucket === 'role') roleLines.push(line)
      else rulesLines.push(line)
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
      }
    }
    if (bucket === 'role') roleLines.push(line)
    else rulesLines.push(line)
  }

  if (!sawRoleHeading && !sawRulesHeading) {
    return { role: null, rules: emptyToNull(text) }
  }

  return {
    role: emptyToNull(roleLines.join('\n')),
    rules: emptyToNull(rulesLines.join('\n'))
  }
}

/** Drop a leading H1/H2 of the given kind so wrapping `# 役割` does not nest duplicates. */
export function stripLeadingSectionHeading(
  body: string,
  kind: 'role' | 'rules'
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

export function buildInstructionsMarkdownFromLegacy(
  role: string | null | undefined,
  rules: string | null | undefined,
  headings: { role: string; rules: string } = { role: 'Role', rules: 'Rules' }
): string | null {
  const roleBody = role?.trim() ? stripLeadingSectionHeading(role, 'role') : ''
  const rulesBody = rules?.trim() ? stripLeadingSectionHeading(rules, 'rules') : ''
  if (!roleBody && !rulesBody) return null
  return [`# ${headings.role}`, '', roleBody, '', `# ${headings.rules}`, '', rulesBody, ''].join(
    '\n'
  )
}
