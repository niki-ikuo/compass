import {
  parseDeskFrontmatter,
  type OutboxDocMeta,
  type OutboxPreset
} from './desk-frontmatter'

export type ShipFindingSeverity = 'error' | 'warning' | 'info'

export type ShipFinding = {
  id: string
  severity: ShipFindingSeverity
  /** English fallback / LLM freeform text */
  message: string
  /** i18n key for UI (rule findings). Renderer translates with locale. */
  messageKey?: string
  messageParams?: Record<string, string>
  source: 'rule' | 'llm'
  excerpt?: string
}

export type ShipCheckResult = {
  findings: ShipFinding[]
  meta: OutboxDocMeta | null
  body: string
  preset: OutboxPreset | null
}

const TBD_PATTERN = /\b(?:TODO|TBD|FIXME|xxx)\b|要確認/gi
const SECRET_PATTERNS: Array<{ id: string; re: RegExp }> = [
  { id: 'secret_api_key', re: /\bapi[_-]?key\b\s*[:=]\s*['"]?[A-Za-z0-9_\-]{8,}/i },
  { id: 'secret_bearer', re: /\bBearer\s+[A-Za-z0-9\-._~+/]+=*/i },
  { id: 'secret_sk', re: /\bsk-[A-Za-z0-9]{16,}\b/ },
  { id: 'secret_long_token', re: /\b[A-Za-z0-9_\-]{40,}\b/ }
]

function excerptAround(text: string, index: number, len: number): string {
  const start = Math.max(0, index - 20)
  const end = Math.min(text.length, index + len + 20)
  return text.slice(start, end).replace(/\s+/g, ' ').trim()
}

/**
 * Stage A local rules for ship check (no LLM).
 * `glossaryText` optional: lines `Preferred | alias` warn when alias appears.
 */
export function runShipCheckStageA(
  raw: string,
  options?: { glossaryText?: string }
): ShipCheckResult {
  const { meta, body } = parseDeskFrontmatter(raw)
  const outboxMeta = meta?.kind === 'outbox' ? meta : null
  const preset = outboxMeta?.preset ?? null
  const findings: ShipFinding[] = []
  const scanText = `${outboxMeta?.subject ?? ''}\n${outboxMeta?.to ?? ''}\n${body}`

  const bodyTrim = body.replace(/\s+/g, ' ').trim()
  if (!bodyTrim) {
    findings.push({
      id: 'empty_body',
      severity: 'error',
      message: 'body is empty',
      messageKey: 'desk.ship.finding.emptyBody',
      source: 'rule'
    })
  }

  if (preset === 'mail' && !(outboxMeta?.subject ?? '').trim()) {
    findings.push({
      id: 'mail_missing_subject',
      severity: 'warning',
      message: 'mail subject is empty',
      messageKey: 'desk.ship.finding.mailMissingSubject',
      source: 'rule'
    })
  }

  TBD_PATTERN.lastIndex = 0
  let tbdMatch: RegExpExecArray | null
  const seenTbd = new Set<string>()
  while ((tbdMatch = TBD_PATTERN.exec(scanText)) !== null) {
    const token = tbdMatch[0]
    if (seenTbd.has(token.toLowerCase())) continue
    seenTbd.add(token.toLowerCase())
    findings.push({
      id: 'tbd_markers',
      severity: 'warning',
      message: `unresolved marker: ${token}`,
      messageKey: 'desk.ship.finding.tbd',
      messageParams: { token },
      source: 'rule',
      excerpt: excerptAround(scanText, tbdMatch.index, token.length)
    })
  }

  for (const { id, re } of SECRET_PATTERNS) {
    re.lastIndex = 0
    const m = re.exec(scanText)
    if (!m) continue
    // Skip long-token matches that are mostly Japanese/CJK prose
    if (id === 'secret_long_token' && /[\u3040-\u30FF\u3400-\u9FFF]/.test(m[0])) continue
    findings.push({
      id: 'secret_pattern',
      severity: 'error',
      message: `possible secret (${id})`,
      messageKey: 'desk.ship.finding.secret',
      messageParams: { kind: id },
      source: 'rule',
      excerpt: excerptAround(scanText, m.index, Math.min(m[0].length, 24))
    })
    break
  }

  const glossary = options?.glossaryText?.trim()
  if (glossary) {
    for (const line of glossary.split(/\r?\n/)) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const parts = trimmed.split('|').map((p) => p.trim()).filter(Boolean)
      if (parts.length < 2) continue
      const preferred = parts[0]
      for (const alias of parts.slice(1)) {
        if (!alias || alias === preferred) continue
        if (body.includes(alias) && !body.includes(preferred)) {
          findings.push({
            id: 'glossary_mismatch',
            severity: 'warning',
            message: `glossary: prefer "${preferred}" over "${alias}"`,
            messageKey: 'desk.ship.finding.glossary',
            messageParams: { preferred, alias },
            source: 'rule',
            excerpt: alias
          })
        }
      }
    }
  }

  return { findings, meta: outboxMeta, body, preset }
}

/** Format clipboard payload from outbox raw markdown. */
export function formatOutboxCopyPayload(raw: string): string {
  const { meta, body } = parseDeskFrontmatter(raw)
  const text = body.replace(/\s+$/, '')
  if (meta?.kind === 'outbox' && meta.preset === 'mail') {
    const lines: string[] = []
    if (meta.to?.trim()) lines.push(`To: ${meta.to.trim()}`)
    lines.push(`Subject: ${(meta.subject ?? '').trim()}`)
    lines.push('')
    lines.push(text)
    return lines.join('\n')
  }
  return text
}
