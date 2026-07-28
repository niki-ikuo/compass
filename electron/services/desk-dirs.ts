import { mkdir } from 'fs/promises'
import { join } from 'path'

export const DESK_INBOX_DIR = '.compass/inbox'
export const DESK_INBOX_DONE_DIR = '.compass/inbox/done'
export const DESK_OUTBOX_DIR = '.compass/outbox'

export async function ensureDeskDirs(workspaceRoot: string): Promise<void> {
  const dirs = [
    join(workspaceRoot, '.compass', 'inbox', 'done'),
    join(workspaceRoot, '.compass', 'outbox')
  ]
  for (const dir of dirs) {
    await mkdir(dir, { recursive: true })
  }
}

export function inboxDir(workspaceRoot: string): string {
  return join(workspaceRoot, '.compass', 'inbox')
}

export function inboxDoneDir(workspaceRoot: string): string {
  return join(workspaceRoot, '.compass', 'inbox', 'done')
}

export function outboxDir(workspaceRoot: string): string {
  return join(workspaceRoot, '.compass', 'outbox')
}
