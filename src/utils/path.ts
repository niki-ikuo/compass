export function join(...parts: string[]): string {
  return parts
    .join('/')
    .replace(/\\/g, '/')
    .replace(/\/+/g, '/')
}

export function basename(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/').replace(/\/$/, '')
  const idx = normalized.lastIndexOf('/')
  return idx < 0 ? normalized : normalized.slice(idx + 1)
}
