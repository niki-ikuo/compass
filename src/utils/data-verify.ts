export interface DataVerifyIssue {
  path?: string
  message: string
}

/** 簡易 CSV: ヘッダ列数と各行の列数を比較（クォート非対応の軽量版） */
export function verifyCsvContent(content: string): DataVerifyIssue[] {
  const lines = content.split(/\r?\n/).filter((line, index, all) => {
    if (line.trim() !== '') return true
    // keep trailing empties out; allow blank lines in middle as skip
    return index < all.length - 1 && all.slice(index + 1).some((l) => l.trim() !== '')
  })
  const dataLines = lines.filter((line) => line.trim() !== '')
  if (dataLines.length === 0) {
    return [{ message: 'CSV is empty' }]
  }

  const headerCols = splitCsvLine(dataLines[0])
  if (headerCols.length === 0) {
    return [{ message: 'CSV header has no columns' }]
  }

  const issues: DataVerifyIssue[] = []
  for (let i = 1; i < dataLines.length; i++) {
    const cols = splitCsvLine(dataLines[i])
    if (cols.length !== headerCols.length) {
      issues.push({
        message: `Row ${i + 1} has ${cols.length} column(s); header has ${headerCols.length}`
      })
      if (issues.length >= 20) {
        issues.push({ message: '… additional column mismatches omitted' })
        break
      }
    }
  }
  return issues
}

function splitCsvLine(line: string): string[] {
  // Lightweight: split on commas not inside simple double quotes
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
    if (ch === ',' && !inQuotes) {
      cols.push(current)
      current = ''
      continue
    }
    current += ch
  }
  cols.push(current)
  return cols
}

/** JSON: パース + オブジェクト配列のキー欠落チェック */
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
  if (lower.endsWith('.csv')) issues = verifyCsvContent(content)
  else if (lower.endsWith('.json')) issues = verifyJsonContent(content)
  else if (lower.endsWith('.yaml') || lower.endsWith('.yml')) issues = verifyYamlContent(content)
  else return []

  return issues.map((issue) => ({ ...issue, path: relativePath }))
}
