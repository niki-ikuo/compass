import type { UseCasePreset } from '@/types'
import { normalizeUseCasePreset } from '@/types'
import { getLanguageFromPath } from '@/utils/language'
import { DEFAULT_USE_CASE_PRESET } from '@/utils/use-case-preset'

export type InlineCompletionStyle = 'code' | 'text'

/** Monaco languageId / 拡張子由来の言語でコード補完向きとみなすもの */
const CODE_LANGUAGES = new Set([
  'typescript',
  'javascript',
  'typescriptreact',
  'javascriptreact',
  'python',
  'java',
  'csharp',
  'c',
  'cpp',
  'go',
  'rust',
  'ruby',
  'php',
  'swift',
  'kotlin',
  'scala',
  'dart',
  'lua',
  'perl',
  'r',
  'shell',
  'bash',
  'powershell',
  'bat',
  'sql',
  'html',
  'css',
  'scss',
  'less',
  'xml',
  'json',
  'jsonc'
])

/** 明示的にテキスト／文書補完向き（plaintext は用途フォールバックへ） */
const TEXT_LANGUAGES = new Set([
  'markdown',
  'csv',
  'tsv',
  'yaml',
  'yml',
  'ini',
  'properties',
  'restructuredtext',
  'latex',
  'bibtex',
  'diff'
])

function normalizeLanguageId(language: string | undefined): string | undefined {
  if (!language) return undefined
  const id = language.trim().toLowerCase()
  return id || undefined
}

/**
 * インライン補完の system / intro 文言スタイルを決める。
 * 優先: 言語 → 拡張子 → 用途プリセット（code のみ code、それ以外は text）
 */
export function resolveInlineCompletionStyle(options: {
  language?: string | null
  filePath?: string | null
  useCasePreset?: UseCasePreset | null
}): InlineCompletionStyle {
  const language =
    normalizeLanguageId(options.language ?? undefined) ??
    (options.filePath ? getLanguageFromPath(options.filePath) : undefined)

  if (language && CODE_LANGUAGES.has(language)) return 'code'
  if (language && TEXT_LANGUAGES.has(language)) return 'text'

  if (language && language !== 'plaintext' && language !== 'text') {
    // 未知言語はコード寄り（プログラミング系の独自 id が多い）
    return 'code'
  }

  const preset = normalizeUseCasePreset(options.useCasePreset) ?? DEFAULT_USE_CASE_PRESET
  return preset === 'code' ? 'code' : 'text'
}
