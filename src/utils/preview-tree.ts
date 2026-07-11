import type { ActionPreviewItem, FileTreeNode } from '@/types'
function insertNode(tree: FileTreeNode[], node: FileTreeNode, workspaceRoot: string): FileTreeNode[] {
  const rel = node.path.replace(/\\/g, '/').replace(workspaceRoot.replace(/\\/g, '/'), '').replace(/^\//, '')
  const parts = rel.split('/').filter(Boolean)
  if (parts.length === 0) return tree

  const result = [...tree]
  let current = result
  let currentPath = workspaceRoot.replace(/\\/g, '/')

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]
    const isLast = i === parts.length - 1
    currentPath = `${currentPath}/${part}`.replace(/\\/g, '/')
    const existing = current.find((n) => n.name === part)

    if (existing) {
      if (isLast && !node.isDirectory) {
        existing.isPreview = node.isPreview
        existing.previewKind = node.previewKind
      } else if (existing.isDirectory && !isLast) {
        existing.children = existing.children ?? []
        current = existing.children
      }
    } else {
      const newNode: FileTreeNode = isLast
        ? { ...node, path: node.path.replace(/\\/g, '/') }
        : {
            name: part,
            path: currentPath,
            isDirectory: true,
            children: [],
            isPreview: node.isPreview,
            previewKind: 'new-folder' as const
          }
      current.push(newNode)
      if (!isLast) {
        newNode.children = newNode.children ?? []
        current = newNode.children
      }
    }
  }

  return result
}

function markModified(tree: FileTreeNode[], filePath: string): FileTreeNode[] {
  const normalized = filePath.replace(/\\/g, '/')
  return tree.map((node) => {
    if (node.path.replace(/\\/g, '/') === normalized) {
      return { ...node, isPreview: true, previewKind: 'modified' as const }
    }
    if (node.children) {
      return { ...node, children: markModified(node.children, filePath) }
    }
    return node
  })
}

function markDeleted(tree: FileTreeNode[], targetPath: string): FileTreeNode[] {
  const normalized = targetPath.replace(/\\/g, '/')
  return tree.map((node) => {
    const nodePath = node.path.replace(/\\/g, '/')
    if (nodePath === normalized || nodePath.startsWith(`${normalized}/`)) {
      return {
        ...node,
        isPreview: true,
        previewKind: 'deleted' as const,
        children: node.children ? markDeleted(node.children, targetPath) : node.children
      }
    }
    if (node.children) {
      return { ...node, children: markDeleted(node.children, targetPath) }
    }
    return node
  })
}

export function mergePreviewIntoTree(
  tree: FileTreeNode[],
  items: ActionPreviewItem[],
  workspaceRoot: string
): FileTreeNode[] {
  let merged = tree.map((n) => ({ ...n }))

  for (const item of items) {
    if (item.type === 'mkdir' && !item.alreadyExists) {
      const node: FileTreeNode = {
        name: item.relativePath.split('/').pop() ?? item.relativePath,
        path: item.path.replace(/\\/g, '/'),
        isDirectory: true,
        children: [],
        isPreview: true,
        previewKind: 'new-folder'
      }
      merged = insertNode(merged, node, workspaceRoot.replace(/\\/g, '/'))
    }

    if (item.type === 'writeFile') {
      if (item.isNew) {
        const node: FileTreeNode = {
          name: item.relativePath.split('/').pop() ?? item.relativePath,
          path: item.path.replace(/\\/g, '/'),
          isDirectory: false,
          isPreview: true,
          previewKind: 'new-file'
        }
        merged = insertNode(merged, node, workspaceRoot.replace(/\\/g, '/'))
      } else {
        merged = markModified(merged, item.path)
      }
    }

    if ((item.type === 'deleteFile' || item.type === 'deleteDir') && item.exists) {
      merged = markDeleted(merged, item.path)
    }
  }

  return merged
}

export function getPreviewPathSet(items: ActionPreviewItem[]): Set<string> {
  const paths = new Set<string>()
  for (const item of items) {
    paths.add(item.path.replace(/\\/g, '/'))
    if (item.type === 'mkdir') {
      paths.add(item.path.replace(/\\/g, '/'))
    }
  }
  return paths
}
