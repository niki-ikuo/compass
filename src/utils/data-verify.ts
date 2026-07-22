export interface DataVerifyIssue {
  path?: string
  message: string
}

function stripCsvQuotes(value: string): string {
  const trimmed = value.trim()
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1).replace(/""/g, '"')
  }
  return trimmed
}

function inferLooseType(value: string): string {
  const trimmed = value.trim()
  if (trimmed === '') return 'empty'
  if (/^(true|false)$/i.test(trimmed)) return 'boolean'
  if (/^-?\d+$/.test(trimmed)) return 'integer'
  if (/^-?\d+\.\d+$/.test(trimmed)) return 'number'
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) return 'date'
  return 'string'
}

/** Detect duplicate values in the first column (common primary-key heuristic). */
function checkDuplicateKeyColumn(
  rows: string[][],
  header: string[],
  issues: DataVerifyIssue[],
  maxIssues: number
): void {
  if (header.length === 0 || rows.length < 2) return
  const keyName = stripCsvQuotes(header[0]) || 'col_1'
  const seen = new Map<string, number>()
  for (let i = 0; i < rows.length; i++) {
    const key = stripCsvQuotes(rows[i][0] ?? '').trim()
    if (!key) continue
    const prev = seen.get(key)
    if (prev !== undefined) {
      issues.push({
        message: `Duplicate key "${keyName}"="${key}" at rows ${prev + 2} and ${i + 2}`
      })
      if (issues.length >= maxIssues) return
    } else {
      seen.set(key, i)
    }
  }
}

/** Flag columns that mix incompatible scalar types across rows. */
function checkTypeConsistency(
  rows: string[][],
  header: string[],
  issues: DataVerifyIssue[],
  maxIssues: number
): void {
  for (let col = 0; col < header.length; col++) {
    const types = new Set<string>()
    for (const row of rows.slice(0, 200)) {
      const raw = stripCsvQuotes(row[col] ?? '')
      const t = inferLooseType(raw)
      if (t !== 'empty') types.add(t)
      if (types.size > 2) break
    }
    // integer|number is fine; boolean|string etc. is suspicious
    const list = [...types].sort()
    if (list.length <= 1) continue
    if (list.length === 2 && list.includes('integer') && list.includes('number')) continue
    issues.push({
      message: `Column "${stripCsvQuotes(header[col]) || `col_${col + 1}`}" mixes types: ${list.join('|')}`
    })
    if (issues.length >= maxIssues) return
  }
}

/** 簡易 CSV/TSV: ヘッダ列数と各行の列数を比較（クォート対応の軽量版） */
export function verifyCsvContent(content: string, delimiter = ','): DataVerifyIssue[] {
  const label = delimiter === '\t' ? 'TSV' : 'CSV'
  const lines = content.split(/\r?\n/).filter((line, index, all) => {
    if (line.trim() !== '') return true
    // keep trailing empties out; allow blank lines in middle as skip
    return index < all.length - 1 && all.slice(index + 1).some((l) => l.trim() !== '')
  })
  const dataLines = lines.filter((line) => line.trim() !== '')
  if (dataLines.length === 0) {
    return [{ message: `${label} is empty` }]
  }

  const headerCols = splitDelimitedLine(dataLines[0], delimiter)
  if (headerCols.length === 0) {
    return [{ message: `${label} header has no columns` }]
  }

  const issues: DataVerifyIssue[] = []
  const bodyRows: string[][] = []
  for (let i = 1; i < dataLines.length; i++) {
    const cols = splitDelimitedLine(dataLines[i], delimiter)
    bodyRows.push(cols)
    if (cols.length !== headerCols.length) {
      issues.push({
        message: `Row ${i + 1} has ${cols.length} column(s); header has ${headerCols.length}`
      })
      if (issues.length >= 20) {
        issues.push({ message: '… additional column mismatches omitted' })
        return issues
      }
    }
  }

  if (issues.length < 20) {
    checkDuplicateKeyColumn(bodyRows, headerCols, issues, 20)
  }
  if (issues.length < 20) {
    checkTypeConsistency(bodyRows, headerCols, issues, 20)
  }
  return issues
}

function splitDelimitedLine(line: string, delimiter: string): string[] {
  // Lightweight: split on delimiter not inside simple double quotes
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
      cols.push(current)
      current = ''
      continue
    }
    current += ch
  }
  cols.push(current)
  return cols
}

/** JSON: パース + オブジェクト配列のキー欠落・重複 id・型混在チェック */
export function verifyJsonContent(content: string): DataVerifyIssue[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return [{ message: `Invalid JSON: ${message}` }]
  }

  if (!Array.isArray(parsed)) return []
  const objects = parsed.filter(
    (item): item is Record<string, unknown> =>
      Boolean(item) && typeof item === 'object' && !Array.isArray(item)
  )
  if (objects.length < 2) return []

  const keyCounts = new Map<string, number>()
  for (const obj of objects) {
    for (const key of Object.keys(obj)) {
      keyCounts.set(key, (keyCounts.get(key) ?? 0) + 1)
    }
  }

  const commonKeys = [...keyCounts.entries()]
    .filter(([, count]) => count >= Math.ceil(objects.length * 0.5))
    .map(([key]) => key)
  if (commonKeys.length === 0) return []

  const issues: DataVerifyIssue[] = []
  objects.forEach((obj, index) => {
    const missing = commonKeys.filter((key) => !(key in obj))
    if (missing.length > 0) {
      issues.push({
        message: `Item ${index} missing key(s): ${missing.slice(0, 8).join(', ')}`
      })
    }
  })

  const idKey = ['id', 'ID', 'Id', 'key', 'Key'].find((k) => commonKeys.includes(k))
  if (idKey && issues.length < 20) {
    const seen = new Map<string, number>()
    objects.forEach((obj, index) => {
      if (!(idKey in obj) || obj[idKey] === null || obj[idKey] === undefined) return
      const key = JSON.stringify(obj[idKey])
      const prev = seen.get(key)
      if (prev !== undefined) {
        issues.push({
          message: `Duplicate "${idKey}"=${key} at items ${prev} and ${index}`
        })
      } else {
        seen.set(key, index)
      }
    })
  }

  if (issues.length < 20) {
    for (const key of commonKeys.slice(0, 24)) {
      const types = new Set<string>()
      for (const obj of objects.slice(0, 200)) {
        if (!(key in obj)) continue
        const value = obj[key]
        if (value === null || value === undefined) continue
        if (Array.isArray(value)) types.add('array')
        else types.add(typeof value)
        if (types.size > 2) break
      }
      if (types.size > 1) {
        issues.push({
          message: `Key "${key}" mixes types: ${[...types].sort().join('|')}`
        })
      }
      if (issues.length >= 20) break
    }
  }

  return issues.slice(0, 20)
}

/** YAML: インデントが急に浅くなる行の警告（厳密パーサなし） */
export function verifyYamlContent(content: string): DataVerifyIssue[] {
  const lines = content.split(/\r?\n/)
  const issues: DataVerifyIssue[] = []
  let prevIndent = 0
  let sawContent = false

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (!line.trim() || line.trimStart().startsWith('#')) continue
    const indent = line.match(/^ */)?.[0].length ?? 0
    if (sawContent && indent < prevIndent - 2 && indent % 2 !== 0) {
      issues.push({
        message: `Suspicious indentation at line ${i + 1} (indent ${indent}, previous ${prevIndent})`
      })
    }
    // jump deeper by more than 2 unexpectedly
    if (sawContent && indent > prevIndent + 2) {
      issues.push({
        message: `Indent jumps from ${prevIndent} to ${indent} at line ${i + 1}`
      })
    }
    prevIndent = indent
    sawContent = true
    if (issues.length >= 15) break
  }

  return issues
}

export function verifyDataFile(
  relativePath: string,
  content: string
): DataVerifyIssue[] {
  const lower = relativePath.replace(/\\/g, '/').toLowerCase()
  let issues: DataVerifyIssue[] = []
  if (lower.endsWith('.csv')) issues = verifyCsvContent(content, ',')
  else if (lower.endsWith('.tsv')) issues = verifyCsvContent(content, '\t')
  else if (lower.endsWith('.json')) issues = verifyJsonContent(content)
  else if (lower.endsWith('.yaml') || lower.endsWith('.yml')) issues = verifyYamlContent(content)
  else return []

  return issues.map((issue) => ({ ...issue, path: relativePath }))
}
