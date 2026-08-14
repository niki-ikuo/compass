import type { FileEncoding } from '@/types'
import { getLocale, t } from '@/i18n'
import { join } from '@/utils/path'
import { openWorkspaceFile } from '@/utils/open-workspace-file'
import { useAppStore } from '@/stores/app-store'
import { focusMonacoEditor } from '@/utils/workbench-focus'
import {
  buildDefaultTermsHint,
  buildInstructionsMarkdownFromLegacy,
  defaultInstructionHeadings
} from '@/utils/workspace-instructions'

export const WORKSPACE_INSTRUCTIONS_RELATIVE = '.compass/instructions.md'
export const WORKSPACE_RULES_RELATIVE = '.compass/rules.md'
export const WORKSPACE_GLOSSARY_RELATIVE = '.compass/glossary.md'
export const WORKSPACE_ROLE_RELATIVE = '.compass/role.md'

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/')
}

export function buildDefaultInstructionsMarkdown(locale: 'ja' | 'en' = getLocale()): string {
  const headings = defaultInstructionHeadings(locale)
  if (locale === 'ja') {
    return [
      `# ${headings.role}`,
      '',
      '（例）あなたはこのフォルダの PM 担当です。計画と整理だけを行う。',
      'ソースコードは作らない・編集しない。',
      '',
      '空のままなら、用途プリセットの役割文を使います。Ask / Edit / Agent の動作制約は変わりません。',
      'API キーなどの秘密情報は書かないでください。',
      '',
      `# ${headings.rules}`,
      '',
      '- （例）丁寧で簡潔に。断定しすぎない',
      '- （例）計画書は docs/plans/ に置く',
      '- （例）見出し階層を勝手に変えない',
      '',
      `# ${headings.terms}`,
      '',
      buildDefaultTermsHint(locale),
      ''
    ].join('\n')
  }

  return [
    `# ${headings.role}`,
    '',
    '(e.g.) You are the PM for this folder. Plan and organize only.',
    'Do not create or edit source code.',
    '',
    'Leave this section empty to keep the use-case preset role. Ask / Edit / Agent constraints do not change.',
    'Do not put API keys or other secrets here.',
    '',
    `# ${headings.rules}`,
    '',
    '- (e.g.) Polite and concise; avoid over-asserting',
    '- (e.g.) Put plans in docs/plans/',
    '- (e.g.) Do not change heading hierarchy without asking',
    '',
    `# ${headings.terms}`,
    '',
    buildDefaultTermsHint(locale),
    ''
  ].join('\n')
}

async function ensureCompassDir(workspaceRoot: string): Promise<void> {
  try {
    await window.compass.fs.createDirectory(workspaceRoot, '.compass')
  } catch {
    // Already exists (or race); continue.
  }
}

async function readOptionalRelativeText(
  workspaceRoot: string,
  relativePath: string
): Promise<string | null> {
  const absolute = normalizePath(join(workspaceRoot, relativePath))
  try {
    const opened = await window.compass.fs.readFile(absolute)
    const content = opened.content.trim()
    return content.length > 0 ? opened.content : null
  } catch {
    return null
  }
}

async function focusExistingEditor(absolute: string): Promise<boolean> {
  const store = useAppStore.getState()
  const existing = store.openFiles.find((f) => normalizePath(f.path) === absolute)
  if (!existing) return false
  store.setActiveFile(existing.path)
  focusMonacoEditor()
  return true
}

/** Open `.compass/instructions.md`. Merge legacy role.md / rules.md / glossary.md on first create. */
export async function openOrCreateWorkspaceInstructions(workspaceRoot: string): Promise<void> {
  try {
    const absolute = normalizePath(join(workspaceRoot, WORKSPACE_INSTRUCTIONS_RELATIVE))
    if (await focusExistingEditor(absolute)) return

    try {
      const opened = await window.compass.fs.openEditorFile(absolute)
      if (opened.kind === 'text') {
        storeOpen(absolute, opened.content, opened.encoding)
        return
      }
    } catch {
      // Missing — migrate or create below.
    }

    const [role, rules, glossary] = await Promise.all([
      readOptionalRelativeText(workspaceRoot, WORKSPACE_ROLE_RELATIVE),
      readOptionalRelativeText(workspaceRoot, WORKSPACE_RULES_RELATIVE),
      readOptionalRelativeText(workspaceRoot, WORKSPACE_GLOSSARY_RELATIVE)
    ])
    const headings = defaultInstructionHeadings(getLocale())
    const merged = buildInstructionsMarkdownFromLegacy(role, rules, headings, glossary)
    const starter = merged ?? buildDefaultInstructionsMarkdown()

    await ensureCompassDir(workspaceRoot)
    await window.compass.fs.writeFile(absolute, starter)
    await openWorkspaceFile(absolute)
    focusMonacoEditor()
  } catch (err) {
    window.alert(err instanceof Error ? err.message : t('instructions.openFailed'))
  }
}

function storeOpen(absolute: string, content: string, encoding: FileEncoding): void {
  useAppStore.getState().openFile(absolute, content, encoding)
  focusMonacoEditor()
}
