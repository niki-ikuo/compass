import type { DataCell, DataTableRows } from './data-rows'

export interface DataColumnProfile {
  name: string
  inferredType: string
  nullCount: number
  nullRate: number
  uniqueCount: number
  samples: DataCell[]
}

export interface DataProfile {
  path: string
  kind: DataTableRows['kind']
  tableName: string
  rowCount: number
  columnCount: number
  columns: DataColumnProfile[]
}

function typeLabel(value: DataCell): string {
  if (value === null) return 'null'
  if (typeof value === 'boolean') return 'boolean'
  if (typeof value === 'number') {
    return Number.isInteger(value) ? 'integer' : 'number'
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(value)) return 'date'
  return 'string'
}

function mergeTypes(types: Set<string>): string {
  types.delete('null')
  if (types.size === 0) return 'empty'
  if (types.size === 1) return [...types][0]
  return [...types].sort().join('|')
}

/** Build a column-level profile (null rates, uniques, samples) for Agent use. */
export function buildDataProfile(table: DataTableRows): DataProfile {
  const columns: DataColumnProfile[] = table.columns.map((name, colIndex) => {
    const types = new Set<string>()
    let nullCount = 0
    const unique = new Set<string>()
    const samples: DataCell[] = []

    for (const row of table.rows) {
      const value = row[colIndex] ?? null
      types.add(typeLabel(value))
      if (value === null || value === '') {
        nullCount += 1
      } else {
        unique.add(typeof value === 'string' ? value : JSON.stringify(value))
        if (samples.length < 5) samples.push(value)
      }
    }

    const rowCount = table.rows.length
    return {
      name,
      inferredType: mergeTypes(types),
      nullCount,
      nullRate: rowCount === 0 ? 0 : Math.round((nullCount / rowCount) * 1000) / 1000,
      uniqueCount: unique.size,
      samples
    }
  })

  return {
    path: table.sourcePath,
    kind: table.kind,
    tableName: table.tableName,
    rowCount: table.rows.length,
    columnCount: table.columns.length,
    columns
  }
}

/** Compact text observation for the model (keeps tokens down). */
export function formatDataProfile(profile: DataProfile): string {
  const lines: string[] = [
    `path: ${profile.path}`,
    `table: ${profile.tableName} (${profile.kind})`,
    `rows: ${profile.rowCount}`,
    `columns: ${profile.columnCount}`,
    '---'
  ]

  for (const col of profile.columns) {
    const sample =
      col.samples.length > 0
        ? ` samples=[${col.samples
            .map((s) => (typeof s === 'string' ? JSON.stringify(s) : String(s)))
            .join(', ')}]`
        : ''
    lines.push(
      `${col.name}: type=${col.inferredType} null=${col.nullCount} (${col.nullRate}) unique=${col.uniqueCount}${sample}`
    )
  }

  lines.push(
    '',
    'Tip: query with queryData using SELECT only. Default alias `t` refers to this table.'
  )
  return lines.join('\n')
}
