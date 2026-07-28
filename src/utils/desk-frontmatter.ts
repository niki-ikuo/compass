/** Desk Loop frontmatter parse / serialize (inbox / outbox). */

export type DeskInboxSource = 'clipboard' | 'import' | 'unknown'

export type OutboxPreset = 'mail' | 'minutes' | 'report' | 'chat'

export type OutboxStatus = 'draft' | 'ready' | 'archived'

export type DeskCaptureOpenTarget = 'file' | 'desk'

export type InboxDocMeta = {
  kind: 'inbox'
  capturedAt: string
  source: DeskInboxSource
}

export type OutboxDocMeta = {
  kind: 'outbox'
  preset: OutboxPreset
  status: OutboxStatus
  to?: string
  subject?: string
  sourcePath?: string
  createdAt: string
  updatedAt?: string
}

export type DeskDocMeta = InboxDocMeta | OutboxDocMeta

const OUTBOX_PRESETS: OutboxPreset[] = ['mail', 'minutes', 'report', 'chat']
const OUTBOX_STATUSES: OutboxStatus[] = ['draft', 'ready', 'archived']
const INBOX_SOURCES: DeskInboxSource[] = ['clipboard', 'import', 'unknown']

function quoteYamlScalar(value: string): string {
  if (value === '' || /[:#{}[\],&*?|>!%@`"'\\]/.test(value) || /^\s|\s$/.test(value)) {
    return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
  }
  return value
}

function unquoteYamlScalar(raw: string): string {
  const value = raw.trim()
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\')
  }
  return value
}

/** Split `---` frontmatter from Markdown body. */
export function splitFrontmatter(raw: string): { yaml: string | null; body: string } {
  const text = raw.replace(/^\uFEFF/, '')
  if (!text.startsWith('---')) {
    return { yaml: null, body: text }
  }
  const end = text.indexOf('\n---', 3)
  if (end < 0) {
    return { yaml: null, body: text }
  }
  const yaml = text.slice(4, end).replace(/^\r?\n/, '')
  let body = text.slice(end + 4)
  if (body.startsWith('\r\n')) body = body.slice(2)
  else if (body.startsWith('\n')) body = body.slice(1)
  return { yaml, body }
}

function parseYamlMap(yaml: string): Record<string, string> {
  const map: Record<string, string> = {}
  for (const line of yaml.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const colon = trimmed.indexOf(':')
    if (colon <= 0) continue
    const key = trimmed.slice(0, colon).trim()
    const value = unquoteYamlScalar(trimmed.slice(colon + 1))
    map[key] = value
  }
  return map
}

export function parseDeskFrontmatter(raw: string): {
  meta: DeskDocMeta | null
  body: string
  fields: Record<string, string>
} {
  const { yaml, body } = splitFrontmatter(raw)
  if (!yaml) {
    return { meta: null, body, fields: {} }
  }
  const fields = parseYamlMap(yaml)
  const kind = fields.kind

  if (kind === 'inbox') {
    const source = INBOX_SOURCES.includes(fields.source as DeskInboxSource)
      ? (fields.source as DeskInboxSource)
      : 'unknown'
    return {
      meta: {
        kind: 'inbox',
        capturedAt: fields.capturedAt || '',
        source
      },
      body,
      fields
    }
  }

  if (kind === 'outbox') {
    const preset = OUTBOX_PRESETS.includes(fields.preset as OutboxPreset)
      ? (fields.preset as OutboxPreset)
      : 'mail'
    const status = OUTBOX_STATUSES.includes(fields.status as OutboxStatus)
      ? (fields.status as OutboxStatus)
      : 'draft'
    return {
      meta: {
        kind: 'outbox',
        preset,
        status,
        to: fields.to,
        subject: fields.subject,
        sourcePath: fields.sourcePath,
        createdAt: fields.createdAt || '',
        updatedAt: fields.updatedAt
      },
      body,
      fields
    }
  }

  return { meta: null, body, fields }
}

export function serializeInboxDocument(meta: InboxDocMeta, body: string): string {
  const lines = [
    '---',
    'kind: inbox',
    `capturedAt: ${quoteYamlScalar(meta.capturedAt)}`,
    `source: ${meta.source}`,
    '---',
    '',
    body.replace(/^\uFEFF/, '').replace(/^\r?\n/, '')
  ]
  return lines.join('\n')
}

export function serializeOutboxDocument(meta: OutboxDocMeta, body: string): string {
  const lines = [
    '---',
    'kind: outbox',
    `preset: ${meta.preset}`,
    `status: ${meta.status}`,
    `to: ${quoteYamlScalar(meta.to ?? '')}`,
    `subject: ${quoteYamlScalar(meta.subject ?? '')}`
  ]
  if (meta.sourcePath) {
    lines.push(`sourcePath: ${quoteYamlScalar(meta.sourcePath)}`)
  }
  lines.push(`createdAt: ${quoteYamlScalar(meta.createdAt)}`)
  if (meta.updatedAt) {
    lines.push(`updatedAt: ${quoteYamlScalar(meta.updatedAt)}`)
  }
  lines.push('---', '', body.replace(/^\uFEFF/, '').replace(/^\r?\n/, ''))
  return lines.join('\n')
}

export function isOutboxPreset(value: string): value is OutboxPreset {
  return OUTBOX_PRESETS.includes(value as OutboxPreset)
}

export function getOutboxPresets(): OutboxPreset[] {
  return [...OUTBOX_PRESETS]
}
