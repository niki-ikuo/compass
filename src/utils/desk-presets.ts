import { formatContextMention } from './chat-mentions'
import type { OutboxPreset } from './desk-frontmatter'
import type { ChatContextRef, ChatMode, UseCasePreset } from '@/types'
import { getFileName } from './language'
import { t, type MessageKey } from '@/i18n/runtime'
import type { LocaleId } from '@/i18n/types'

export type DeskDraftRequest = {
  text: string
  mode: ChatMode
  preset: UseCasePreset
  contextRefs: ChatContextRef[]
}

/** Paths allocated for in-flight draft prompts (file may not exist until Apply). */
const reservedOutboxBasenames = new Set<string>()

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

/** Local stamp: YYYYMMDD-HHMMSS (same grain as inbox capture). */
export function outboxStamp(d = new Date()): string {
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
}

function toBasename(nameOrPath: string): string {
  return nameOrPath.replace(/^.*[\\/]/, '')
}

/**
 * Allocate a unique outbox relative path.
 * Uses second precision; on collision appends `-2`, `-3`, … (inbox style).
 * Also reserves the name in-memory so consecutive “Create draft” before Apply
 * does not reuse the same path.
 */
export function outboxRelativePath(
  preset: OutboxPreset,
  occupiedBasenames: Iterable<string> = [],
  now = new Date()
): string {
  const stamp = outboxStamp(now)
  const taken = new Set<string>()
  for (const name of occupiedBasenames) {
    const base = toBasename(name)
    if (base) taken.add(base)
  }
  for (const name of reservedOutboxBasenames) {
    taken.add(name)
  }

  let basename = `${preset}-${stamp}.md`
  let i = 2
  while (taken.has(basename)) {
    basename = `${preset}-${stamp}-${i}.md`
    i += 1
  }
  reservedOutboxBasenames.add(basename)
  return `.compass/outbox/${basename}`
}

/** Vitest helper — do not use in product code. */
export function clearReservedOutboxPathsForTests(): void {
  reservedOutboxBasenames.clear()
}

export function outboxPresetLabelKey(preset: OutboxPreset): string {
  return `desk.preset.${preset}`
}

const SHAPE_KEYS: Record<OutboxPreset, MessageKey> = {
  mail: 'desk.draftPrompt.shape.mail',
  minutes: 'desk.draftPrompt.shape.minutes',
  report: 'desk.draftPrompt.shape.report',
  chat: 'desk.draftPrompt.shape.chat'
}

/**
 * Build Edit-mode chat request to create one outbox file via compass-actions.
 * Prompt language follows the UI locale (settings language).
 */
export function buildOutboxDraftRequest(
  absoluteSourcePath: string | null,
  workspaceRoot: string | null,
  preset: OutboxPreset,
  locale?: LocaleId,
  occupiedBasenames: Iterable<string> = []
): DeskDraftRequest {
  const outPath = outboxRelativePath(preset, occupiedBasenames)
  const contextRefs: ChatContextRef[] = []
  let mention = ''
  if (absoluteSourcePath) {
    mention = formatContextMention(absoluteSourcePath, false, workspaceRoot)
    contextRefs.push({
      path: absoluteSourcePath,
      name: getFileName(absoluteSourcePath),
      isDirectory: false
    })
  }

  const sourceLine = mention
    ? t('desk.draftPrompt.sourceWithFile', { mention }, locale)
    : t('desk.draftPrompt.sourceOpen', undefined, locale)

  const text = [
    t('desk.draftPrompt.intro', { path: outPath }, locale),
    sourceLine,
    t(SHAPE_KEYS[preset], undefined, locale),
    t('desk.draftPrompt.path', { path: outPath }, locale),
    t('desk.draftPrompt.footer', undefined, locale)
  ].join('\n')

  return {
    text,
    mode: 'edit',
    preset: 'document',
    contextRefs
  }
}
