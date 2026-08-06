import { getLocale, t } from '@/i18n'
import { join } from '@/utils/path'
import { openWorkspaceFile } from '@/utils/open-workspace-file'
import { useAppStore } from '@/stores/app-store'
import { focusMonacoEditor } from '@/utils/workbench-focus'

export const WORKSPACE_RULES_RELATIVE = '.compass/rules.md'
export const WORKSPACE_GLOSSARY_RELATIVE = '.compass/glossary.md'

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/')
}

export function buildDefaultRulesMarkdown(locale: 'ja' | 'en' = getLocale()): string {
  if (locale === 'ja') {
    return [
      '# ワークスペースルール',
      '',
      'このフォルダで Ask / Edit / Agent が自動的に参照します。短く具体的に書いてください。',
      '',
      '## トーン',
      '',
      '- （例）丁寧で簡潔に。断定しすぎない',
      '',
      '## 用語・表記',
      '',
      '- （例）製品名は「Compass」と表記する',
      '- 詳細な避けたい表記は `.compass/glossary.md` にも書けます',
      '',
      '## やってほしくないこと',
      '',
      '- （例）見出し階層を勝手に変えない',
      ''
    ].join('\n')
  }

  return [
    '# Workspace rules',
    '',
    'Ask / Edit / Agent automatically attach this file. Keep it short and concrete.',
    '',
    '## Tone',
    '',
    '- (e.g.) Polite and concise; avoid over-asserting',
    '',
    '## Terms & spelling',
    '',
    '- (e.g.) Product name is “Compass”',
    '- Prefer `.compass/glossary.md` for avoid/prefer term pairs',
    '',
    '## Do not',
    '',
    '- (e.g.) Do not change heading hierarchy without asking',
    ''
  ].join('\n')
}

export function buildDefaultGlossaryMarkdown(locale: 'ja' | 'en' = getLocale()): string {
  if (locale === 'ja') {
    return [
      '# 用語集',
      '',
      '1行に「推奨 | 避けたい表記」を書きます（カンマ区切りで複数可）。',
      '文書モードの verify と、AI コンテキストの両方で使われます。',
      '',
      'API Key | apikey, APIキー',
      ''
    ].join('\n')
  }

  return [
    '# Glossary',
    '',
    'One line per term: `preferred | avoid1, avoid2`.',
    'Used by document verify and attached to AI context when present.',
    '',
    'API Key | apikey',
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

async function openOrCreateRelativeFile(
  workspaceRoot: string,
  relativePath: string,
  starter: string
): Promise<void> {
  const absolute = normalizePath(join(workspaceRoot, relativePath))
  const store = useAppStore.getState()
  const existing = store.openFiles.find((f) => normalizePath(f.path) === absolute)
  if (existing) {
    store.setActiveFile(existing.path)
    focusMonacoEditor()
    return
  }

  try {
    const opened = await window.compass.fs.openEditorFile(absolute)
    if (opened.kind === 'text') {
      store.openFile(absolute, opened.content, opened.encoding)
      focusMonacoEditor()
      return
    }
  } catch {
    // Missing — create below.
  }

  await ensureCompassDir(workspaceRoot)
  await window.compass.fs.writeFile(absolute, starter)
  await openWorkspaceFile(absolute)
  focusMonacoEditor()
}

/** Open `.compass/rules.md`, creating a starter file if missing. */
export async function openOrCreateWorkspaceRules(workspaceRoot: string): Promise<void> {
  try {
    await openOrCreateRelativeFile(
      workspaceRoot,
      WORKSPACE_RULES_RELATIVE,
      buildDefaultRulesMarkdown()
    )
  } catch (err) {
    window.alert(err instanceof Error ? err.message : t('rules.openFailed'))
  }
}

/** Open `.compass/glossary.md`, creating a starter file if missing. */
export async function openOrCreateWorkspaceGlossary(workspaceRoot: string): Promise<void> {
  try {
    await openOrCreateRelativeFile(
      workspaceRoot,
      WORKSPACE_GLOSSARY_RELATIVE,
      buildDefaultGlossaryMarkdown()
    )
  } catch (err) {
    window.alert(err instanceof Error ? err.message : t('rules.openGlossaryFailed'))
  }
}
