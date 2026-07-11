import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAppStore } from '@/stores/app-store'
import { toWorkspaceRelativePath } from '@/utils/workspace-actions'
import { buildWorkspaceIndex } from '@/utils/project-index'
import type { WorkspaceSearchFileResult, WorkspaceSearchMatch } from '@/types'

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
      title={`${match.line}:${match.column}`}
    >
      <span className="search-match-line">{match.line}</span>
      <span className="search-match-preview">
        {before}
        <mark>{highlighted || match.matchText}</mark>
        {after}
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
  return (
    <div className="search-file-group">
      <button type="button" className="search-file-header" onClick={onToggle}>
        <span className="search-file-chevron">{expanded ? '▾' : '▸'}</span>
        <span className="search-file-name" title={file.path}>
          {file.relativePath}
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
  const workspaceRoot = useAppStore((s) => s.workspaceRoot)
  const searchQuery = useAppStore((s) => s.searchQuery)
  const searchReplace = useAppStore((s) => s.searchReplace)
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

  const setSearchQuery = useAppStore((s) => s.setSearchQuery)
  const setSearchReplace = useAppStore((s) => s.setSearchReplace)
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
  const setLeftSidebarView = useAppStore((s) => s.setLeftSidebarView)
  const openFile = useAppStore((s) => s.openFile)
  const revealInEditor = useAppStore((s) => s.revealInEditor)
  const syncOpenFileContents = useAppStore((s) => s.syncOpenFileContents)
  const setFileTree = useAppStore((s) => s.setFileTree)

  const queryInputRef = useRef<HTMLInputElement>(null)
  const replaceInputRef = useRef<HTMLInputElement>(null)
  const searchTokenRef = useRef(0)
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set())
  const [showFilters, setShowFilters] = useState(false)
  const [isReplacing, setIsReplacing] = useState(false)

  useEffect(() => {
    queryInputRef.current?.focus()
    queryInputRef.current?.select()
  }, [])

  useEffect(() => {
    if (searchReplaceOpen) {
      // keep focus on query unless replace just opened via shortcut with empty query
      if (!searchQuery) {
        queryInputRef.current?.focus()
      } else {
        replaceInputRef.current?.focus()
      }
    }
  }, [searchReplaceOpen, searchQuery])

  const scopeLabel = useMemo(() => {
    if (!workspaceRoot) return 'ワークスペース'
    if (!searchRootPath) return 'ワークスペース全体'
    return toWorkspaceRelativePath(workspaceRoot, searchRootPath) || searchRootPath
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
      setSearchError(error instanceof Error ? error.message : '検索に失敗しました')
    } finally {
      if (token === searchTokenRef.current) {
        setSearchSearching(false)
      }
    }
  }, [
    workspaceRoot,
    searchQuery,
    searchCaseSensitive,
    searchWholeWord,
    searchUseRegex,
    searchInclude,
    searchExclude,
    searchRootPath,
    setSearchResults,
    setSearchSearching,
    setSearchError
  ])

  useEffect(() => {
    if (!workspaceRoot || !searchQuery.trim()) return
    const timer = window.setTimeout(() => {
      void runSearch()
    }, 300)
    return () => window.clearTimeout(timer)
  }, [
    workspaceRoot,
    searchQuery,
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
        const decoded = await window.compass.fs.readFile(path)
        openFile(path, decoded.content, decoded.encoding)
      } else {
        useAppStore.getState().setActiveFile(path)
      }
      revealInEditor(path, match.line, match.column, match.endColumn)
    },
    [openFiles, openFile, revealInEditor]
  )

  const handleReplaceAll = useCallback(async () => {
    if (!workspaceRoot || !searchQuery.trim() || isReplacing) return

    const total = searchResults?.totalMatches ?? 0
    const message =
      total > 0
        ? `${total} 件を置換しますか？この操作は元に戻せません。`
        : '一致する箇所をすべて置換しますか？この操作は元に戻せません。'
    if (!window.confirm(message)) return

    const dirtyInScope = openFiles.filter((file) => {
      if (!file.isDirty || file.isPreview) return false
      if (!searchRootPath) return true
      const norm = file.path.replace(/\\/g, '/').toLowerCase()
      const root = searchRootPath.replace(/\\/g, '/').toLowerCase()
      return norm === root || norm.startsWith(`${root}/`)
    })
    if (dirtyInScope.length > 0) {
      const proceed = window.confirm(
        `未保存のファイルが ${dirtyInScope.length} 件あります。ディスク上の内容で置換すると未保存の変更が失われる可能性があります。続行しますか？`
      )
      if (!proceed) return
    }

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
          `${result.replacements} 件を置換しましたが、${result.errors.length} 件でエラーがありました`
        )
      }
    } catch (error) {
      setSearchError(error instanceof Error ? error.message : '置換に失敗しました')
    } finally {
      setIsReplacing(false)
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
    searchResults,
    isReplacing,
    openFiles,
    syncOpenFileContents,
    setFileTree,
    runSearch,
    setSearchError
  ])

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
        <div className="panel-header">
          <span>検索</span>
          <button
            type="button"
            className="search-panel-back"
            onClick={() => setLeftSidebarView('explorer')}
          >
            エクスプローラ
          </button>
        </div>
        <div className="search-empty">フォルダを開いてから検索できます</div>
      </div>
    )
  }

  return (
    <div className="search-panel">
      <div className="panel-header">
        <span>検索</span>
        <div className="search-panel-header-actions">
          <button
            type="button"
            className="search-panel-back"
            onClick={() => setLeftSidebarView('explorer')}
            title="エクスプローラに戻る"
          >
            エクスプローラ
          </button>
        </div>
      </div>

      <div className="search-form">
        <div className="search-input-row">
          <button
            type="button"
            className={`search-expand-btn${searchReplaceOpen ? ' open' : ''}`}
            title={searchReplaceOpen ? '置換を隠す' : '置換を表示'}
            aria-expanded={searchReplaceOpen}
            onClick={() => setSearchReplaceOpen(!searchReplaceOpen)}
          >
            ▸
          </button>
          <input
            ref={queryInputRef}
            className="search-input"
            type="text"
            value={searchQuery}
            placeholder="検索"
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
              placeholder="置換"
              onChange={(e) => setSearchReplace(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  void handleReplaceAll()
                }
              }}
            />
            <button
              type="button"
              className="search-action-btn"
              disabled={!searchQuery.trim() || isReplacing || searchSearching}
              onClick={() => void handleReplaceAll()}
              title="すべて置換"
            >
              すべて置換
            </button>
          </div>
        )}

        <div className="search-options">
          <ToggleChip
            label="Aa"
            title="大文字と小文字を区別する"
            active={searchCaseSensitive}
            onClick={() => setSearchCaseSensitive(!searchCaseSensitive)}
          />
          <ToggleChip
            label="ab"
            title="単語単位で一致"
            active={searchWholeWord}
            onClick={() => setSearchWholeWord(!searchWholeWord)}
          />
          <ToggleChip
            label=".*"
            title="正規表現を使用する"
            active={searchUseRegex}
            onClick={() => setSearchUseRegex(!searchUseRegex)}
          />
          <button
            type="button"
            className={`search-toggle${showFilters ? ' active' : ''}`}
            title="ファイルを含める / 除外"
            onClick={() => setShowFilters(!showFilters)}
          >
            フィルタ
          </button>
        </div>

        {showFilters && (
          <div className="search-filters">
            <input
              className="search-input"
              type="text"
              value={searchInclude}
              placeholder="含めるファイル (例: *.ts, src/**)"
              onChange={(e) => setSearchInclude(e.target.value)}
            />
            <input
              className="search-input"
              type="text"
              value={searchExclude}
              placeholder="除外するファイル"
              onChange={(e) => setSearchExclude(e.target.value)}
            />
          </div>
        )}

        <div className="search-scope">
          <span className="search-scope-label">範囲:</span>
          <span className="search-scope-value" title={searchRootPath ?? workspaceRoot}>
            {scopeLabel}
          </span>
          {searchRootPath && (
            <button
              type="button"
              className="search-scope-clear"
              onClick={() => setSearchRootPath(null)}
            >
              全体に戻す
            </button>
          )}
        </div>
      </div>

      <div className="search-status">
        {searchSearching && <span>検索中…</span>}
        {!searchSearching && searchError && <span className="search-error">{searchError}</span>}
        {!searchSearching && !searchError && searchResults && (
          <span>
            {searchResults.totalMatches} 件
            {searchResults.files.length > 0 ? ` / ${searchResults.files.length} ファイル` : ''}
            {searchResults.truncated ? '（上限に達しました）' : ''}
          </span>
        )}
        {!searchSearching && !searchError && !searchResults && searchQuery.trim() === '' && (
          <span>検索文字列を入力してください</span>
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
          <div className="search-empty">一致する結果はありません</div>
        )}
      </div>
    </div>
  )
}
