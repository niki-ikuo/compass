import { fileExtension } from './media-context'

/** 先頭サンプルでバイナリ判定するバイト数（検索側と同程度） */
export const BINARY_CHECK_BYTES = 8000

/**
 * エディタでテキスト表示しない既知バイナリ拡張子。
 * 画像・PDF・Office は別経路（media / external）なので含めない。
 */
const BINARY_EXTENSIONS = new Set([
  // archives / packages
  'zip',
  '7z',
  'rar',
  'gz',
  'bz2',
  'xz',
  'zst',
  'lz4',
  'br',
  'tar',
  'tgz',
  'tbz2',
  'txz',
  'cab',
  'iso',
  'dmg',
  'pkg',
  'deb',
  'rpm',
  'apk',
  'aab',
  'msi',
  'jar',
  'war',
  'ear',
  'whl',
  'egg',
  'nupkg',
  'vsix',
  'crx',
  // native / object
  'exe',
  'dll',
  'so',
  'dylib',
  'bin',
  'o',
  'a',
  'lib',
  'obj',
  'class',
  'pyc',
  'pyo',
  'node',
  'wasm',
  'pdb',
  'appimage',
  // fonts
  'woff',
  'woff2',
  'ttf',
  'otf',
  'eot',
  'ico',
  'icns',
  // audio / video
  'mp3',
  'mp4',
  'm4a',
  'aac',
  'wav',
  'flac',
  'ogg',
  'oga',
  'opus',
  'avi',
  'mov',
  'mkv',
  'webm',
  'wmv',
  'flv',
  // data / db
  'sqlite',
  'sqlite3',
  'db',
  'mdb',
  'parquet',
  'feather',
  'arrow',
  'pkl',
  'pickle',
  'npy',
  'npz'
])

export function isBinaryExtensionPath(filePath: string): boolean {
  return BINARY_EXTENSIONS.has(fileExtension(filePath))
}

/** ASCII 寄り UTF-16（BOM なし）は NUL が多いのでテキスト扱い */
function looksLikeUtf16Bytes(bytes: Uint8Array): boolean {
  if (bytes.length < 4 || bytes.length % 2 !== 0) return false

  let nulEven = 0
  let nulOdd = 0
  const pairs = Math.min(Math.floor(bytes.length / 2), 512)
  for (let i = 0; i < pairs; i++) {
    if (bytes[i * 2] === 0) nulEven += 1
    if (bytes[i * 2 + 1] === 0) nulOdd += 1
  }
  return nulEven / pairs > 0.25 || nulOdd / pairs > 0.25
}

function hasUtf16Bom(bytes: Uint8Array): boolean {
  return (
    (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) ||
    (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff)
  )
}

/** 先頭サンプルに NUL があればバイナリ（UTF-16 は除外） */
export function isProbablyBinaryBytes(bytes: Uint8Array): boolean {
  if (bytes.length === 0) return false
  if (hasUtf16Bom(bytes) || looksLikeUtf16Bytes(bytes)) return false

  const sampleLen = Math.min(bytes.length, BINARY_CHECK_BYTES)
  for (let i = 0; i < sampleLen; i++) {
    if (bytes[i] === 0) return true
  }
  return false
}

export function isBinaryOpenFile(file: { viewKind?: string }): boolean {
  return file.viewKind === 'binary'
}

export function formatByteSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 B'
  if (bytes < 1024) return `${Math.round(bytes)} B`
  if (bytes < 1024 * 1024) {
    const kb = bytes / 1024
    return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`
  }
  const mb = bytes / (1024 * 1024)
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`
}
