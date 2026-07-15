import type { WorkspaceAction } from '@/types'
import { CODE_FENCE_REGEX, COMPASS_ACTIONS_REGEX, BARE_COMPASS_ACTIONS_REGEX } from './code-fence'
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
  COMPASS_ACTIONS_REGEX.lastIndex = 0
  return content.replace(COMPASS_ACTIONS_REGEX, '').trim()
}

export function stripAllCompassActionsContent(content: string): string {
  let result = stripCompassActionsBlocks(content)
  result = result.replace(BARE_COMPASS_ACTIONS_REGEX, '').trim()
  result = result.replace(/```\s*compass-actions\s*\n?[\s\S]*$/i, '').trim()
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
  COMPASS_ACTIONS_REGEX.lastIndex = 0
  const fenced = COMPASS_ACTIONS_REGEX.exec(content)
  if (fenced) {
    return parseActionsJson(fenced[1])
  }

  const bare = content.match(BARE_COMPASS_ACTIONS_REGEX)
  if (bare) {
    return parseActionsJson(bare[1])
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

export function toWorkspaceRelativePath(workspaceRoot: string, filePath: string): string {
  const root = workspaceRoot.replace(/\\/g, '/').replace(/\/$/, '')
  const normalized = filePath.replace(/\\/g, '/')
  if (normalized.startsWith(`${root}/`)) {
    return normalized.slice(root.length + 1)
  }
  return normalized.split('/').pop() ?? normalized
}

export function normalizeWorkspaceActionPath(workspaceRoot: string, actionPath: string): string {
  let relative = actionPath.replace(/\\/g, '/').replace(/^\.\//, '')
  const rootBase = workspaceRoot.replace(/\\/g, '/').split('/').filter(Boolean).pop()

  if (rootBase && (relative === rootBase || relative.startsWith(`${rootBase}/`))) {
    relative = relative === rootBase ? '' : relative.slice(rootBase.length + 1)
  }

  return relative
}

export function normalizeWorkspaceActions(
  workspaceRoot: string,
  actions: WorkspaceAction[]
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
        return { ...action, path: normalizeWorkspaceActionPath(workspaceRoot, action.path) }
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
    return normalizeWorkspaceActionPath(workspaceRoot, toWorkspaceRelativePath(workspaceRoot, activeFilePath))
  }

  const backtickMatch = content.match(/`([^`]+\.(?:css|html|js|ts|tsx|jsx|json|md))`/i)
  if (backtickMatch) {
    return normalizeWorkspaceActionPath(workspaceRoot, backtickMatch[1])
  }

  const pathMatch = content.match(
    /(?:^|[\s(「『])([\w./-]+\.(?:css|html|js|ts|tsx|jsx|json|md))(?:$|[\s)」』。、])/im
  )
  if (pathMatch) {
    return normalizeWorkspaceActionPath(workspaceRoot, pathMatch[1])
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
