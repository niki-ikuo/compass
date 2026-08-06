function findMonacoTextarea(): HTMLTextAreaElement | null {
  const input =
    document.querySelector('.monaco-editor textarea.inputarea') ??
    document.querySelector('.monaco-editor textarea')
  return input instanceof HTMLTextAreaElement ? input : null
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
