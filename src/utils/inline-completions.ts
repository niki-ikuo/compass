import type { Monaco } from '@monaco-editor/react'
import type { CancellationToken, IDisposable, Position, editor, languages } from 'monaco-editor'
import { useAppStore } from '@/stores/app-store'

/** Monaco 側にも debounce があるので、こちらは API コスト用の追加待ち */
const DEBOUNCE_MS = 350
const PREFIX_CHARS = 2400
const SUFFIX_CHARS = 600

let registration: IDisposable | null = null
let registeredMonaco: Monaco | null = null
let completionGeneration = 0

function sleep(ms: number, token: CancellationToken): Promise<boolean> {
  return new Promise((resolve) => {
    if (token.isCancellationRequested) {
      resolve(false)
      return
    }
    const timer = window.setTimeout(() => {
      sub.dispose()
      resolve(true)
    }, ms)
    const sub = token.onCancellationRequested(() => {
      window.clearTimeout(timer)
      sub.dispose()
      resolve(false)
    })
  })
}

function emptyCompletions(): languages.InlineCompletions {
  return { items: [] }
}

/** モデルが接頭辞をエコーした場合に、カーソル直前と重複する部分を落とす */
function stripOverlappingPrefix(completion: string, linePrefix: string): string {
  if (!completion || !linePrefix) return completion

  const max = Math.min(linePrefix.length, completion.length)
  for (let len = max; len > 0; len--) {
    if (completion.startsWith(linePrefix.slice(-len))) {
      return completion.slice(len)
    }
  }
  return completion
}

function resolveCompletionFilePath(model: editor.ITextModel): string | undefined {
  const { activeFilePath, workspaceRoot } = useAppStore.getState()
  const candidate = activeFilePath || model.uri.fsPath || model.uri.path

  // Monaco 内部モデル（inmemory://model/1 → path "/1"）は無視
  if (!candidate || /^\/\d+$/.test(candidate) || /^inmemory:/i.test(model.uri.toString())) {
    return activeFilePath || undefined
  }

  if (workspaceRoot && candidate.toLowerCase().startsWith(workspaceRoot.toLowerCase())) {
    return candidate.slice(workspaceRoot.length).replace(/^[/\\]+/, '').replace(/\\/g, '/')
  }

  return candidate.replace(/\\/g, '/')
}

async function provideInlineCompletions(
  monaco: Monaco,
  model: editor.ITextModel,
  position: Position,
  token: CancellationToken
): Promise<languages.InlineCompletions> {
  const settings = useAppStore.getState().settings
  // 旧セッションで undefined の場合はデフォルト ON とみなす
  if (settings.inlineCompletionsEnabled === false) {
    return emptyCompletions()
  }

  if (typeof window.compass?.ai?.complete !== 'function') {
    return emptyCompletions()
  }

  if (!(await sleep(DEBOUNCE_MS, token))) {
    return emptyCompletions()
  }

  const generation = ++completionGeneration

  // debounce 後はエディタの現在位置を優先（引数の position が古い場合がある）
  let livePosition = model.validatePosition(position)
  for (const ed of monaco.editor.getEditors()) {
    if (ed.getModel() === model) {
      const current = ed.getPosition()
      if (current) livePosition = current
      break
    }
  }

  const offset = model.getOffsetAt(livePosition)
  const full = model.getValue()
  const prefixStart = Math.max(0, offset - PREFIX_CHARS)
  const suffixEnd = Math.min(full.length, offset + SUFFIX_CHARS)
  const prefix = full.slice(prefixStart, offset)
  const suffix = full.slice(offset, suffixEnd)

  if (!prefix.trim() && !suffix.trim()) {
    return emptyCompletions()
  }

  try {
    // Monaco の token cancel では HTTP を即 abort しない（再トリガーで潰れて空返りしやすい）。
    // 重複リクエストは Main の complete 開始時に abort。明示停止は cancelPendingInlineCompletion。
    const result = await window.compass.ai.complete({
      filePath: resolveCompletionFilePath(model),
      language: model.getLanguageId(),
      prefix,
      suffix
    })

    if (generation !== completionGeneration) {
      return emptyCompletions()
    }

    if (token.isCancellationRequested || result.cancelled) {
      return emptyCompletions()
    }

    if (result.error || !result.text) {
      return emptyCompletions()
    }

    const linePrefix = model.getLineContent(livePosition.lineNumber).slice(0, livePosition.column - 1)
    let text = stripOverlappingPrefix(result.text, linePrefix)

    if (text.includes('\n')) {
      const maxCol = model.getLineMaxColumn(livePosition.lineNumber)
      if (livePosition.column < maxCol && !text.startsWith('\n')) {
        text = text.split('\n')[0] ?? text
      }
    }

    if (text.length === 0 || suffix.startsWith(text)) {
      return emptyCompletions()
    }

    try {
      for (const ed of monaco.editor.getEditors()) {
        if (ed.getModel() === model) {
          ed.trigger('compass', 'hideSuggestWidget', {})
          break
        }
      }
    } catch {
      // ignore
    }

    const range = {
      startLineNumber: livePosition.lineNumber,
      startColumn: livePosition.column,
      endLineNumber: livePosition.lineNumber,
      endColumn: livePosition.column
    }

    return {
      items: [
        {
          insertText: text,
          filterText: text,
          range
        }
      ],
      enableForwardStability: true,
      suppressSuggestions: true
    }
  } catch {
    return emptyCompletions()
  }
}

/**
 * 進行中のインライン補完 HTTP を止める（設定 OFF・プロバイダ差し替え時）。
 * Monaco の CancellationToken では呼ばない（空返りしやすいため）。
 */
export function cancelPendingInlineCompletion(): void {
  completionGeneration++
  if (typeof window.compass?.ai?.cancelComplete === 'function') {
    void window.compass.ai.cancelComplete()
  }
}

/** Monaco インスタンスに対してインライン補完プロバイダを登録する（インスタンス単位で一度） */
export function ensureInlineCompletionsRegistered(monaco: Monaco): void {
  if (registeredMonaco === monaco && registration) return

  if (registration) {
    registration.dispose()
    cancelPendingInlineCompletion()
  }
  registeredMonaco = monaco

  // monaco-editor 0.52 は freeInlineCompletions、新しいランタイムは disposeInlineCompletions を呼ぶ
  const disposeCompletions = (): void => undefined

  registration = monaco.languages.registerInlineCompletionsProvider('*', {
    provideInlineCompletions: (model, position, _context, token) =>
      provideInlineCompletions(monaco, model, position, token),
    freeInlineCompletions: disposeCompletions,
    // 新しい Monaco / バンドル側との互換
    disposeInlineCompletions: disposeCompletions
  } as languages.InlineCompletionsProvider)
}
