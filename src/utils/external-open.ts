import { fileExtension } from '@/utils/media-context'

/** OS 既定アプリで開く対象（Office / OpenDocument）。CSV などテキスト扱いは含めない。 */
const EXTERNAL_OPEN_EXTENSIONS = new Set([
  'doc',
  'docx',
  'docm',
  'dot',
  'dotx',
  'dotm',
  'xls',
  'xlsx',
  'xlsm',
  'xlsb',
  'xlt',
  'xltx',
  'xltm',
  'ppt',
  'pptx',
  'pptm',
  'pot',
  'potx',
  'potm',
  'pps',
  'ppsx',
  'ppsm',
  'odt',
  'ods',
  'odp'
])

export function isExternalOpenPath(filePath: string): boolean {
  return EXTERNAL_OPEN_EXTENSIONS.has(fileExtension(filePath))
}
