const IMAGE_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  bmp: 'image/bmp'
}

export function fileExtension(filePath: string): string {
  const base = filePath.replace(/\\/g, '/').split('/').pop() ?? ''
  const dot = base.lastIndexOf('.')
  if (dot < 0) return ''
  return base.slice(dot + 1).toLowerCase()
}

export function getImageMimeType(filePath: string): string | null {
  return IMAGE_MIME[fileExtension(filePath)] ?? null
}

export function isImagePath(filePath: string): boolean {
  return getImageMimeType(filePath) !== null
}

export function isPdfPath(filePath: string): boolean {
  return fileExtension(filePath) === 'pdf'
}

export function isMediaPath(filePath: string): boolean {
  return isImagePath(filePath) || isPdfPath(filePath)
}

export function getMediaViewKind(
  filePath: string
): 'image' | 'pdf' | null {
  if (isPdfPath(filePath)) return 'pdf'
  if (isImagePath(filePath)) return 'image'
  return null
}

export function isMediaOpenFile(file: { viewKind?: string }): boolean {
  return file.viewKind === 'image' || file.viewKind === 'pdf'
}
