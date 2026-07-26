import { existsSync } from 'fs'
import { readFile } from 'fs/promises'
import { join } from 'path'
import { t } from '../../src/i18n/runtime'
import {
  CONTEXT_BUDGET,
  estimateTokens,
  truncateToTokenBudget
} from '../../src/utils/context-budget'
import { decodeFileBuffer } from './encoding'

export const WORKSPACE_RULES_RELATIVE = '.compass/rules.md'
export const WORKSPACE_GLOSSARY_RELATIVE = '.compass/glossary.md'

async function readOptionalText(workspaceRoot: string, relativePath: string): Promise<string | null> {
  const absolute = join(workspaceRoot, relativePath)
  if (!existsSync(absolute)) return null
  try {
    const buffer = await readFile(absolute)
    const content = decodeFileBuffer(buffer).content.trim()
    return content.length > 0 ? content : null
  } catch {
    return null
  }
}

function formatSection(header: string, body: string, maxTokens: number): string {
  const truncated = truncateToTokenBudget(body, maxTokens, t('ai.contextTruncated'))
  return `${header}\n${truncated}`
}

/**
 * Load `.compass/rules.md` (+ optional glossary) and format for Ask / Edit / Agent.
 * Honors a dedicated token budget so rules stay small relative to the rest of context.
 */
export async function formatWorkspaceRulesForAi(
  workspaceRoot: string,
  maxTokens: number = CONTEXT_BUDGET.rulesTokens
): Promise<string | null> {
  if (maxTokens <= 0) return null

  const rules = await readOptionalText(workspaceRoot, WORKSPACE_RULES_RELATIVE)
  const glossary = await readOptionalText(workspaceRoot, WORKSPACE_GLOSSARY_RELATIVE)
  if (!rules && !glossary) return null

  const sections: string[] = []
  let remaining = maxTokens

  if (rules) {
    // Prefer rules over glossary when the budget is tight.
    const rulesBudget = glossary ? Math.max(Math.floor(remaining * 0.7), 400) : remaining
    const section = formatSection(t('ai.workspaceRulesHeader'), rules, rulesBudget)
    sections.push(section)
    remaining -= estimateTokens(section)
  }

  if (glossary && remaining > 80) {
    const section = formatSection(t('ai.workspaceGlossaryHeader'), glossary, remaining)
    sections.push(section)
  }

  if (sections.length === 0) return null
  return sections.join('\n\n')
}
