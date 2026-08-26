export interface FormattedFileSlice {
  formatted: string
  startLine: number
  endLine: number
  totalLines: number
  omitted: boolean
}

/**
 * Slice a file by 1-based line offset/limit and prefix each line with its file line number.
 */
export function formatFileLines(
  text: string,
  options?: { offset?: number; limit?: number }
): FormattedFileSlice {
  const lines = text.length === 0 ? [''] : text.split('\n')
  const totalLines = lines.length
  const offsetRaw = options?.offset
  const offset =
    typeof offsetRaw === 'number' && Number.isFinite(offsetRaw)
      ? Math.max(1, Math.floor(offsetRaw))
      : 1
  const limitRaw = options?.limit
  const limit =
    typeof limitRaw === 'number' && Number.isFinite(limitRaw) && limitRaw > 0
      ? Math.floor(limitRaw)
      : totalLines

  const startIdx = Math.min(offset - 1, totalLines)
  const endIdx = Math.min(startIdx + limit, totalLines)
  const slice = lines.slice(startIdx, endIdx)
  const width = String(totalLines).length
  const formatted = slice
    .map((line, i) => `${String(startIdx + i + 1).padStart(width, ' ')}|${line}`)
    .join('\n')

  return {
    formatted,
    startLine: totalLines === 0 ? 0 : startIdx + 1,
    endLine: endIdx,
    totalLines,
    omitted: startIdx > 0 || endIdx < totalLines
  }
}
