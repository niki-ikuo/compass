export type DataSchemaKind = 'csv' | 'json' | 'yaml'

export interface DataSchema {
  kind: DataSchemaKind
  /** Column names (CSV) or object keys (JSON/YAML) */
  fields: string[]
  /** Row / array length when known */
  rowCount?: number
  /** field → inferred type label */
  fieldTypes?: Record<string, string>
  /** Short human-readable shape line */
  shape: string
  /** Optional one-line sample (CSV first data row or JSON snippet) */
  sample?: string
}

const CONFIG_JSON_BASENAMES = new Set([
  'package.json',
  'package-lock.json',
  'composer.json',
  'composer.lock',
  'tsconfig.json',
  'jsconfig.json',
  'turbo.json',
  'nx.json',
  '.eslintrc.json'
])

/** Paths that should not appear in the Data index section (still indexed as code/config). */
export function isDataIndexPath(relativePath: string): boolean {
  const normalized = relativePath.replace(/\\/g, '/')
  const base = normalized.split('/').pop()?.toLowerCase() ?? ''
  const lower = normalized.toLowerCase()

  if (lower.endsWith('.csv') || lower.endsWith('.tsv')) return true
  if (lower.endsWith('.yaml') || lower.endsWith('.yml')) return true
  if (!lower.endsWith('.json')) return false
  if (CONFIG_JSON_BASENAMES.has(base)) return false
  if (base.startsWith('tsconfig.') && base.endsWith('.json')) return false
  if (base.endsWith('.config.json') || base.endsWith('rc.json')) return false
  return true
}

function inferScalarType(value: string): string {
  const trimmed = value.trim()
  if (trimmed === '') return 'empty'
  if (/^(true|false)$/i.test(trimmed)) return 'boolean'
  if (/^-?\d+$/.test(trimmed)) return 'integer'
  if (/^-?\d+\.\d+$/.test(trimmed)) return 'number'
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) return 'date'
  return 'string'
}

function splitCsvLine(line: string, delimiter = ','): string[] {
  const cols: string[] = []
  let current = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      inQuotes = !inQuotes
      current += ch
      continue
    }
    if (ch === delimiter && !inQuotes) {
      cols.push(current.trim())
      current = ''
      continue
    }
    current += ch
  }
  cols.push(current.trim())
  return cols
}

function stripCsvQuotes(value: string): string {
  const trimmed = value.trim()
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1).replace(/""/g, '"')
  }
  return trimmed
}

export function extractCsvSchema(content: string, delimiter = ','): DataSchema | null {
  const lines = content.split(/\r?\n/).filter((line) => line.trim() !== '')
  if (lines.length === 0) return null

  const fields = splitCsvLine(lines[0], delimiter).map(stripCsvQuotes).filter(Boolean)
  if (fields.length === 0) return null

  const dataRows = lines.slice(1)
  const fieldTypes: Record<string, string> = {}
  const sampleLimit = Math.min(dataRows.length, 8)
  for (let col = 0; col < fields.length; col++) {
    const types = new Set<string>()
    for (let row = 0; row < sampleLimit; row++) {
      const cols = splitCsvLine(dataRows[row], delimiter)
      types.add(inferScalarType(stripCsvQuotes(cols[col] ?? '')))
    }
    types.delete('empty')
    fieldTypes[fields[col]] =
      types.size === 0 ? 'empty' : types.size === 1 ? [...types][0] : [...types].join('|')
  }

  const sample =
    dataRows.length > 0
      ? splitCsvLine(dataRows[0], delimiter)
          .map(stripCsvQuotes)
          .slice(0, 8)
          .join(', ')
          .slice(0, 120)
      : undefined

  return {
    kind: 'csv',
    fields,
    rowCount: dataRows.length,
    fieldTypes,
    shape: `csv columns[${fields.length}]: ${fields.slice(0, 16).join(', ')}${
      fields.length > 16 ? ', …' : ''
    }; rows: ${dataRows.length}`,
    sample: sample || undefined
  }
}

function jsonTypeLabel(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  return typeof value
}

function collectObjectKeys(objects: Record<string, unknown>[]): string[] {
  const counts = new Map<string, number>()
  for (const obj of objects) {
    for (const key of Object.keys(obj)) {
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([key]) => key)
}

export function extractJsonSchema(content: string): DataSchema | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch {
    return null
  }

  if (Array.isArray(parsed)) {
    const objects = parsed.filter(
      (item): item is Record<string, unknown> =>
        Boolean(item) && typeof item === 'object' && !Array.isArray(item)
    )
    if (objects.length === 0) {
      return {
        kind: 'json',
        fields: [],
        rowCount: parsed.length,
        shape: `json array[${parsed.length}]`
      }
    }
    const fields = collectObjectKeys(objects).slice(0, 40)
    const fieldTypes: Record<string, string> = {}
    for (const key of fields.slice(0, 16)) {
      const types = new Set<string>()
      for (const obj of objects.slice(0, 12)) {
        if (key in obj) types.add(jsonTypeLabel(obj[key]))
      }
      fieldTypes[key] = [...types].join('|') || '?'
    }
    return {
      kind: 'json',
      fields,
      rowCount: parsed.length,
      fieldTypes,
      shape: `json array[${parsed.length}] keys: ${fields.slice(0, 16).join(', ')}${
        fields.length > 16 ? ', …' : ''
      }`
    }
  }

  if (parsed && typeof parsed === 'object') {
    const obj = parsed as Record<string, unknown>
    const fields = Object.keys(obj).slice(0, 40)
    const fieldTypes: Record<string, string> = {}
    for (const key of fields.slice(0, 16)) {
      fieldTypes[key] = jsonTypeLabel(obj[key])
    }
    return {
      kind: 'json',
      fields,
      fieldTypes,
      shape: `json object keys: ${fields.slice(0, 16).join(', ')}${
        fields.length > 16 ? ', …' : ''
      }`
    }
  }

  return {
    kind: 'json',
    fields: [],
    shape: `json ${jsonTypeLabel(parsed)}`
  }
}

/** Top-level YAML keys only (no full parser dependency). */
export function extractYamlSchema(content: string): DataSchema | null {
  const fields: string[] = []
  const seen = new Set<string>()
  for (const line of content.split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue
    // top-level: no indent, key:
    const match = line.match(/^([A-Za-z_][\w.-]*)\s*:/)
    if (!match) continue
    const key = match[1]
    if (seen.has(key)) continue
    seen.add(key)
    fields.push(key)
    if (fields.length >= 40) break
  }
  if (fields.length === 0) return null
  return {
    kind: 'yaml',
    fields,
    shape: `yaml keys: ${fields.slice(0, 16).join(', ')}${fields.length > 16 ? ', …' : ''}`
  }
}

export function extractDataSchema(relativePath: string, content: string): DataSchema | null {
  if (!isDataIndexPath(relativePath)) return null
  const lower = relativePath.replace(/\\/g, '/').toLowerCase()
  if (lower.endsWith('.csv')) return extractCsvSchema(content, ',')
  if (lower.endsWith('.tsv')) return extractCsvSchema(content, '\t')
  if (lower.endsWith('.json')) return extractJsonSchema(content)
  if (lower.endsWith('.yaml') || lower.endsWith('.yml')) return extractYamlSchema(content)
  return null
}

export function formatDataSchemaBrief(schema: DataSchema, maxFields = 12): string {
  const parts = [schema.shape]
  if (schema.fieldTypes) {
    const typeLine = Object.entries(schema.fieldTypes)
      .slice(0, maxFields)
      .map(([name, type]) => `${name}:${type}`)
      .join(', ')
    if (typeLine) parts.push(`types: ${typeLine}`)
  }
  if (schema.sample) {
    parts.push(`sample: ${schema.sample}`)
  }
  return parts.join(' | ')
}
