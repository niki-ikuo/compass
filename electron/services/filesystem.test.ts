import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { afterEach, describe, expect, it } from 'vitest'
import {
  applyWorkspaceActions,
  createDirectory,
  createFile,
  deletePath,
  importFilesToWorkspace,
  materializeWorkspaceActions,
  movePath,
  previewWorkspaceActions,
  renamePath,
  resolveChatContext,
  resolveInsideWorkspace
} from './filesystem'

function makeTempRoot(name: string): string {
  const root = join(
    tmpdir(),
    `compass-fs-${name}-${Date.now()}-${Math.random().toString(36).slice(2)}`
  )
  mkdirSync(root, { recursive: true })
  return root
}

const tempRoots: string[] = []

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe('resolveInsideWorkspace', () => {
  it('resolves relative paths inside the workspace', () => {
    const root = makeTempRoot('resolve-ok')
    tempRoots.push(root)
    expect(resolveInsideWorkspace(root, 'src/a.ts')).toBe(join(root, 'src', 'a.ts'))
    expect(resolveInsideWorkspace(root, './notes/x.md')).toBe(join(root, 'notes', 'x.md'))
  })

  it('allows workspace root when allowRoot is set', () => {
    const root = makeTempRoot('resolve-root')
    tempRoots.push(root)
    expect(resolveInsideWorkspace(root, '.', { allowRoot: true })).toBe(join(root))
    expect(resolveInsideWorkspace(root, '', { allowRoot: true })).toBe(join(root))
  })

  it('rejects workspace root without allowRoot', () => {
    const root = makeTempRoot('resolve-deny-root')
    tempRoots.push(root)
    expect(() => resolveInsideWorkspace(root, '.')).toThrow(/outside the workspace/i)
    expect(() => resolveInsideWorkspace(root, '')).toThrow(/outside the workspace/i)
  })

  it('rejects path traversal and absolute escapes', () => {
    const root = makeTempRoot('resolve-escape')
    tempRoots.push(root)
    expect(() => resolveInsideWorkspace(root, '../outside.txt')).toThrow(/outside the workspace/i)
    expect(() => resolveInsideWorkspace(root, 'a/../../outside.txt')).toThrow(
      /outside the workspace/i
    )
    expect(() => resolveInsideWorkspace(root, join(root, '..', 'escape.txt'))).toThrow(
      /outside the workspace/i
    )
  })
})

describe('materializeWorkspaceActions / preview / apply', () => {
  it('materializes applyPatch into writeFile using disk contents', async () => {
    const root = makeTempRoot('patch')
    tempRoots.push(root)
    writeFileSync(join(root, 'note.md'), 'hello\n', 'utf-8')

    const materialized = await materializeWorkspaceActions(root, [
      {
        type: 'applyPatch',
        path: 'note.md',
        patch: [
          '--- a/note.md',
          '+++ b/note.md',
          '@@ -1,1 +1,1 @@',
          '-hello',
          '+hello world'
        ].join('\n')
      }
    ])

    expect(materialized).toEqual([
      { type: 'writeFile', path: 'note.md', content: 'hello world\n' }
    ])
  })

  it('previews and applies mkdir / writeFile / delete in order', async () => {
    const root = makeTempRoot('apply')
    tempRoots.push(root)
    writeFileSync(join(root, 'old.txt'), 'bye', 'utf-8')
    mkdirSync(join(root, 'tmp'), { recursive: true })
    writeFileSync(join(root, 'tmp', 'nested.txt'), 'x', 'utf-8')

    const actions = [
      { type: 'mkdir' as const, path: 'docs' },
      { type: 'writeFile' as const, path: 'docs/readme.md', content: '# Hi\n' },
      { type: 'deleteFile' as const, path: 'old.txt' },
      { type: 'deleteDir' as const, path: 'tmp' }
    ]

    const preview = await previewWorkspaceActions(root, actions)
    expect(preview.map((p) => p.type)).toEqual(['mkdir', 'writeFile', 'deleteFile', 'deleteDir'])
    expect(preview[1]).toMatchObject({
      type: 'writeFile',
      relativePath: 'docs/readme.md',
      isNew: true,
      newContent: '# Hi\n'
    })

    await applyWorkspaceActions(root, actions)
    expect(readFileSync(join(root, 'docs', 'readme.md'), 'utf-8')).toBe('# Hi\n')
    expect(() => readFileSync(join(root, 'old.txt'))).toThrow()
    expect(() => readFileSync(join(root, 'tmp', 'nested.txt'))).toThrow()
  })

  it('rejects deleteFile on a directory and deleteDir on a file', async () => {
    const root = makeTempRoot('delete-type')
    tempRoots.push(root)
    mkdirSync(join(root, 'folder'))
    writeFileSync(join(root, 'file.txt'), 'x', 'utf-8')

    await expect(
      applyWorkspaceActions(root, [{ type: 'deleteFile', path: 'folder' }])
    ).rejects.toThrow(/not a file/i)
    await expect(
      applyWorkspaceActions(root, [{ type: 'deleteDir', path: 'file.txt' }])
    ).rejects.toThrow(/not a folder/i)
  })
})

describe('filesystem CRUD helpers', () => {
  it('creates, renames, moves, and deletes files/folders', async () => {
    const root = makeTempRoot('crud')
    tempRoots.push(root)

    const filePath = await createFile(root, 'a.txt')
    expect(readFileSync(filePath, 'utf-8')).toBe('')

    const dirPath = await createDirectory(root, 'sub')
    const renamed = await renamePath(filePath, 'b.txt')
    expect(renamed).toBe(join(root, 'b.txt'))

    const moved = await movePath(renamed, dirPath)
    expect(moved).toBe(join(dirPath, 'b.txt'))
    expect(readFileSync(moved, 'utf-8')).toBe('')

    await deletePath(moved)
    await deletePath(dirPath)
    expect(() => readFileSync(moved)).toThrow()
  })

  it('rejects invalid names and moving a folder into itself', async () => {
    const root = makeTempRoot('crud-errors')
    tempRoots.push(root)
    const nested = await createDirectory(root, 'nested')

    await expect(createFile(root, 'bad/name.txt')).rejects.toThrow(/invalid/i)
    await expect(movePath(nested, nested)).rejects.toThrow(/into itself/i)
  })

  it('imports files with unique names', async () => {
    const root = makeTempRoot('import')
    const external = makeTempRoot('import-src')
    tempRoots.push(root, external)

    writeFileSync(join(external, 'photo.png'), 'img-a', 'utf-8')
    writeFileSync(join(root, 'photo.png'), 'existing', 'utf-8')

    const created = await importFilesToWorkspace(root, [join(external, 'photo.png')])
    expect(created).toHaveLength(1)
    expect(created[0]).toMatch(/photo \(2\)\.png$/)
    expect(readFileSync(created[0], 'utf-8')).toBe('img-a')
    expect(readFileSync(join(root, 'photo.png'), 'utf-8')).toBe('existing')
  })
})

describe('resolveChatContext', () => {
  it('loads text files, skips binary, and truncates large content', async () => {
    const root = makeTempRoot('context')
    tempRoots.push(root)
    writeFileSync(join(root, 'ok.md'), '# title\n', 'utf-8')
    writeFileSync(join(root, 'bin.dat'), Buffer.from([0x00, 0x01, 0x02, 0x03]))
    writeFileSync(join(root, 'big.txt'), 'x'.repeat(40 * 1024), 'utf-8')

    const resolved = await resolveChatContext(root, [
      { path: join(root, 'ok.md'), name: 'ok.md', isDirectory: false },
      { path: join(root, 'bin.dat'), name: 'bin.dat', isDirectory: false },
      { path: join(root, 'big.txt'), name: 'big.txt', isDirectory: false }
    ])

    expect(resolved.files).toHaveLength(2)
    expect(resolved.files[0]).toMatchObject({
      relativePath: 'ok.md',
      kind: 'text',
      content: '# title\n',
      truncated: false
    })
    expect(resolved.files[1]).toMatchObject({
      relativePath: 'big.txt',
      kind: 'text',
      truncated: true
    })
    expect(resolved.files[1].content.length).toBeLessThanOrEqual(32 * 1024)
  })

  it('lists folder structure and ignores node_modules', async () => {
    const root = makeTempRoot('folder-ctx')
    tempRoots.push(root)
    mkdirSync(join(root, 'src'), { recursive: true })
    mkdirSync(join(root, 'node_modules', 'pkg'), { recursive: true })
    writeFileSync(join(root, 'src', 'a.ts'), 'export {}\n', 'utf-8')
    writeFileSync(join(root, 'node_modules', 'pkg', 'index.js'), 'module.exports = {}\n', 'utf-8')

    const resolved = await resolveChatContext(root, [
      { path: root, name: 'folder-ctx', isDirectory: true }
    ])

    expect(resolved.folders).toHaveLength(1)
    expect(resolved.folders[0].structure).toEqual(['src/a.ts'])
    expect(resolved.folders[0].files.some((f) => f.relativePath === 'src/a.ts')).toBe(true)
  })
})
