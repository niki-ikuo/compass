import { basename } from './path'

/** `report.txt`, `report-2.txt`, ... */
export function buildUniqueFileName(
  preferredName: string,
  existingNames: Iterable<string>
): string {
  const existing = new Set(
    [...existingNames].map((name) => basename(name).replace(/\\/g, '/').toLowerCase())
  )
  const normalized = basename(preferredName).replace(/\\/g, '/')
  const dot = normalized.lastIndexOf('.')
  const hasExt = dot > 0
  const stem = hasExt ? normalized.slice(0, dot) : normalized
  const ext = hasExt ? normalized.slice(dot) : ''

  for (let i = 0; i < 100; i++) {
    const suffix = i === 0 ? '' : `-${i + 1}`
    const name = `${stem}${suffix}${ext}`
    if (!existing.has(name.toLowerCase())) return name
  }
  return `${stem}-${Date.now()}${ext}`
}
