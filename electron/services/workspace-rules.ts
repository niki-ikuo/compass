import { existsSync } from 'fs'
import { readFile } from 'fs/promises'
import { join } from 'path'
import { t } from '../../src/i18n/runtime'
import {
  CONTEXT_BUDGET,
  estimateTokens,
  truncateToTokenBudget
} from '../../src/utils/context-budget'
import { parseTermPairs, type TermPair } from '../../src/utils/markdown-outline'
import { parseWorkspaceInstructions } from '../../src/utils/workspace-instructions'
import { normalizeCustomRolePrompt } from '../../src/utils/system-prompt'
import { decodeFileBuffer } from './encoding'

export const WORKSPACE_INSTRUCTIONS_RELATIVE = '.compass/instructions.md'
export const WORKSPACE_RULES_RELATIVE = '.compass/rules.md'
export const WORKSPACE_GLOSSARY_RELATIVE = '.compass/glossary.md'
export const WORKSPACE_ROLE_RELATIVE = '.compass/role.md'

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

function formatTermPairsForAi(terms: TermPair[]): string {
  return terms
    .map((term) =>
      t('ai.workspaceTermLine', {
        preferred: term.preferred,
        avoids: term.avoid.map((alias) => `"${alias}"`).join(', ')
      })
    )
    .join('\n')
}

/**
 * instructions.md wins when present; otherwise legacy role.md + rules.md.
 * Terms section with parseable pairs wins; otherwise legacy glossary.md.
 * Empty role section → null so the caller keeps the built-in preset role.
 */
export async function loadWorkspaceInstructionLayers(workspaceRoot: string): Promise<{
  role: string | null
  rules: string | null
  terms: string | null
}> {
  const instructions = await readOptionalText(workspaceRoot, WORKSPACE_INSTRUCTIONS_RELATIVE)
  const glossary = await readOptionalText(workspaceRoot, WORKSPACE_GLOSSARY_RELATIVE)
  if (instructions) {
    const parsed = parseWorkspaceInstructions(instructions)
    const sectionHasPairs = Boolean(parsed.terms && parseTermPairs(parsed.terms).length > 0)
    return { ...parsed, terms: sectionHasPairs ? parsed.terms : glossary }
  }
  const [role, rules] = await Promise.all([
    readOptionalText(workspaceRoot, WORKSPACE_ROLE_RELATIVE),
    readOptionalText(workspaceRoot, WORKSPACE_RULES_RELATIVE)
  ])
  return { role, rules, terms: glossary }
}

export async function loadWorkspaceTermPairs(workspaceRoot: string): Promise<TermPair[]> {
  const { terms } = await loadWorkspaceInstructionLayers(workspaceRoot)
  if (!terms) return []
  return parseTermPairs(terms)
}

/**
 * Load the rules layer (+ compact term pairs) for Ask / Edit / Agent user context.
 */
export async function formatWorkspaceRulesForAi(
  workspaceRoot: string,
  maxTokens: number = CONTEXT_BUDGET.rulesTokens
): Promise<string | null> {
  if (maxTokens <= 0) return null

  const { rules, terms: termsText } = await loadWorkspaceInstructionLayers(workspaceRoot)
  const terms = termsText ? parseTermPairs(termsText) : []
  if (!rules && terms.length === 0) return null

  const sections: string[] = []
  let remaining = maxTokens

  if (rules) {
    const rulesBudget = terms.length > 0 ? Math.max(remaining - 200, 400) : remaining
    const section = formatSection(t('ai.workspaceRulesHeader'), rules, rulesBudget)
    sections.push(section)
    remaining -= estimateTokens(section)
  }

  if (terms.length > 0 && remaining > 40) {
    const section = formatSection(t('ai.workspaceTermsHeader'), formatTermPairsForAi(terms), remaining)
    sections.push(section)
  }

  if (sections.length === 0) return null
  return sections.join('\n\n')
}

/**
 * Load the role overlay for the system prompt.
 * Empty / missing → null so the caller keeps the built-in preset role.
 */
export async function loadWorkspaceRolePrompt(
  workspaceRoot: string,
  maxTokens: number = CONTEXT_BUDGET.roleTokens
): Promise<string | null> {
  if (maxTokens <= 0) return null
  const { role } = await loadWorkspaceInstructionLayers(workspaceRoot)
  return normalizeCustomRolePrompt(role, maxTokens, t('ai.contextTruncated'))
}
