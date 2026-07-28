import { clipboard } from 'electron'
import { readFile } from 'fs/promises'
import { join } from 'path'
import {
  formatOutboxCopyPayload,
  runShipCheckStageA,
  type ShipCheckResult
} from '../../src/utils/desk-ship-check'
import { markOutboxReadyAfterCopy } from './desk-outbox'
import { t } from '../../src/i18n/runtime'

export async function runDeskShipCheck(absolutePath: string): Promise<ShipCheckResult> {
  const raw = await readFile(absolutePath, 'utf-8')
  let glossaryText: string | undefined
  const match = absolutePath.replace(/\\/g, '/').match(/^(.*)\/\.compass\//)
  if (match) {
    try {
      glossaryText = await readFile(join(match[1], '.compass', 'glossary.md'), 'utf-8')
    } catch {
      glossaryText = undefined
    }
  }
  return runShipCheckStageA(raw, { glossaryText })
}

export async function copyOutboxPayload(
  absolutePath: string
): Promise<
  | { ok: true; payload: string; content: string; markedReady: boolean }
  | { ok: false; message: string }
> {
  try {
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
