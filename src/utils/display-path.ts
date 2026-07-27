import { toWorkspaceRelativePath } from './workspace-actions'

/** Default max visible characters for sidebar / narrow panels. */
export const UI_PATH_MAX_CHARS = 42

/** Slightly wider panels (editor preview header, action list). */
export const UI_PATH_MAX_CHARS_WIDE = 56

export function normalizeUiPath(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/{2,}/g, '/')
}

/**
 * Middle-truncate a path, keeping the filename (and trailing segments) readable.
 * Example: `src/components/features/editor/Foo.tsx` → `src/…/editor/Foo.tsx`
 */
export function truncateMiddlePath(
  path: string,
  maxChars: number = UI_PATH_MAX_CHARS
): string {
  const normalized = normalizeUiPath(path)
  if (maxChars <= 0) return ''
  if (normalized.length <= maxChars) return normalized

  const ellipsis = '…'
  const segments = normalized.split('/').filter((s) => s.length > 0)
  if (segments.length === 0) return normalized.slice(0, maxChars)

  const fileName = segments[segments.length - 1] ?? normalized

  const clampFile = (): string => {
    const withSlash = `${ellipsis}/${fileName}`
    if (withSlash.length <= maxChars) return withSlash
    const keep = maxChars - ellipsis.length
    return keep > 0 ? `${ellipsis}${fileName.slice(-keep)}` : ellipsis
  }

  if (segments.length === 1) return clampFile()

  const head = segments[0]!
  let best = clampFile()

  for (let take = 1; take <= segments.length - 1; take++) {
    const tail = segments.slice(segments.length - take).join('/')
    const hidden = segments.length - take
    const candidate =
      hidden <= 0 ? tail : hidden === 1 ? `${head}/${tail}` : `${head}/${ellipsis}/${tail}`

    if (candidate.length <= maxChars) {
      best = candidate
    } else {
      break
    }
  }

  return best
}

export type FormatUiPathOptions = {
  workspaceRoot?: string | null
  maxChars?: number
}

/**
 * UI label + hover title for a path.
 * Prefer workspace-relative; truncate the label; keep the full relative (or absolute) in title.
 */
export function formatUiPath(
  path: string,
  options?: FormatUiPathOptions
): { label: string; title: string } {
  const normalized = normalizeUiPath(path)
  const root = options?.workspaceRoot?.trim()
  const relative = root ? toWorkspaceRelativePath(root, path) || normalized : normalized
  const title = relative
  const label = truncateMiddlePath(relative, options?.maxChars ?? UI_PATH_MAX_CHARS)
  return { label, title }
}

/**
 * Comma-separated path list for history / summaries.
 */
export function formatUiPathList(
  paths: string[],
  options?: FormatUiPathOptions & { maxItems?: number }
): { label: string; title: string } {
  if (paths.length === 0) return { label: '—', title: '' }

  const maxItems = options?.maxItems ?? 4
  const maxChars = options?.maxChars ?? 36
  const titles = paths.map((p) => formatUiPath(p, { ...options, maxChars: 10_000 }).title)
  const labels = paths
    .slice(0, maxItems)
    .map((p) => formatUiPath(p, { ...options, maxChars }).label)

  let label = labels.join(', ')
  if (paths.length > maxItems) {
    label += `, +${paths.length - maxItems}`
  }
  return { label, title: titles.join(', ') }
}
