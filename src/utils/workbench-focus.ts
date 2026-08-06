function findMonacoTextarea(): HTMLTextAreaElement | null {
  const input =
    document.querySelector('.monaco-editor textarea.inputarea') ??
    document.querySelector('.monaco-editor textarea')
  return input instanceof HTMLTextAreaElement ? input : null
}

export type WorkbenchFocusOwner = 'chat' | 'editor' | 'other'

/** Classify where keyboard focus currently lives for sticky chat restore. */
export function classifyWorkbenchFocusOwner(
  el: Element | null = document.activeElement
): WorkbenchFocusOwner {
  if (!(el instanceof HTMLElement)) return 'other'
  if (el.closest('.chat-panel')) return 'chat'
  if (el.closest('.monaco-editor') || el.classList.contains('inputarea')) return 'editor'
  return 'other'
}

/** Blur the chat composer when it holds focus so disabled input does not keep a dead focus. */
export function blurChatComposerIfFocused(): void {
  const active = document.activeElement
  if (!(active instanceof HTMLElement)) return
  if (!active.closest('.chat-input')) return
  active.blur()
}

/** Move keyboard focus to the Monaco editor when it is mounted. */
export function focusMonacoEditor(): void {
  const tryFocus = (remaining: number): void => {
    const monaco = findMonacoTextarea()
    if (monaco) {
      monaco.focus()
      return
    }
    if (remaining > 0) {
      requestAnimationFrame(() => tryFocus(remaining - 1))
    }
  }

  // Wait a frame so React can mount/switch the editor after openFile.
  requestAnimationFrame(() => tryFocus(30))
}

/** Restore keyboard focus to the editor, or chat if no editor is available. */
export function restoreWorkbenchFocus(): void {
  const focus = (): void => {
    const monaco = findMonacoTextarea()
    if (monaco) {
      monaco.focus()
      return
    }

    const chat = document.querySelector('.chat-input')
    if (chat instanceof HTMLElement) {
      chat.focus()
    }
  }

  requestAnimationFrame(focus)
}
