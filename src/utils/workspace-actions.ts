import type { WorkspaceAction } from '@/types'
import { CODE_FENCE_REGEX, findCompassActionsBlocks } from './code-fence'
import type { CodeBlock } from '@/types'
import { t } from '../i18n/runtime'

function extractCodeBlocksLocal(content: string): CodeBlock[] {
  const blocks: CodeBlock[] = []
  let match: RegExpExecArray | null

  CODE_FENCE_REGEX.lastIndex = 0
  while ((match = CODE_FENCE_REGEX.exec(content)) !== null) {
    blocks.push({
      language: match[1] || 'plaintext',
      code: match[2].trimEnd()
    })
  }

  return blocks
}

export function stripCompassActionsBlocks(content: string): string {
  const blocks = findCompassActionsBlocks(content)
  if (blocks.length === 0) return content.trim()

  let result = ''
  let cursor = 0
  for (const block of blocks) {
    result += content.slice(cursor, block.start)
    cursor = block.end
  }
  result += content.slice(cursor)
  return result.trim()
}

export function stripAllCompassActionsContent(content: string): string {
  let result = stripCompassActionsBlocks(content)
  // Streaming / aborted replies may leave an unclosed fence without balanced JSON.
  result = result.replace(/```\s*compass-actions\b[\s\S]*$/i, '').trim()
  return result
}

function parseActionsJson(raw: string): WorkspaceAction[] {
  const text = raw.trim()
  if (!text) return []

  const attempts = [text]
  const lastBrace = text.lastIndexOf('}')
  if (lastBrace > 0) {
    attempts.push(text.slice(0, lastBrace + 1))
  }

  for (const candidate of attempts) {
    try {
      const parsed = JSON.parse(candidate) as { actions?: WorkspaceAction[] }
      if (!Array.isArray(parsed.actions)) continue

      const actions = parsed.actions.filter((action) => {
        if (!action || typeof action !== 'object') return false
        if (action.type === 'mkdir') return typeof action.path === 'string' && action.path.length > 0
        if (action.type === 'writeFile') {
          return typeof action.path === 'string' && action.path.length > 0 && typeof action.content === 'string'
        }
        if (action.type === 'applyPatch') {
          return (
            typeof action.path === 'string' &&
            action.path.length > 0 &&
            typeof action.patch === 'string' &&
            action.patch.trim().length > 0
          )
        }
        if (action.type === 'deleteFile' || action.type === 'deleteDir') {
          return typeof action.path === 'string' && action.path.length > 0
        }
        return false
      })

      if (actions.length > 0) return actions
    } catch {
      // try next candidate
    }
  }

  return []
}

export function parseWorkspaceActionsFromContent(content: string): WorkspaceAction[] {
  for (const block of findCompassActionsBlocks(content)) {
    const actions = parseActionsJson(block.json)
    if (actions.length > 0) return actions
  }
  return []
}

export function stripCodeBlocksByLanguage(content: string, languages: string[]): string {
  let result = content
  for (const language of languages) {
    const pattern = new RegExp(`\`\`\`\\s*${language}\\s*\\n?[\\s\\S]*?\`\`\``, 'gi')
    result = result.replace(pattern, '').trim()
  }
  return result
}

function normalizeSlashes(path: string): string {
  return path.replace(/\\/g, '/')
}

function trimTrailingSlashes(path: string): string {
  let value = path
  while (value.length > 1 && value.endsWith('/')) {
    value = value.slice(0, -1)
  }
  return value
}

function isAbsoluteFilesystemPath(path: string): boolean {
  const normalized = normalizeSlashes(path)
  return normalized.startsWith('/') || /^[a-zA-Z]:\//.test(normalized) || normalized.startsWith('//')
}

function pathSegmentsEqual(a: string, b: string): boolean {
  if (typeof process !== 'undefined' && process.platform === 'win32') {
    return a.toLowerCase() === b.toLowerCase()
  }
  return a === b
}

function pathStartsWithRoot(path: string, root: string): boolean {
  if (typeof process !== 'undefined' && process.platform === 'win32') {
    const lowerPath = path.toLowerCase()
    const lowerRoot = root.toLowerCase()
    return lowerPath === lowerRoot || lowerPath.startsWith(`${lowerRoot}/`)
  }
  return path === root || path.startsWith(`${root}/`)
}

function joinWorkspaceRoot(workspaceRoot: string, relativePath: string): string {
  const root = trimTrailingSlashes(normalizeSlashes(workspaceRoot))
  const rel = normalizeSlashes(relativePath).replace(/^\.\//, '')
  if (!rel || rel === '.') return root
  return `${root}/${rel}`
}

/**
 * 絶対パスをワークスペース相対へ。すでに相対ならそのまま返す。
 * プレフィックス不一致時に basename だけ残す旧挙動は、日本語ネストパスを壊すため廃止。
 */
export function toWorkspaceRelativePath(workspaceRoot: string, filePath: string): string {
  const root = trimTrailingSlashes(normalizeSlashes(workspaceRoot))
  const normalized = normalizeSlashes(filePath)

  if (!isAbsoluteFilesystemPath(normalized)) {
    return normalized.replace(/^\.\//, '')
  }

  if (pathStartsWithRoot(normalized, root)) {
    if (pathSegmentsEqual(normalized, root)) return '.'
    return normalized.slice(root.length + 1)
  }

  return normalized
}

export type NormalizeWorkspacePathOptions = {
  /** 同名サブパスの実在チェック。Main では existsSync を渡す。未指定時は危険なプレフィックス剥離をしない。 */
  pathExists?: (absolutePath: string) => boolean
}

/**
 * アクション path をワークスペース相対に正規化する。
 * ワークスペース名プレフィックスの剥離は、pathExists があるときだけ
 * （同名サブフォルダが実在すれば維持、無ければ誤付与とみなして除去）。
 */
export function normalizeWorkspaceActionPath(
  workspaceRoot: string,
  actionPath: string,
  options?: NormalizeWorkspacePathOptions
): string {
  let relative = normalizeSlashes(actionPath).replace(/^\.\//, '')
  relative = trimTrailingSlashes(relative)

  if (!relative || relative === '.') return ''

  if (isAbsoluteFilesystemPath(relative)) {
    relative = toWorkspaceRelativePath(workspaceRoot, relative)
    if (relative === '.') return ''
  }

  const root = trimTrailingSlashes(normalizeSlashes(workspaceRoot))
  const rootBase = root.split('/').filter(Boolean).pop()
  if (!rootBase) return relative

  const isBareRootName = pathSegmentsEqual(relative, rootBase)
  const hasRootPrefix =
    relative.length > rootBase.length &&
    pathSegmentsEqual(relative.slice(0, rootBase.length), rootBase) &&
    relative.charAt(rootBase.length) === '/'

  if (!isBareRootName && !hasRootPrefix) {
    return relative
  }

  const pathExists = options?.pathExists
  if (!pathExists) {
    // Renderer など存在確認できない場合は剥離しない（日本語フォルダ名を落とさない）
    return relative
  }

  if (isBareRootName) {
    return pathExists(joinWorkspaceRoot(workspaceRoot, relative)) ? relative : ''
  }

  const stripped = relative.slice(rootBase.length + 1)
  const fullAbs = joinWorkspaceRoot(workspaceRoot, relative)
  if (pathExists(fullAbs)) {
    return relative
  }
  return stripped
}

export function normalizeWorkspaceActions(
  workspaceRoot: string,
  actions: WorkspaceAction[],
  options?: NormalizeWorkspacePathOptions
): WorkspaceAction[] {
  return actions
    .map((action) => {
      if (
        action.type === 'mkdir' ||
        action.type === 'writeFile' ||
        action.type === 'applyPatch' ||
        action.type === 'deleteFile' ||
        action.type === 'deleteDir'
      ) {
        return {
          ...action,
          path: normalizeWorkspaceActionPath(workspaceRoot, action.path, options)
        }
      }
      return action
    })
    .filter((action) => action.path.length > 0)
}

function inferTargetPath(
  content: string,
  workspaceRoot: string,
  activeFilePath: string | null
): string | null {
  if (activeFilePath) {
    return normalizeWorkspaceActionPath(
      workspaceRoot,
      toWorkspaceRelativePath(workspaceRoot, activeFilePath)
    )
  }

  const backtickMatch = content.match(
    /`([^`\n]+\.(?:css|html|js|ts|tsx|jsx|json|md|csv|yml|yaml|txt))`/i
  )
  if (backtickMatch) {
    return normalizeWorkspaceActionPath(workspaceRoot, backtickMatch[1].trim())
  }

  // スペース・日本語を含むパスを許可。終端は空白・句読点・括弧で区切る
  const pathMatch = content.match(
    /(?:^|[\s(「『])([^`"「」『』()\n]+?\.(?:css|html|js|ts|tsx|jsx|json|md|csv|yml|yaml|txt))(?=$|[\s)」』。、])/im
  )
  if (pathMatch) {
    return normalizeWorkspaceActionPath(workspaceRoot, pathMatch[1].trim())
  }

  return null
}

export function inferWorkspaceActionsFromCodeBlocks(
  content: string,
  workspaceRoot: string,
  activeFilePath: string | null
): WorkspaceAction[] {
  const blocks = extractCodeBlocksLocal(content).filter(
    (block) => !['compass-actions', 'plaintext', 'text', 'markdown'].includes(block.language.toLowerCase())
  )
  if (blocks.length === 0) return []

  const targetPath = inferTargetPath(content, workspaceRoot, activeFilePath)
  if (!targetPath) return []

  const lastBlock = blocks[blocks.length - 1]
  return [{ type: 'writeFile', path: targetPath, content: lastBlock.code }]
}

export function getWorkspaceActionsLabel(code: string): { label: string; meta: string } {
  try {
    const parsed = JSON.parse(code.trim()) as { actions?: WorkspaceAction[] }
    const actions = parsed.actions ?? []
    const writeActions = actions.filter(
      (action): action is Extract<WorkspaceAction, { type: 'writeFile' | 'applyPatch' }> =>
        action.type === 'writeFile' || action.type === 'applyPatch'
    )
    const mkdirActions = actions.filter(
      (action): action is Extract<WorkspaceAction, { type: 'mkdir' }> => action.type === 'mkdir'
    )
    const deleteActions = actions.filter(
      (action) => action.type === 'deleteFile' || action.type === 'deleteDir'
    )

    const filePaths = writeActions.map((action) => action.path.replace(/\\/g, '/'))
    const dirPaths = mkdirActions.map((action) => action.path.replace(/\\/g, '/'))
    const deletePaths = deleteActions.map((action) => action.path.replace(/\\/g, '/'))

    if (filePaths.length === 1 && dirPaths.length === 0 && deletePaths.length === 0) {
      const only = writeActions[0]
      return {
        label: filePaths[0],
        meta: only.type === 'applyPatch' ? t('actions.applyPatch') : t('actions.changeProposal')
      }
    }
    if (dirPaths.length === 1 && filePaths.length === 0 && deletePaths.length === 0) {
      return { label: dirPaths[0], meta: t('actions.mkdir') }
    }
    if (deletePaths.length === 1 && filePaths.length === 0 && dirPaths.length === 0) {
      return {
        label: deletePaths[0],
        meta:
          deleteActions[0].type === 'deleteDir' ? t('actions.deleteDir') : t('actions.deleteFile')
      }
    }

    const parts: string[] = []
    if (dirPaths.length > 0) parts.push(t('preview.mkdir', { count: dirPaths.length }))
    if (filePaths.length > 0) parts.push(t('preview.files', { count: filePaths.length }))
    if (deletePaths.length > 0) parts.push(t('preview.delete', { count: deletePaths.length }))
    return {
      label: t('actions.workspaceOps'),
      meta: parts.join(' · ') || t('common.countItems', { count: actions.length })
    }
  } catch {
    return { label: t('actions.fileOps'), meta: 'JSON' }
  }
}

export function buildDisplayContentForActions(
  content: string,
  usedInferredCodeBlock: boolean
): string {
  let display = stripAllCompassActionsContent(content)
  if (usedInferredCodeBlock) {
    display = stripCodeBlocksByLanguage(display, ['css', 'html', 'javascript', 'typescript', 'tsx', 'jsx'])
  }
  return display.trim()
}
