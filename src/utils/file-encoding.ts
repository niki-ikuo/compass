import type { FileEncoding } from '@/types'

export const FILE_ENCODINGS: Array<{ id: FileEncoding; label: string }> = [
  { id: 'utf8', label: 'UTF-8' },
  { id: 'utf8bom', label: 'UTF-8 with BOM' },
  { id: 'shiftjis', label: 'Shift_JIS' },
  { id: 'eucjp', label: 'EUC-JP' },
  { id: 'utf16le', label: 'UTF-16 LE' },
  { id: 'utf16be', label: 'UTF-16 BE' },
  { id: 'windows1252', label: 'Windows-1252' }
]

export function getEncodingLabel(encoding: FileEncoding): string {
  return FILE_ENCODINGS.find((item) => item.id === encoding)?.label ?? encoding
}
