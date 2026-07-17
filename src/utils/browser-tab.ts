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
