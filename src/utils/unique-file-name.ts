import { basename } from './path'

/** `report.txt`, `report (2).txt`, ...（Windows 風の連番） */
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
    const suffix = i === 0 ? '' : ` (${i + 1})`
    const name = `${stem}${suffix}${ext}`
    if (!existing.has(name.toLowerCase())) return name
  }
  return `${stem} (${Date.now()})${ext}`
}

/**
 * インライン名入力の初期選択終了位置。
 * ファイルは拡張子の直前まで、フォルダ／ドット無し／先頭ドットのみは全選択。
 */
export function getNameStemSelectionEnd(name: string, isDirectory = false): number {
  if (isDirectory || name.length === 0) return name.length
  const dot = name.lastIndexOf('.')
  if (dot <= 0) return name.length
  return dot
}
