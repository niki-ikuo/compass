const COMPARE_PATH_PREFIX = 'compass-compare://'

export function isCompareTabPath(path: string): boolean {
  return path.startsWith(COMPARE_PATH_PREFIX)
}

export function createCompareTabPath(id: string = crypto.randomUUID()): string {
  return `${COMPARE_PATH_PREFIX}${id}`
}

export function isCompareOpenFile(file: { viewKind?: string }): boolean {
  return file.viewKind === 'compare'
}

export function normalizeComparePath(path: string): string {
  return path.replace(/\\/g, '/')
}

export function pathsEqualIgnoreCase(a: string, b: string): boolean {
  return normalizeComparePath(a).toLowerCase() === normalizeComparePath(b).toLowerCase()
}
