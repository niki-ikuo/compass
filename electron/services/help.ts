import { existsSync } from 'fs'
import { readdir, readFile } from 'fs/promises'
import { app } from 'electron'
import { isAbsolute, join, relative, resolve, sep } from 'path'
import { DEFAULT_LOCALE, isLocaleId, type LocaleId } from '../../src/i18n/types'

export interface HelpDocMeta {
  id: string
  title: string
  keywords: string[]
  category: string
  related: string[]
  commands: string[]
}

export interface HelpDoc extends HelpDocMeta {
  body: string
}

export interface HelpSearchHit {
  id: string
  title: string
  score: number
  snippet: string
}

interface ParsedFrontmatter {
  title?: string
  keywords: string[]
  category?: string
  related: string[]
  commands: string[]
}

function resolveHelpBaseRoot(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, 'helps')
  }

  const candidates = [
    join(process.cwd(), 'helps'),
    join(__dirname, '../../helps'),
    join(app.getAppPath(), 'helps')
  ]
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate
  }
  return candidates[0]
}

export function normalizeHelpLocale(locale: unknown): LocaleId {
  return isLocaleId(locale) ? locale : DEFAULT_LOCALE
}

/** Locale folder under helps/ (e.g. helps/en). Falls back to the other locale, then flat root. */
export function resolveHelpRoot(locale?: unknown): string {
  const base = resolveHelpBaseRoot()
  const preferred = normalizeHelpLocale(locale)
  const preferredRoot = join(base, preferred)
  if (existsSync(preferredRoot)) return preferredRoot

  const fallback = preferred === 'ja' ? 'en' : 'ja'
  const fallbackRoot = join(base, fallback)
  if (existsSync(fallbackRoot)) return fallbackRoot

  return base
}

function assertInsideRoot(root: string, target: string): string {
  const resolvedRoot = resolve(root)
  const resolvedTarget = resolve(target)
  const rel = relative(resolvedRoot, resolvedTarget)
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error('Invalid help path')
  }
  return resolvedTarget
}

export function normalizeHelpId(id: string): string {
  return id.replace(/\\/g, '/').replace(/^\/+/, '').replace(/^\.\//, '')
}

export function resolveHelpId(fromId: string, href: string): string {
  const raw = href.split('#')[0]?.trim() ?? ''
  if (!raw) return normalizeHelpId(fromId)

  const from = normalizeHelpId(fromId)
  if (!raw.includes('/') && !raw.startsWith('.')) {
    const slash = from.lastIndexOf('/')
    const dir = slash >= 0 ? from.slice(0, slash + 1) : ''
    return normalizeHelpId(dir + raw)
  }

  const fromDir = from.includes('/') ? from.slice(0, from.lastIndexOf('/')) : ''
  const parts = [...(fromDir ? fromDir.split('/') : []), ...raw.split('/')]
  const stack: string[] = []
  for (const part of parts) {
    if (!part || part === '.') continue
    if (part === '..') {
      stack.pop()
      continue
    }
    stack.push(part)
  }
  return stack.join('/')
}

function parseStringList(block: string): string[] {
  const items: string[] = []
  for (const line of block.split(/\r?\n/)) {
    const match = line.match(/^\s*-\s+(.+?)\s*$/)
    if (match) items.push(match[1].replace(/^['"]|['"]$/g, ''))
  }
  return items
}

export function parseHelpFrontmatter(raw: string): { meta: ParsedFrontmatter; body: string } {
  const normalized = raw.replace(/^\uFEFF/, '')
  if (!normalized.startsWith('---')) {
    return {
      meta: { keywords: [], related: [], commands: [] },
      body: normalized
    }
  }

  const endMatch = normalized.match(/\r?\n---\r?\n/)
  if (!endMatch || endMatch.index === undefined) {
    return {
      meta: { keywords: [], related: [], commands: [] },
      body: normalized
    }
  }

  const fm = normalized.slice(3, endMatch.index).replace(/^\r?\n/, '')
  const body = normalized.slice(endMatch.index + endMatch[0].length).replace(/^\r?\n/, '')
  const meta: ParsedFrontmatter = { keywords: [], related: [], commands: [] }

  const titleMatch = fm.match(/^title:\s*(.+)$/m)
  if (titleMatch) meta.title = titleMatch[1].trim().replace(/^['"]|['"]$/g, '')

  const categoryMatch = fm.match(/^category:\s*(.+)$/m)
  if (categoryMatch) meta.category = categoryMatch[1].trim().replace(/^['"]|['"]$/g, '')

  const keywordsMatch = fm.match(/^keywords:\r?\n((?:\s*-\s+.+\r?\n?)*)/m)
  if (keywordsMatch) meta.keywords = parseStringList(keywordsMatch[1])

  const relatedMatch = fm.match(/^related:\r?\n((?:\s*-\s+.+\r?\n?)*)/m)
  if (relatedMatch) {
    meta.related = parseStringList(relatedMatch[1]).map((item) => item.replace(/\\/g, '/'))
  }

  const commandsMatch = fm.match(/^commands:\r?\n((?:\s*-\s+.+\r?\n?)*)/m)
  if (commandsMatch) meta.commands = parseStringList(commandsMatch[1])

  return { meta, body }
}

function titleFromBody(body: string, fallback: string): string {
  const heading = body.match(/^#\s+(.+)$/m)
  return heading?.[1]?.trim() || fallback
}

async function collectMarkdownFiles(dir: string, root: string, out: string[]): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      await collectMarkdownFiles(full, root, out)
      continue
    }
    if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
      out.push(relative(root, full).split(sep).join('/'))
    }
  }
}

export async function listHelpDocs(locale?: unknown): Promise<HelpDocMeta[]> {
  const root = resolveHelpRoot(locale)
  if (!existsSync(root)) return []

  const ids: string[] = []
  await collectMarkdownFiles(root, root, ids)
  ids.sort((a, b) => {
    if (a === 'index.md') return -1
    if (b === 'index.md') return 1
    return a.localeCompare(b)
  })

  const docs: HelpDocMeta[] = []
  for (const id of ids) {
    const doc = await getHelpDoc(id, locale)
    docs.push({
      id: doc.id,
      title: doc.title,
      keywords: doc.keywords,
      category: doc.category,
      related: doc.related,
      commands: doc.commands
    })
  }
  return docs
}

export async function getHelpDoc(id: string, locale?: unknown): Promise<HelpDoc> {
  const root = resolveHelpRoot(locale)
  const normalized = normalizeHelpId(id)
  if (!normalized.toLowerCase().endsWith('.md') || normalized.includes('\0')) {
    throw new Error('Invalid help path')
  }

  const full = assertInsideRoot(root, join(root, ...normalized.split('/')))
  const raw = await readFile(full, 'utf-8')
  const { meta, body } = parseHelpFrontmatter(raw)
  const fallbackTitle = normalized.replace(/\.md$/i, '').split('/').pop() || normalized

  return {
    id: normalized,
    title: meta.title || titleFromBody(body, fallbackTitle),
    keywords: meta.keywords,
    category: meta.category || '',
    related: meta.related.map((item) => resolveHelpId(normalized, item)),
    commands: meta.commands,
    body
  }
}

function makeSnippet(text: string, query: string): string {
  const lower = text.toLowerCase()
  const q = query.toLowerCase()
  const idx = lower.indexOf(q)
  if (idx < 0) {
    return text.slice(0, 120).replace(/\s+/g, ' ').trim()
  }
  const start = Math.max(0, idx - 40)
  const end = Math.min(text.length, idx + q.length + 60)
  const slice = text.slice(start, end).replace(/\s+/g, ' ').trim()
  return `${start > 0 ? '…' : ''}${slice}${end < text.length ? '…' : ''}`
}

export async function searchHelpDocs(
  query: string,
  locale?: unknown,
  limit = 30
): Promise<HelpSearchHit[]> {
  const q = query.trim().toLowerCase()
  if (!q) return []

  const docs = await listHelpDocs(locale)
  const hits: HelpSearchHit[] = []

  for (const meta of docs) {
    const doc = await getHelpDoc(meta.id, locale)
    let score = 0
    const titleLower = doc.title.toLowerCase()
    const idLower = doc.id.toLowerCase()
    const bodyLower = doc.body.toLowerCase()

    if (titleLower === q) score += 100
    else if (titleLower.includes(q)) score += 50

    if (idLower.includes(q)) score += 20

    for (const keyword of doc.keywords) {
      const k = keyword.toLowerCase()
      if (k === q) score += 40
      else if (k.includes(q) || q.includes(k)) score += 25
    }

    if (bodyLower.includes(q)) score += 10

    if (score <= 0) continue

    hits.push({
      id: doc.id,
      title: doc.title,
      score,
      snippet: makeSnippet(`${doc.title}\n${doc.keywords.join(' ')}\n${doc.body}`, q)
    })
  }

  hits.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title))
  return hits.slice(0, limit)
}
