const BROWSER_PATH_PREFIX = 'compass-browser://'

export function isBrowserTabPath(path: string): boolean {
  return path.startsWith(BROWSER_PATH_PREFIX)
}

export function createBrowserTabPath(id: string = crypto.randomUUID()): string {
  return `${BROWSER_PATH_PREFIX}${id}`
}

export function isBrowserOpenFile(file: {
  viewKind?: string
}): boolean {
  return file.viewKind === 'browser'
}

/**
 * アドレスバー入力を URL に正規化する。
 * スキーム無しのドメインは https:// を付与。それ以外は Google 検索。
 */
export function normalizeBrowserUrl(input: string): string {
  const trimmed = input.trim()
  if (!trimmed) return 'about:blank'

  if (/^(https?|about|file|data):/i.test(trimmed)) {
    return trimmed
  }

  if (
    /^(localhost|(\d{1,3}\.){3}\d{1,3})(:\d+)?(\/.*)?$/i.test(trimmed) ||
    /^[\w-]+(\.[\w-]+)+(:\d+)?(\/.*)?$/i.test(trimmed)
  ) {
    return `https://${trimmed}`
  }

  return `https://www.google.com/search?q=${encodeURIComponent(trimmed)}`
}

/** タブブラウザで開く対象（HTML レポート等） */
export function isHtmlFilePath(filePath: string): boolean {
  return /\.html?$/i.test(filePath.trim())
}

/**
 * ローカル絶対パスを file:// URL に変換する。
 * Windows のドライブ文字・UNC・空白付きパスに対応。
 */
export function pathToFileUrl(filePath: string): string {
  const trimmed = filePath.trim()
  if (!trimmed) return 'about:blank'
  if (/^file:/i.test(trimmed)) return trimmed

  const normalized = trimmed.replace(/\\/g, '/')

  const encodePath = (pathWithSlashes: string): string =>
    pathWithSlashes
      .split('/')
      .map((segment, index) => {
        // Windows ドライブレター (C:) はそのまま
        if (index === 0 && /^[a-zA-Z]:$/.test(segment)) return segment
        return encodeURIComponent(segment)
      })
      .join('/')

  // UNC: //server/share/file.html → file://server/share/file.html
  if (normalized.startsWith('//')) {
    return `file:${encodePath(normalized)}`
  }

  // Windows: C:/foo/bar.html → file:///C:/foo/bar.html
  if (/^[a-zA-Z]:\//.test(normalized)) {
    return `file:///${encodePath(normalized)}`
  }

  // POSIX 絶対パス
  if (normalized.startsWith('/')) {
    return `file://${encodePath(normalized)}`
  }

  return `file:///${encodePath(normalized)}`
}
