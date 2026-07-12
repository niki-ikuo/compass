/** Restore keyboard focus to the editor, or chat if no editor is available. */
export function restoreWorkbenchFocus(): void {
  const focus = (): void => {
    const monaco = document.querySelector('.monaco-editor textarea')
    if (monaco instanceof HTMLTextAreaElement) {
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
