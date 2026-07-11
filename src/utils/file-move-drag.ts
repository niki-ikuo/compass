export const FILE_MOVE_DRAG_MIME = 'application/x-compass-file-move'

export function serializeFileMovePaths(paths: string[]): string {
  return JSON.stringify(paths)
}

export function parseFileMovePaths(dataTransfer: DataTransfer): string[] | null {
  const raw = dataTransfer.getData(FILE_MOVE_DRAG_MIME)
  if (!raw) return null

  try {
    const parsed = JSON.parse(raw) as unknown
    if (
      Array.isArray(parsed) &&
      parsed.length > 0 &&
      parsed.every((item) => typeof item === 'string')
    ) {
      return parsed
    }
  } catch {
    // ignore
  }
  return null
}

export function hasFileMoveDrag(dataTransfer: DataTransfer): boolean {
  return dataTransfer.types.includes(FILE_MOVE_DRAG_MIME)
}
