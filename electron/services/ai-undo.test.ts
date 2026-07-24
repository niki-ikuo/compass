import { mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { afterEach, describe, expect, it } from 'vitest'
import {
  applyWorkspaceActionsRecordingUndo,
  listChangeSets,
  peekLastAppliedChangeSet,
  undoChangeSet,
  undoChatApplies,
  undoLastChangeSet
} from './ai-undo'

function makeTempRoot(name: string): string {
  const root = join(
    tmpdir(),
    `compass-ai-undo-${name}-${Date.now()}-${Math.random().toString(36).slice(2)}`
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

describe('ai apply undo', () => {
  it('undoes overwrite, create, deleteFile, mkdir, and deleteDir', async () => {
    const root = makeTempRoot('full')
    tempRoots.push(root)
    writeFileSync(join(root, 'old.txt'), 'before', 'utf-8')
    writeFileSync(join(root, 'keep.txt'), 'stay', 'utf-8')
    mkdirSync(join(root, 'tmp'), { recursive: true })
    writeFileSync(join(root, 'tmp', 'nested.txt'), 'x', 'utf-8')

    const result = await applyWorkspaceActionsRecordingUndo(
      root,
      [
        { type: 'mkdir', path: 'docs' },
        { type: 'writeFile', path: 'docs/readme.md', content: '# Hi\n' },
        { type: 'writeFile', path: 'keep.txt', content: 'changed' },
        { type: 'deleteFile', path: 'old.txt' },
        { type: 'deleteDir', path: 'tmp' }
      ],
      { undo: { chatId: 'chat-1', source: 'preview-all' } }
    )

    expect(result.changeSet?.entries.length).toBeGreaterThan(0)
    expect(readFileSync(join(root, 'docs', 'readme.md'), 'utf-8')).toBe('# Hi\n')
    expect(readFileSync(join(root, 'keep.txt'), 'utf-8')).toBe('changed')
    expect(existsSync(join(root, 'old.txt'))).toBe(false)
    expect(existsSync(join(root, 'tmp'))).toBe(false)

    await undoLastChangeSet(root)

    expect(existsSync(join(root, 'docs', 'readme.md'))).toBe(false)
    expect(existsSync(join(root, 'docs'))).toBe(false)
    expect(readFileSync(join(root, 'keep.txt'), 'utf-8')).toBe('stay')
    expect(readFileSync(join(root, 'old.txt'), 'utf-8')).toBe('before')
    expect(readFileSync(join(root, 'tmp', 'nested.txt'), 'utf-8')).toBe('x')
    expect(await peekLastAppliedChangeSet(root)).toBeNull()
  })

  it('undoes last apply only (LIFO across chats)', async () => {
    const root = makeTempRoot('lifo')
    tempRoots.push(root)
    writeFileSync(join(root, 'a.txt'), 'A0', 'utf-8')
    writeFileSync(join(root, 'b.txt'), 'B0', 'utf-8')

    await applyWorkspaceActionsRecordingUndo(
      root,
      [{ type: 'writeFile', path: 'a.txt', content: 'A1' }],
      { undo: { chatId: 'chat-a', source: 'preview-file' } }
    )
    await applyWorkspaceActionsRecordingUndo(
      root,
      [{ type: 'writeFile', path: 'b.txt', content: 'B1' }],
      { undo: { chatId: 'chat-b', source: 'preview-file' } }
    )

    await undoLastChangeSet(root)
    expect(readFileSync(join(root, 'a.txt'), 'utf-8')).toBe('A1')
    expect(readFileSync(join(root, 'b.txt'), 'utf-8')).toBe('B0')

    await undoLastChangeSet(root)
    expect(readFileSync(join(root, 'a.txt'), 'utf-8')).toBe('A0')
  })

  it('rejects stale undo after manual edit', async () => {
    const root = makeTempRoot('stale')
    tempRoots.push(root)
    writeFileSync(join(root, 'note.md'), 'v1', 'utf-8')

    await applyWorkspaceActionsRecordingUndo(
      root,
      [{ type: 'writeFile', path: 'note.md', content: 'v2' }],
      { undo: { chatId: 'c', source: 'preview-all' } }
    )
    writeFileSync(join(root, 'note.md'), 'v3', 'utf-8')

    await expect(undoLastChangeSet(root)).rejects.toThrow(/changed after apply|適用後に変更/i)
    expect(readFileSync(join(root, 'note.md'), 'utf-8')).toBe('v3')
  })

  it('does not record a change set without undo options', async () => {
    const root = makeTempRoot('no-meta')
    tempRoots.push(root)

    const result = await applyWorkspaceActionsRecordingUndo(root, [
      { type: 'writeFile', path: 'x.txt', content: 'x' }
    ])
    expect(result.changeSet).toBeUndefined()
    expect(await peekLastAppliedChangeSet(root)).toBeNull()
  })

  it('survives process restart via .compass/ai-undo index', async () => {
    const root = makeTempRoot('persist')
    tempRoots.push(root)
    writeFileSync(join(root, 'keep.txt'), 'live', 'utf-8')

    await applyWorkspaceActionsRecordingUndo(
      root,
      [{ type: 'deleteFile', path: 'keep.txt' }],
      { undo: { chatId: 'c', source: 'preview-all' } }
    )
    expect(existsSync(join(root, 'keep.txt'))).toBe(false)
    expect(existsSync(join(root, '.compass', 'ai-undo', 'index.json'))).toBe(true)

    await undoLastChangeSet(root)
    expect(readFileSync(join(root, 'keep.txt'), 'utf-8')).toBe('live')
  })

  it('undoChangeSet rejects when not the latest applied', async () => {
    const root = makeTempRoot('not-latest')
    tempRoots.push(root)
    writeFileSync(join(root, 'a.txt'), 'A0', 'utf-8')
    writeFileSync(join(root, 'b.txt'), 'B0', 'utf-8')

    const first = await applyWorkspaceActionsRecordingUndo(
      root,
      [{ type: 'writeFile', path: 'a.txt', content: 'A1' }],
      { undo: { chatId: 'chat-a', source: 'preview-file' } }
    )
    await applyWorkspaceActionsRecordingUndo(
      root,
      [{ type: 'writeFile', path: 'b.txt', content: 'B1' }],
      { undo: { chatId: 'chat-b', source: 'preview-file' } }
    )

    await expect(undoChangeSet(root, first.changeSet!.id)).rejects.toThrow(
      /newer apply|より新しい適用/i
    )
    expect(readFileSync(join(root, 'a.txt'), 'utf-8')).toBe('A1')
    expect(readFileSync(join(root, 'b.txt'), 'utf-8')).toBe('B1')
  })

  it('undoChatApplies undoes tip applies for one chat and stops on another chat', async () => {
    const root = makeTempRoot('chat-undo')
    tempRoots.push(root)
    writeFileSync(join(root, 'a.txt'), 'A0', 'utf-8')
    writeFileSync(join(root, 'b.txt'), 'B0', 'utf-8')
    writeFileSync(join(root, 'c.txt'), 'C0', 'utf-8')

    await applyWorkspaceActionsRecordingUndo(
      root,
      [{ type: 'writeFile', path: 'a.txt', content: 'A1' }],
      { undo: { chatId: 'chat-a', source: 'preview-file' } }
    )
    await applyWorkspaceActionsRecordingUndo(
      root,
      [{ type: 'writeFile', path: 'b.txt', content: 'B1' }],
      { undo: { chatId: 'chat-a', source: 'preview-file' } }
    )
    await applyWorkspaceActionsRecordingUndo(
      root,
      [{ type: 'writeFile', path: 'c.txt', content: 'C1' }],
      { undo: { chatId: 'chat-b', source: 'preview-file' } }
    )

    const blocked = await undoChatApplies(root, 'chat-a')
    expect(blocked.undone).toHaveLength(0)
    expect(blocked.stoppedReason).toBe('blocked_other_chat')

    const undidB = await undoChatApplies(root, 'chat-b')
    expect(undidB.undone).toHaveLength(1)
    expect(readFileSync(join(root, 'c.txt'), 'utf-8')).toBe('C0')

    const undidA = await undoChatApplies(root, 'chat-a')
    expect(undidA.undone).toHaveLength(2)
    expect(readFileSync(join(root, 'a.txt'), 'utf-8')).toBe('A0')
    expect(readFileSync(join(root, 'b.txt'), 'utf-8')).toBe('B0')
  })

  it('lists change sets newest first', async () => {
    const root = makeTempRoot('list')
    tempRoots.push(root)
    writeFileSync(join(root, 'a.txt'), 'A0', 'utf-8')

    await applyWorkspaceActionsRecordingUndo(
      root,
      [{ type: 'writeFile', path: 'a.txt', content: 'A1' }],
      { undo: { chatId: 'c1', source: 'preview-all' } }
    )
    await applyWorkspaceActionsRecordingUndo(
      root,
      [{ type: 'writeFile', path: 'a.txt', content: 'A2' }],
      { undo: { chatId: 'c2', source: 'preview-all' } }
    )

    const listed = await listChangeSets(root)
    expect(listed).toHaveLength(2)
    expect(listed[0].chatId).toBe('c2')
    expect(listed[0].status).toBe('applied')
    expect(listed[1].chatId).toBe('c1')
  })
})
