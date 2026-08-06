import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAppStore } from '@/stores/app-store'
import { formatUiPath, UI_PATH_MAX_CHARS } from '@/utils/display-path'
import { focusWithRetry } from '@/utils/focus-with-retry'
import { buildWorkspaceIndex } from '@/utils/project-index'
import { formatEmbeddingsStatus } from '@/utils/embeddings-status'
import { openWorkspaceFile } from '@/utils/open-workspace-file'
import type { WorkspaceSearchFileResult, WorkspaceSearchMatch } from '@/types'
import { useI18n, type MessageKey } from '@/i18n'
import { ConfirmDialog } from './ConfirmDialog'
import { ChevronRightIcon } from './icons/ToolbarIcons'

type ReplaceConfirmState = {
  kind: 'replace' | 'dirty'
  message: string
}

function ToggleChip({
  label,
  title,
  active,
  onClick
}: {
  label: string
  title: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      className={`search-toggle${active ? ' active' : ''}`}
      title={title}
      aria-pressed={active}
      onClick={onClick}
    >
      {label}
    </button>
  )
}

function MatchRow({
  filePath,
  match,
  onOpen
}: {
  filePath: string
  match: WorkspaceSearchMatch
  onOpen: (path: string, match: WorkspaceSearchMatch) => void
}) {
  const before = match.preview.slice(0, Math.max(0, match.column - 1))
  const highlighted = match.preview.slice(match.column - 1, match.endColumn - 1)
  const after = match.preview.slice(match.endColumn - 1)

  return (
    <button
      type="button"
      className="search-match"
      onClick={() => onOpen(filePath, match)}
      title={
        match.heading
          ? `${match.heading} · L${match.line}`
          : `${match.line}:${match.column}`
      }
    >
      <span className="search-match-line">{match.line}</span>
      <span className="search-match-body">
        {match.heading && <span className="search-match-heading">{match.heading}</span>}
        <span className="search-match-preview">
          {before}
          <mark>{highlighted || match.matchText}</mark>
          {after}
        </span>
      </span>
    </button>
  )
}

function FileResultGroup({
  file,
  expanded,
  onToggle,
  onOpenMatch
}: {
  file: WorkspaceSearchFileResult
  expanded: boolean
  onToggle: () => void
  onOpenMatch: (path: string, match: WorkspaceSearchMatch) => void
}) {
  const pathDisplay = formatUiPath(file.relativePath || file.path, {
    maxChars: UI_PATH_MAX_CHARS
  })
  return (
    <div className="search-file-group">
      <button type="button" className="search-file-header" onClick={onToggle}>
        <span className="search-file-chevron">{expanded ? '▾' : '▸'}</span>
        <span className="search-file-name" title={pathDisplay.title}>
          {pathDisplay.label}
        </span>
        <span className="search-file-count">{file.matches.length}</span>
      </button>
      {expanded && (
        <div className="search-file-matches">
          {file.matches.map((match, index) => (
            <MatchRow
              key={`${match.line}-${match.column}-${index}`}
              filePath={file.path}
              match={match}
              onOpen={onOpenMatch}
            />
          ))}
        </div>
      )}
    </div>
  )
}

export function SearchPanel() {
  const { t } = useI18n()
  const workspaceRoot = useAppStore((s) => s.workspaceRoot)
  const searchQuery = useAppStore((s) => s.searchQuery)
  const searchReplace = useAppStore((s) => s.searchReplace)
  const searchMode = useAppStore((s) => s.searchMode)
  const searchCaseSensitive = useAppStore((s) => s.searchCaseSensitive)
  const searchWholeWord = useAppStore((s) => s.searchWholeWord)
  const searchUseRegex = useAppStore((s) => s.searchUseRegex)
  const searchInclude = useAppStore((s) => s.searchInclude)
  const searchExclude = useAppStore((s) => s.searchExclude)
  const searchRootPath = useAppStore((s) => s.searchRootPath)
  const searchResults = useAppStore((s) => s.searchResults)
  const searchSearching = useAppStore((s) => s.searchSearching)
  const searchError = useAppStore((s) => s.searchError)
  const searchReplaceOpen = useAppStore((s) => s.searchReplaceOpen)
  const openFiles = useAppStore((s) => s.openFiles)
  const indexMeta = useAppStore((s) => s.indexMeta)

  const setSearchQuery = useAppStore((s) => s.setSearchQuery)
  const setSearchReplace = useAppStore((s) => s.setSearchReplace)
  const setSearchMode = useAppStore((s) => s.setSearchMode)
  const setSearchCaseSensitive = useAppStore((s) => s.setSearchCaseSensitive)
  const setSearchWholeWord = useAppStore((s) => s.setSearchWholeWord)
  const setSearchUseRegex = useAppStore((s) => s.setSearchUseRegex)
  const setSearchInclude = useAppStore((s) => s.setSearchInclude)
  const setSearchExclude = useAppStore((s) => s.setSearchExclude)
  const setSearchRootPath = useAppStore((s) => s.setSearchRootPath)
  const setSearchResults = useAppStore((s) => s.setSearchResults)
  const setSearchSearching = useAppStore((s) => s.setSearchSearching)
  const setSearchError = useAppStore((s) => s.setSearchError)
  const setSearchReplaceOpen = useAppStore((s) => s.setSearchReplaceOpen)
  const revealInEditor = useAppStore((s) => s.revealInEditor)
  const syncOpenFileContents = useAppStore((s) => s.syncOpenFileContents)
  const setFileTree = useAppStore((s) => s.setFileTree)
  const sidebarFocusRequest = useAppStore((s) => s.sidebarFocusRequest)
  const clearSidebarFocusRequest = useAppStore((s) => s.clearSidebarFocusRequest)

  const queryInputRef = useRef<HTMLInputElement>(null)
  const replaceInputRef = useRef<HTMLInputElement>(null)
  const searchTokenRef = useRef(0)
  const prevSearchModeRef = useRef(searchMode)
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set())
  const [showFilters, setShowFilters] = useState(false)
  const [isReplacing, setIsReplacing] = useState(false)
  const [replaceConfirm, setReplaceConfirm] = useState<ReplaceConfirmState | null>(null)

  const embeddingsLabels = useMemo(
    () =>
      formatEmbeddingsStatus(indexMeta?.embeddings, (key, params) =>
        t(key as MessageKey, params)
      ),
    [indexMeta?.embeddings, t]
  )

  const restoreSearchInputFocus = useCallback(() => {
    const focusTarget =
      useAppStore.getState().searchReplaceOpen && useAppStore.getState().searchQuery
        ? replaceInputRef.current
        : queryInputRef.current
    focusWithRetry(() => focusTarget)
  }, [])

  useEffect(() => {
    if (!sidebarFocusRequest || sidebarFocusRequest.view !== 'search') return
    const requestId = sidebarFocusRequest.id
    const target =
      searchReplaceOpen && useAppStore.getState().searchQuery
        ? () => replaceInputRef.current
        : () => queryInputRef.current
    focusWithRetry(target, { select: true })
    const clearTimer = window.setTimeout(() => {
      if (useAppStore.getState().sidebarFocusRequest?.id === requestId) {
        clearSidebarFocusRequest()
      }
    }, 60)
    return () => clearTimeout(clearTimer)
  }, [sidebarFocusRequest, searchReplaceOpen, clearSidebarFocusRequest])

  // Focus only when the replace row opens — not on every searchQuery change.
  useEffect(() => {
    if (!searchReplaceOpen) return
    const query = useAppStore.getState().searchQuery
    if (!query) {
      focusWithRetry(() => queryInputRef.current)
    } else {
      focusWithRetry(() => replaceInputRef.current)
    }
  }, [searchReplaceOpen])

  const scopeLabel = useMemo(() => {
    if (!workspaceRoot) return t('search.workspace')
    if (!searchRootPath) return t('search.entireWorkspace')
    return formatUiPath(searchRootPath, {
      workspaceRoot,
      maxChars: UI_PATH_MAX_CHARS
    }).label
  }, [workspaceRoot, searchRootPath, t])

  const scopeTitle = useMemo(() => {
    if (!workspaceRoot || !searchRootPath) return undefined
    return formatUiPath(searchRootPath, {
      workspaceRoot,
      maxChars: 10_000
    }).title
  }, [workspaceRoot, searchRootPath])

  const runSearch = useCallback(async () => {
    if (!workspaceRoot) return
    const query = searchQuery.trim()
    if (!query) {
      setSearchResults(null)
      setSearchError(null)
      return
    }

    const token = ++searchTokenRef.current
    setSearchSearching(true)
    setSearchError(null)

    try {
      const result = await window.compass.fs.search(workspaceRoot, {
        query,
        mode: searchMode,
        caseSensitive: searchCaseSensitive,
        wholeWord: searchWholeWord,
        useRegex: searchUseRegex,
        include: searchInclude.trim() || undefined,
        exclude: searchExclude.trim() || undefined,
        rootPath: searchRootPath ?? undefined
      })
      if (token !== searchTokenRef.current) return
      setSearchResults(result)
      setExpandedFiles(new Set(result.files.map((file) => file.path)))
    } catch (error) {
      if (token !== searchTokenRef.current) return
      setSearchResults(null)
      setSearchError(error instanceof Error ? error.message : t('search.failed'))
    } finally {
      if (token === searchTokenRef.current) {
        setSearchSearching(false)
      }
    }
  }, [
    workspaceRoot,
    searchQuery,
    searchMode,
    searchCaseSensitive,
    searchWholeWord,
    searchUseRegex,
    searchInclude,
    searchExclude,
    searchRootPath,
    setSearchResults,
    setSearchSearching,
    setSearchError,
    t
  ])

  useEffect(() => {
    if (!workspaceRoot || !searchQuery.trim()) return

    // Drop in-flight results as soon as inputs change (don't wait for debounce).
    searchTokenRef.current += 1

    const modeChanged = prevSearchModeRef.current !== searchMode
    prevSearchModeRef.current = searchMode
    // Mode toggles should feel instant; typing still debounces.
    const delayMs = modeChanged ? 0 : 300

    const timer = window.setTimeout(() => {
      void runSearch()
    }, delayMs)
    return () => window.clearTimeout(timer)
  }, [
    workspaceRoot,
    searchQuery,
    searchMode,
    searchCaseSensitive,
    searchWholeWord,
    searchUseRegex,
    searchInclude,
    searchExclude,
    searchRootPath,
    runSearch
  ])

  const openMatch = useCallback(
    async (path: string, match: WorkspaceSearchMatch) => {
      const existing = openFiles.find((f) => f.path === path)
      if (!existing) {
        await openWorkspaceFile(path)
      } else {
        useAppStore.getState().setActiveFile(path)
      }
      revealInEditor(path, match.line, match.column, match.endColumn)
    },
    [openFiles, revealInEditor]
  )

  const executeReplaceAll = useCallback(async () => {
    if (!workspaceRoot || !searchQuery.trim() || isReplacing) return

    setIsReplacing(true)
    setSearchError(null)
    try {
      const result = await window.compass.fs.replace(workspaceRoot, {
        query: searchQuery,
        replace: searchReplace,
        caseSensitive: searchCaseSensitive,
        wholeWord: searchWholeWord,
        useRegex: searchUseRegex,
        include: searchInclude.trim() || undefined,
        exclude: searchExclude.trim() || undefined,
        rootPath: searchRootPath ?? undefined
      })
      syncOpenFileContents(result.changedFiles)
      const tree = await window.compass.fs.readDir(workspaceRoot)
      setFileTree(tree)
      void buildWorkspaceIndex(workspaceRoot)
      await runSearch()
      if (result.errors.length > 0) {
        setSearchError(
          t('search.replacePartial', {
            replacements: result.replacements,
            errors: result.errors.length
          })
        )
      }
    } catch (error) {
      setSearchError(error instanceof Error ? error.message : t('search.replaceFailed'))
    } finally {
      setIsReplacing(false)
      restoreSearchInputFocus()
    }
  }, [
    workspaceRoot,
    searchQuery,
    searchReplace,
    searchCaseSensitive,
    searchWholeWord,
    searchUseRegex,
    searchInclude,
    searchExclude,
    searchRootPath,
    isReplacing,
    syncOpenFileContents,
    setFileTree,
    runSearch,
    setSearchError,
    restoreSearchInputFocus,
    t
  ])

  const requestReplaceAll = useCallback(() => {
    if (!workspaceRoot || !searchQuery.trim() || isReplacing || replaceConfirm) return

    const total = searchResults?.totalMatches ?? 0
    const message =
      total > 0
        ? t('search.replaceConfirmCount', { count: total })
        : t('search.replaceConfirm')
    setReplaceConfirm({ kind: 'replace', message })
  }, [
    workspaceRoot,
    searchQuery,
    isReplacing,
    replaceConfirm,
    searchResults,
    t
  ])

  const handleReplaceConfirm = useCallback(() => {
    if (!replaceConfirm) return

    if (replaceConfirm.kind === 'replace') {
      const dirtyInScope = openFiles.filter((file) => {
        if (!file.isDirty || file.isPreview) return false
        if (!searchRootPath) return true
        const norm = file.path.replace(/\\/g, '/').toLowerCase()
        const root = searchRootPath.replace(/\\/g, '/').toLowerCase()
        return norm === root || norm.startsWith(`${root}/`)
      })
      if (dirtyInScope.length > 0) {
        setReplaceConfirm({
          kind: 'dirty',
          message: t('search.dirtyWarning', { count: dirtyInScope.length })
        })
        return
      }
    }

    setReplaceConfirm(null)
    void executeReplaceAll()
  }, [replaceConfirm, openFiles, searchRootPath, executeReplaceAll, t])

  const handleReplaceCancel = useCallback(() => {
    setReplaceConfirm(null)
    restoreSearchInputFocus()
  }, [restoreSearchInputFocus])

  const toggleFile = (path: string) => {
    setExpandedFiles((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  if (!workspaceRoot) {
    return (
      <div className="search-panel">
        <div className="search-empty">{t('search.needFolder')}</div>
      </div>
    )
  }

  return (
    <div className="search-panel">
      <div className="search-form">
        <div className="search-input-row">
          <button
            type="button"
            className={`search-expand-btn${searchReplaceOpen ? ' open' : ''}`}
            title={searchReplaceOpen ? t('search.hideReplace') : t('search.showReplace')}
            aria-expanded={searchReplaceOpen}
            onClick={() => setSearchReplaceOpen(!searchReplaceOpen)}
          >
            <ChevronRightIcon />
          </button>
          <input
            ref={queryInputRef}
            className="search-input"
            type="text"
            value={searchQuery}
            placeholder={t('search.placeholder')}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                void runSearch()
              }
            }}
          />
        </div>

        {searchReplaceOpen && (
          <div className="search-input-row search-replace-row">
            <span className="search-expand-spacer" />
            <input
              ref={replaceInputRef}
              className="search-input"
              type="text"
              value={searchReplace}
              placeholder={t('search.replacePlaceholder')}
              onChange={(e) => setSearchReplace(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  requestReplaceAll()
                }
              }}
            />
            <button
              type="button"
              className="search-action-btn"
              disabled={!searchQuery.trim() || isReplacing || searchSearching}
              onClick={requestReplaceAll}
              title={t('search.replaceAll')}
            >
              {t('search.replaceAll')}
            </button>
          </div>
        )}

        <div className="search-options">
          <ToggleChip
            label={t('search.modeHybrid')}
            title={t('search.modeHybridTitle')}
            active={searchMode === 'hybrid'}
            onClick={() => setSearchMode('hybrid')}
          />
          <ToggleChip
            label={t('search.modeKeyword')}
            title={t('search.modeKeywordTitle')}
            active={searchMode === 'keyword'}
            onClick={() => setSearchMode('keyword')}
          />
          {searchMode === 'keyword' && (
            <>
              <ToggleChip
                label="Aa"
                title={t('search.matchCase')}
                active={searchCaseSensitive}
                onClick={() => setSearchCaseSensitive(!searchCaseSensitive)}
              />
              <ToggleChip
                label="ab"
                title={t('search.wholeWord')}
                active={searchWholeWord}
                onClick={() => setSearchWholeWord(!searchWholeWord)}
              />
              <ToggleChip
                label=".*"
                title={t('search.useRegex')}
                active={searchUseRegex}
                onClick={() => setSearchUseRegex(!searchUseRegex)}
              />
            </>
          )}
          <button
            type="button"
            className={`search-toggle${showFilters ? ' active' : ''}`}
            title={t('search.includeExclude')}
            onClick={() => setShowFilters(!showFilters)}
          >
            {t('search.filter')}
          </button>
        </div>

        {searchMode === 'hybrid' && embeddingsLabels && (
          indexMeta?.embeddings?.quality === 'fallback' ||
          indexMeta?.embeddings?.quality === 'unavailable' ? (
            <div
              className={`search-embeddings-alert search-embeddings-${indexMeta.embeddings.quality}`}
              role="alert"
            >
              <div className="search-embeddings-alert-body">
                <strong className="search-embeddings-alert-title">
                  {embeddingsLabels.short}
                </strong>
                <p className="search-embeddings-alert-detail">{embeddingsLabels.detail}</p>
              </div>
              <button
                type="button"
                className="search-embeddings-alert-action"
                disabled={!workspaceRoot}
                onClick={() => {
                  if (workspaceRoot) void buildWorkspaceIndex(workspaceRoot)
                }}
              >
                {t('search.embeddingsRebuild')}
              </button>
            </div>
          ) : (
            <div className="search-embeddings-status" title={embeddingsLabels.detail}>
              {t('search.embeddingsStatus', { label: embeddingsLabels.short })}
            </div>
          )
        )}

        {showFilters && (
          <div className="search-filters">
            <input
              className="search-input"
              type="text"
              value={searchInclude}
              placeholder={t('search.includePlaceholder')}
              onChange={(e) => setSearchInclude(e.target.value)}
            />
            <input
              className="search-input"
              type="text"
              value={searchExclude}
              placeholder={t('search.excludePlaceholder')}
              onChange={(e) => setSearchExclude(e.target.value)}
            />
          </div>
        )}

        <div className="search-scope">
          <span className="search-scope-label">{t('search.scopeLabel')}</span>
          <span className="search-scope-value" title={scopeTitle ?? searchRootPath ?? workspaceRoot ?? undefined}>
            {scopeLabel}
          </span>
          {searchRootPath && (
            <button
              type="button"
              className="search-scope-clear"
              onClick={() => setSearchRootPath(null)}
            >
              {t('search.clearScope')}
            </button>
          )}
        </div>
      </div>

      <div className="search-status">
        {searchSearching && <span>{t('search.searching')}</span>}
        {!searchSearching && searchError && <span className="search-error">{searchError}</span>}
        {!searchSearching && !searchError && searchResults && (
          <span>
            {t('search.results', { count: searchResults.totalMatches })}
            {searchResults.files.length > 0
              ? t('search.filesSuffix', { count: searchResults.files.length })
              : ''}
            {searchResults.truncated ? t('search.truncated') : ''}
          </span>
        )}
        {!searchSearching && !searchError && !searchResults && searchQuery.trim() === '' && (
          <span>{t('search.queryRequired')}</span>
        )}
      </div>

      <div className="search-results">
        {searchResults?.files.map((file) => (
          <FileResultGroup
            key={file.path}
            file={file}
            expanded={expandedFiles.has(file.path)}
            onToggle={() => toggleFile(file.path)}
            onOpenMatch={(path, match) => void openMatch(path, match)}
          />
        ))}
        {!searchSearching && searchResults && searchResults.files.length === 0 && searchQuery.trim() && (
          <div className="search-empty">{t('search.noResults')}</div>
        )}
      </div>

      <ConfirmDialog
        open={replaceConfirm !== null}
        title={t('search.replaceAll')}
        message={replaceConfirm?.message ?? ''}
        confirmLabel={t('search.replaceAll')}
        cancelLabel={t('common.cancel')}
        danger
        onConfirm={handleReplaceConfirm}
        onCancel={handleReplaceCancel}
      />
    </div>
  )
}
