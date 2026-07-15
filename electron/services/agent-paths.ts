import { existsSync } from 'fs'
import { basename, isAbsolute, join, relative, resolve } from 'path'

function normalizeSlashes(path: string): string {
  return path.replace(/\\/g, '/')
}

/**
 * ツール引数のパスをワークスペース相対に正規化する。
 * ワークスペース名そのもの（例: ルートが .../aaa なのに path="aaa"）は、
 * 同名サブフォルダが無い限りルート "." として扱う。
 *
 * existsCheck を渡すと fs をモック可能（テスト用）。省略時は existsSync。
 */
export function normalizeAgentRelativePath(
  workspaceRoot: string,
  pathArg: string | undefined,
  options?: {
    defaultToRoot?: boolean
    /** 同名サブパスの実在チェック（テスト注入可） */
    pathExists?: (absolutePath: string) => boolean
  }
): string {
  const root = resolve(workspaceRoot)
  let raw = (pathArg ?? '').trim().replace(/\\/g, '/')
  while (raw.length > 1 && raw.endsWith('/')) {
    raw = raw.slice(0, -1)
  }

  if (!raw || raw === '.' || raw === './') {
    return options?.defaultToRoot === false ? '' : '.'
  }

  // 絶対パスがワークスペース直下を指す場合
  if (isAbsolute(raw) || /^[a-zA-Z]:/.test(raw)) {
    const abs = resolve(raw)
    const rel = relative(root, abs)
    if (!rel || rel === '') return '.'
    if (rel.startsWith('..') || isAbsolute(rel)) {
      return raw
    }
    return normalizeSlashes(rel)
  }

  const rootName = basename(root)
  const sameName =
    raw === rootName ||
    (process.platform === 'win32' && raw.toLowerCase() === rootName.toLowerCase())

  if (sameName) {
    const candidate = join(root, raw)
    const exists = options?.pathExists
      ? options.pathExists(candidate)
      : existsSync(candidate)
    if (!exists) {
      return '.'
    }
  }

  return raw
}
