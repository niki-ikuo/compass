import { clipboard } from 'electron'
import { readFile } from 'fs/promises'
import { join } from 'path'
import {
  formatOutboxCopyPayload,
  runShipCheckStageA,
  type ShipCheckResult
} from '../../src/utils/desk-ship-check'
import { isUnderOutbox, markOutboxReadyAfterCopy } from './desk-outbox'
import { assertInsideWorkspace } from './path-guard'
import { t } from '../../src/i18n/runtime'

export async function runDeskShipCheck(
  workspaceRoot: string,
  absolutePath: string
): Promise<ShipCheckResult> {
  assertInsideWorkspace(workspaceRoot, absolutePath)
  if (!isUnderOutbox(workspaceRoot, absolutePath)) {
    throw new Error(t('desk.outbox.notOutbox'))
  }
  const raw = await readFile(absolutePath, 'utf-8')
  let glossaryText: string | undefined
  try {
    glossaryText = await readFile(join(workspaceRoot, '.compass', 'glossary.md'), 'utf-8')
  } catch {
    glossaryText = undefined
  }
  return runShipCheckStageA(raw, { glossaryText })
}

export async function copyOutboxPayload(
  workspaceRoot: string,
  absolutePath: string
): Promise<
  | { ok: true; payload: string; content: string; markedReady: boolean }
  | { ok: false; message: string }
> {
  try {
    assertInsideWorkspace(workspaceRoot, absolutePath)
    if (!isUnderOutbox(workspaceRoot, absolutePath)) {
      return { ok: false, message: t('desk.outbox.notOutbox') }
    }
    const raw = await readFile(absolutePath, 'utf-8')
    const payload = formatOutboxCopyPayload(raw)
    clipboard.writeText(payload)
    const marked = await markOutboxReadyAfterCopy(absolutePath)
    return {
      ok: true,
      payload,
      content: marked.content,
      markedReady: marked.changed
    }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : t('desk.ship.copyFailed')
    }
  }
}
