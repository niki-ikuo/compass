import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAppStore } from '@/stores/app-store'
import { formatUiPath, UI_PATH_MAX_CHARS, UI_PATH_MAX_CHARS_WIDE } from '@/utils/display-path'
import { focusWithRetry } from '@/utils/focus-with-retry'
import { openWorkspaceFile } from '@/utils/open-workspace-file'
import type {
  GitBranchInfo,
  GitDiffResult,
  GitStatusEntry,
  GitStatusKind,
  GitStatusResult
} from '@/types'
import { useI18n, type MessageKey } from '@/i18n'

function toAbsolutePath(workspaceRoot: string, relativePath: string): string {
  const root = workspaceRoot.replace(/\\/g, '/').replace(/\/+$/, '')
  const rel = relativePath.replace(/\\/g, '/').replace(/^\.\//, '')
  return `${root}/${rel}`
}

function kindLabelKey(kind: GitStatusKind): MessageKey {
  switch (kind) {
    case 'modified':
      return 'git.kind.modified'
    case 'added':
      return 'git.kind.added'
    case 'deleted':
      return 'git.kind.deleted'
    case 'renamed':
      return 'git.kind.renamed'
    case 'copied':
      return 'git.kind.copied'
    case 'untracked':
      return 'git.kind.untracked'
    case 'ignored':
      return 'git.kind.ignored'
    case 'conflict':
      return 'git.kind.conflict'
    default:
      return 'git.kind.modified'
  }
}

function kindBadge(kind: GitStatusKind): string {
  switch (kind) {
    case 'modified':
      return 'M'
    case 'added':
      return 'A'
    case 'deleted':
      return 'D'
    case 'renamed':
      return 'R'
    case 'copied':
      return 'C'
    case 'untracked':
      return 'U'
    case 'ignored':
      return '!'
    case 'conflict':
      return '!'
    default:
      return 'M'
  }
}

function parsePatchLines(patch: string): Array<{ type: 'add' | 'remove' | 'context' | 'meta'; text: string }> {
  if (!patch.trim()) return []
  return patch.split('\n').map((line) => {
    if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('diff ') || line.startsWith('index ') || line.startsWith('new file') || line.startsWith('deleted file') || line.startsWith('@@')) {
      return { type: 'meta' as const, text: line }
    }
    if (line.startsWith('+')) return { type: 'add' as const, text: line.slice(1) }
    if (line.startsWith('-')) return { type: 'remove' as const, text: line.slice(1) }
    if (line.startsWith(' ')) return { type: 'context' as const, text: line.slice(1) }
    return { type: 'meta' as const, text: line }
  })
}

function FileRow({
  entry,
  selected,
  onSelect,
  onStage,
  onUnstage,
  onDiscard,
  onOpen
}: {
  entry: GitStatusEntry
  selected: boolean
  onSelect: () => void
  onStage?: () => void
  onUnstage?: () => void
  onDiscard?: () => void
  onOpen: () => void
}) {
  const { t } = useI18n()
  const pathDisplay = entry.originalPath
    ? (() => {
        const from = formatUiPath(entry.originalPath, { maxChars: UI_PATH_MAX_CHARS })
        const to = formatUiPath(entry.path, { maxChars: UI_PATH_MAX_CHARS })
        return {
          label: `${from.label} → ${to.label}`,
          title: `${from.title} → ${to.title}`
        }
      })()
    : formatUiPath(entry.path, { maxChars: UI_PATH_MAX_CHARS })

  return (
    <div className={`git-file-row${selected ? ' selected' : ''}`}>
      <button
        type="button"
        className="git-file-main"
        onClick={onSelect}
        onDoubleClick={onOpen}
        title={`${t(kindLabelKey(entry.kind))}: ${pathDisplay.title}`}
      >
        <span className={`git-file-badge git-kind-${entry.kind}`} aria-hidden>
          {kindBadge(entry.kind)}
        </span>
        <span className="git-file-path" title={pathDisplay.title}>
          {pathDisplay.label}
        </span>
      </button>
      <div className="git-file-actions">
        {onStage && (
          <button type="button" className="git-file-action" onClick={onStage} title={t('git.stage')}>
            +
          </button>
        )}
        {onUnstage && (
          <button
            type="button"
            className="git-file-action"
            onClick={onUnstage}
            title={t('git.unstage')}
          >
            −
          </button>
        )}
        {onDiscard && (
          <button
            type="button"
            className="git-file-action git-file-action-danger"
            onClick={onDiscard}
            title={t('git.discard')}
          >
            ×
          </button>
        )}
      </div>
    </div>
  )
}

export function GitPanel() {
  const { t } = useI18n()
  const workspaceRoot = useAppStore((s) => s.workspaceRoot)
  const leftSidebarView = useAppStore((s) => s.leftSidebarView)
  const sidebarFocusRequest = useAppStore((s) => s.sidebarFocusRequest)
  const clearSidebarFocusRequest = useAppStore((s) => s.clearSidebarFocusRequest)

  const [status, setStatus] = useState<GitStatusResult | null>(null)
  const [branches, setBranches] = useState<GitBranchInfo[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [diff, setDiff] = useState<GitDiffResult | null>(null)
  const [diffLoading, setDiffLoading] = useState(false)
  const [commitMessage, setCommitMessage] = useState('')
  const [committing, setCommitting] = useState(false)
  const [busyPaths, setBusyPaths] = useState(false)
  const [remoteBusy, setRemoteBusy] = useState(false)
  const [branchBusy, setBranchBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const refreshToken = useRef(0)
  const panelRef = useRef<HTMLDivElement>(null)
  const commitInputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (!sidebarFocusRequest || sidebarFocusRequest.view !== 'git') return
    // Wait until status has settled so the commit box (or fallback controls) exist.
    if (status === null && loading) return
    const requestId = sidebarFocusRequest.id
    focusWithRetry(
      () =>
        commitInputRef.current ??
        panelRef.current?.querySelector<HTMLElement>(
          'select:not([disabled]), textarea:not([disabled]), input:not([disabled]):not([type="hidden"]), button:not([disabled])'
        )
    )
    const clearTimer = window.setTimeout(() => {
      if (useAppStore.getState().sidebarFocusRequest?.id === requestId) {
        clearSidebarFocusRequest()
      }
    }, 60)
    return () => clearTimeout(clearTimer)
  }, [sidebarFocusRequest, status, loading, clearSidebarFocusRequest])

  const refreshBranches = useCallback(async (): Promise<void> => {
    if (!workspaceRoot) {
      setBranches([])
      return
    }
    try {
      const next = await window.compass.git.branches(workspaceRoot)
      setBranches(next.branches)
    } catch {
      // Status panel still works without the branch list
      setBranches([])
    }
  }, [workspaceRoot])

  const refresh = useCallback(async (options?: { fetch?: boolean }) => {
    if (!workspaceRoot) {
      setStatus(null)
      setError(null)
      setBranches([])
      return
    }
    const token = ++refreshToken.current
    setLoading(true)
    setError(null)
    try {
      const next = await window.compass.git.status(workspaceRoot, options)
      if (token !== refreshToken.current) return
      setStatus(next)
      if (next.error) {
        setError(next.error)
      }
      if (next.isRepo) {
        await refreshBranches()
      } else {
        setBranches([])
      }
    } catch (err) {
      if (token !== refreshToken.current) return
      setError(err instanceof Error ? err.message : String(err))
      setStatus(null)
      setBranches([])
    } finally {
      if (token === refreshToken.current) setLoading(false)
    }
  }, [workspaceRoot, refreshBranches])

  useEffect(() => {
    if (leftSidebarView !== 'git') return
    void refresh()
  }, [leftSidebarView, refresh, workspaceRoot])

  useEffect(() => {
    if (leftSidebarView !== 'git' || !workspaceRoot) return
    const onFocus = (): void => {
      void refresh()
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [leftSidebarView, workspaceRoot, refresh])

  const staged = useMemo(
    () => status?.entries.filter((e) => e.staged) ?? [],
    [status]
  )
  const unstagedTracked = useMemo(
    () => status?.entries.filter((e) => e.unstaged && e.kind !== 'untracked') ?? [],
    [status]
  )
  const untracked = useMemo(
    () => status?.entries.filter((e) => e.kind === 'untracked') ?? [],
    [status]
  )
  // Partially staged files appear in both staged and unstaged lists
  const changes = useMemo(() => {
    const seen = new Set<string>()
    const list: GitStatusEntry[] = []
    for (const e of [...unstagedTracked, ...untracked]) {
      if (seen.has(e.path)) continue
      seen.add(e.path)
      list.push(e)
    }
    return list
  }, [unstagedTracked, untracked])

  const loadDiff = useCallback(
    async (path: string, preferStaged: boolean) => {
      if (!workspaceRoot) return
      setSelectedPath(path)
      setDiffLoading(true)
      setDiff(null)
      try {
        const side = preferStaged ? 'staged' : 'auto'
        const next = await window.compass.git.diff(workspaceRoot, path, side)
        setDiff(next)
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setDiffLoading(false)
      }
    },
    [workspaceRoot]
  )

  const openPath = useCallback(
    async (rel: string) => {
      if (!workspaceRoot) return
      await openWorkspaceFile(toAbsolutePath(workspaceRoot, rel))
    },
    [workspaceRoot]
  )

  const runStage = async (paths: string[], unstage = false): Promise<void> => {
    if (!workspaceRoot || paths.length === 0) return
    setBusyPaths(true)
    setError(null)
    try {
      if (unstage) {
        await window.compass.git.unstage(workspaceRoot, paths)
      } else {
        await window.compass.git.stage(workspaceRoot, paths)
      }
      await refresh()
      if (selectedPath && paths.includes(selectedPath)) {
        await loadDiff(selectedPath, !unstage)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusyPaths(false)
    }
  }

  const runDiscard = async (entries: GitStatusEntry[]): Promise<void> => {
    if (!workspaceRoot || entries.length === 0) return

    const paths = entries.map((e) => e.path)
    let confirmed = false
    if (entries.length === 1) {
      const entry = entries[0]
      const pathLabel = formatUiPath(entry.path, { maxChars: UI_PATH_MAX_CHARS_WIDE }).label
      confirmed = window.confirm(
        entry.untracked
          ? t('git.discardUntrackedConfirm', { path: pathLabel })
          : t('git.discardConfirm', { path: pathLabel })
      )
    } else {
      confirmed = window.confirm(t('git.discardAllConfirm', { count: String(entries.length) }))
    }
    if (!confirmed) return

    setBusyPaths(true)
    setError(null)
    setNotice(null)
    try {
      await window.compass.git.discard(workspaceRoot, paths)
      if (selectedPath && paths.includes(selectedPath)) {
        setSelectedPath(null)
        setDiff(null)
      }
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusyPaths(false)
    }
  }

  const handleCommit = async (): Promise<void> => {
    if (!workspaceRoot) return
    const message = commitMessage.trim()
    if (!message) {
      setError(t('git.emptyMessage'))
      return
    }
    setCommitting(true)
    setError(null)
    setNotice(null)
    try {
      const result = await window.compass.git.commit(workspaceRoot, message)
      setCommitMessage('')
      setNotice(t('git.commitSuccess', { hash: result.hash || 'ok' }))
      setDiff(null)
      setSelectedPath(null)
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setCommitting(false)
    }
  }

  const handlePush = async (): Promise<void> => {
    if (!workspaceRoot) return
    setRemoteBusy(true)
    setError(null)
    setNotice(null)
    try {
      const result = await window.compass.git.push(workspaceRoot)
      setNotice(result.summary || t('git.pushSuccess'))
      await refresh({ fetch: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setRemoteBusy(false)
    }
  }

  const handlePull = async (): Promise<void> => {
    if (!workspaceRoot) return
    setRemoteBusy(true)
    setError(null)
    setNotice(null)
    try {
      const result = await window.compass.git.pull(workspaceRoot)
      setNotice(result.summary || t('git.pullSuccess'))
      await refresh({ fetch: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setRemoteBusy(false)
    }
  }

  const handleCheckout = async (branch: string): Promise<void> => {
    if (!workspaceRoot || !branch) return
    if (branch === status?.branch) return
    setBranchBusy(true)
    setError(null)
    setNotice(null)
    try {
      const result = await window.compass.git.checkout(workspaceRoot, branch)
      setNotice(t('git.checkoutSuccess', { branch: result.branch }))
      setDiff(null)
      setSelectedPath(null)
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBranchBusy(false)
    }
  }

  const panelBusy = loading || busyPaths || committing || remoteBusy || branchBusy
  const branchOptions = useMemo(() => {
    if (branches.length > 0) {
      const names = new Set(branches.map((b) => b.name))
      if (status?.branch && status.branch !== 'HEAD' && !names.has(status.branch)) {
        return [{ name: status.branch, current: true }, ...branches]
      }
      return branches
    }
    if (status?.branch && status.branch !== 'HEAD') {
      return [{ name: status.branch, current: true }]
    }
    return []
  }, [branches, status?.branch])

  const diffLines = useMemo(() => (diff ? parsePatchLines(diff.patch) : []), [diff])

  if (!workspaceRoot) {
    return (
      <div className="git-panel">
        <div className="git-empty">{t('git.noWorkspace')}</div>
      </div>
    )
  }

  return (
    <div className="git-panel" ref={panelRef}>
      <div className="git-toolbar">
        <div className="git-branch" title={t('git.branch')}>
          {status?.isRepo ? (
            <>
              {status.branch === 'HEAD' || branchOptions.length === 0 ? (
                <span className="git-branch-name">{status.branch ?? 'HEAD'}</span>
              ) : (
                <select
                  className="git-branch-select"
                  value={status.branch ?? ''}
                  disabled={panelBusy}
                  title={t('git.branchSwitch')}
                  aria-label={t('git.branchSwitch')}
                  onChange={(e) => void handleCheckout(e.target.value)}
                >
                  {branchOptions.map((b) => (
                    <option key={b.name} value={b.name}>
                      {b.name}
                    </option>
                  ))}
                </select>
              )}
              {(status.ahead > 0 || status.behind > 0) && (
                <span
                  className="git-ahead-behind"
                  title={t('git.aheadBehindHint', {
                    ahead: String(status.ahead),
                    behind: String(status.behind)
                  })}
                >
                  {t('git.aheadBehind', {
                    ahead: String(status.ahead),
                    behind: String(status.behind)
                  })}
                </span>
              )}
            </>
          ) : (
            <span className="git-branch-name muted">{t('sidebar.git')}</span>
          )}
        </div>
        <button
          type="button"
          className="git-toolbar-btn"
          onClick={() => void refresh({ fetch: true })}
          disabled={panelBusy}
          title={t('git.refreshHint')}
        >
          {t('git.refresh')}
        </button>
      </div>

      {status?.isRepo && (
        <div className="git-remote-bar">
          <button
            type="button"
            className="git-toolbar-btn"
            onClick={() => void handlePull()}
            disabled={panelBusy}
            title={t('git.pullHint')}
          >
            {t('git.pull')}
            {status.behind > 0 ? ` ↓${status.behind}` : ''}
          </button>
          <button
            type="button"
            className="git-toolbar-btn"
            onClick={() => void handlePush()}
            disabled={panelBusy}
            title={t('git.pushHint')}
          >
            {t('git.push')}
            {status.ahead > 0 ? ` ↑${status.ahead}` : ''}
          </button>
        </div>
      )}

      {loading && !status && <div className="git-empty">{t('git.loading')}</div>}

      {error && <div className="git-error">{t('git.error', { message: error })}</div>}
      {notice && <div className="git-notice">{notice}</div>}

      {status && !status.available && (
        <div className="git-empty">{status.error ?? t('git.notFound')}</div>
      )}

      {status?.available && !status.isRepo && (
        <div className="git-empty">
          <div>{t('git.notRepo')}</div>
          <div className="git-empty-hint">{t('git.notRepoHint')}</div>
        </div>
      )}

      {status?.isRepo && (
        <>
          <div className="git-commit-box">
            <label className="git-commit-label" htmlFor="git-commit-message">
              {t('git.commitMessage')}
            </label>
            <textarea
              ref={commitInputRef}
              id="git-commit-message"
              className="git-commit-input"
              rows={3}
              value={commitMessage}
              placeholder={t('git.commitMessagePlaceholder')}
              onChange={(e) => setCommitMessage(e.target.value)}
              disabled={committing}
            />
            <button
              type="button"
              className="git-commit-btn"
              disabled={committing || busyPaths || staged.length === 0 || !commitMessage.trim()}
              onClick={() => void handleCommit()}
            >
              {t('git.commit')}
              {staged.length > 0 ? ` (${staged.length})` : ''}
            </button>
          </div>

          <div className="git-section">
            <div className="git-section-header">
              <span>
                {t('git.staged')}
                {staged.length > 0 ? ` · ${staged.length}` : ''}
              </span>
              {staged.length > 0 && (
                <button
                  type="button"
                  className="git-section-action"
                  disabled={busyPaths}
                  onClick={() => void runStage(staged.map((e) => e.path), true)}
                >
                  {t('git.unstageAll')}
                </button>
              )}
            </div>
            {staged.length === 0 ? (
              <div className="git-section-empty">{t('git.selectHint')}</div>
            ) : (
              staged.map((entry) => (
                <FileRow
                  key={`staged-${entry.path}`}
                  entry={entry}
                  selected={selectedPath === entry.path}
                  onSelect={() => void loadDiff(entry.path, true)}
                  onUnstage={() => void runStage([entry.path], true)}
                  onOpen={() => void openPath(entry.path)}
                />
              ))
            )}
          </div>

          <div className="git-section">
            <div className="git-section-header">
              <span>
                {t('git.changes')}
                {changes.length > 0 ? ` · ${changes.length}` : ''}
              </span>
              <div className="git-section-actions">
                {changes.length > 0 && (
                  <>
                    <button
                      type="button"
                      className="git-section-action"
                      disabled={busyPaths}
                      onClick={() => void runStage(changes.map((e) => e.path))}
                    >
                      {t('git.stageAll')}
                    </button>
                    <button
                      type="button"
                      className="git-section-action git-section-action-danger"
                      disabled={busyPaths}
                      onClick={() => void runDiscard(changes)}
                    >
                      {t('git.discardAll')}
                    </button>
                  </>
                )}
              </div>
            </div>
            {changes.length === 0 && staged.length === 0 ? (
              <div className="git-section-empty">{t('git.empty')}</div>
            ) : changes.length === 0 ? null : (
              changes.map((entry) => (
                <FileRow
                  key={`change-${entry.path}`}
                  entry={entry}
                  selected={selectedPath === entry.path}
                  onSelect={() => void loadDiff(entry.path, false)}
                  onStage={() => void runStage([entry.path])}
                  onDiscard={() => void runDiscard([entry])}
                  onOpen={() => void openPath(entry.path)}
                />
              ))
            )}
          </div>

          <div className="git-diff">
            <div
              className="git-diff-header"
              title={
                selectedPath
                  ? formatUiPath(selectedPath, { maxChars: 10_000 }).title
                  : undefined
              }
            >
              {selectedPath
                ? t('git.diffTitle', {
                    path: formatUiPath(selectedPath, { maxChars: UI_PATH_MAX_CHARS_WIDE }).label
                  })
                : t('git.showDiff')}
              {diff && (
                <span className="git-diff-side">
                  {diff.side === 'staged' ? t('git.diffStaged') : t('git.diffUnstaged')}
                </span>
              )}
            </div>
            <div className="git-diff-body">
              {diffLoading && <div className="git-empty">{t('git.loading')}</div>}
              {!diffLoading && selectedPath && diff && !diff.patch.trim() && (
                <div className="git-empty">{t('git.diffEmpty')}</div>
              )}
              {!diffLoading &&
                diffLines.map((line, i) => (
                  <div key={i} className={`git-diff-line git-diff-${line.type}`}>
                    <span className="git-diff-prefix">
                      {line.type === 'add' ? '+' : line.type === 'remove' ? '-' : ' '}
                    </span>
                    <span className="git-diff-text">{line.text}</span>
                  </div>
                ))}
              {diff?.truncated && (
                <div className="git-diff-truncated">{t('git.diffTruncated')}</div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
