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

function stamp(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`
}

export function outboxRelativePath(preset: OutboxPreset): string {
  return `.compass/outbox/${preset}-${stamp()}.md`
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
  locale?: LocaleId
): DeskDraftRequest {
  const outPath = outboxRelativePath(preset)
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

export function buildDigestRequest(
  digestRelativePath: string,
  contextBlock: string,
  periodStart: string,
  periodEnd: string,
  locale?: LocaleId
): DeskDraftRequest {
  const text = [
    t('desk.digestPrompt.intro', { path: digestRelativePath }, locale),
    t('desk.digestPrompt.period', { start: periodStart, end: periodEnd }, locale),
    t('desk.digestPrompt.frontmatter', undefined, locale),
    t('desk.digestPrompt.sections', undefined, locale),
    t('desk.digestPrompt.footer', undefined, locale),
    '',
    t('desk.digestPrompt.contextHeader', undefined, locale),
    contextBlock
  ].join('\n')

  return {
    text,
    mode: 'edit',
    preset: 'document',
    contextRefs: []
  }
}
