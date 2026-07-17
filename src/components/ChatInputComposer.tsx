import {
  forwardRef,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent
} from 'react'
import { detectMentionKind, isStructuredMention, type ChatMentionKind } from '@/utils/chat-mentions'
import { hasClipboardMedia } from '@/utils/clipboard-media'

export interface ChatInputComposerHandle {
  focus: () => void
  insertMention: (token: string) => void
}

interface ChatInputComposerProps {
  value: string
  onChange: (value: string) => void
  onSubmit: () => void
  placeholder?: string
  disabled?: boolean
  className?: string
  /** エディタ選択のコピーを検出したら true を返して通常貼り付けを抑止 */
  onPasteSelection?: (dataTransfer: DataTransfer) => boolean
  /** 画像・PDF の貼り付け */
  onPasteMedia?: (dataTransfer: DataTransfer) => void | Promise<void>
}

const MENTION_TOKEN_RE = /@\[([^\]\n]+)\]/g

function mentionIcon(kind: ChatMentionKind): string {
  if (kind === 'folder') return '📁'
  if (kind === 'selection') return '≡'
  return '📄'
}

function createMentionElement(inner: string, kind: ChatMentionKind): HTMLSpanElement {
  const capsule = document.createElement('span')
  capsule.className = `chat-path-capsule kind-${kind}`
  capsule.contentEditable = 'false'
  capsule.dataset.mention = `@[${inner}]`
  capsule.title = inner

  const icon = document.createElement('span')
  icon.className = 'chat-path-capsule-icon'
  icon.setAttribute('aria-hidden', 'true')
  icon.textContent = mentionIcon(kind)

  const label = document.createElement('span')
  label.className = 'chat-path-capsule-label'
  label.textContent = inner

  capsule.append(icon, label)
  return capsule
}

function parseMentionToken(token: string): { inner: string; kind: ChatMentionKind } | null {
  const match = token.match(/^@\[([^\]]+)\]$/)
  if (!match) return null
  const inner = match[1]
  if (!isStructuredMention(inner)) return null
  return { inner, kind: detectMentionKind(inner) }
}

function serializeEditor(root: HTMLElement): string {
  let result = ''

  const walk = (node: Node, isRoot = false) => {
    if (node.nodeType === Node.TEXT_NODE) {
      result += (node.textContent ?? '').replace(/\u00a0/g, ' ')
      return
    }

    if (node.nodeType !== Node.ELEMENT_NODE) return
    const el = node as HTMLElement

    if (el.dataset.mention) {
      result += el.dataset.mention
      return
    }

    if (el.tagName === 'BR') {
      result += '\n'
      return
    }

    const isBlock = el.tagName === 'DIV' || el.tagName === 'P'
    if (isBlock && !isRoot && result.length > 0 && !result.endsWith('\n')) {
      result += '\n'
    }

    for (const child of Array.from(el.childNodes)) {
      walk(child)
    }
  }

  walk(root, true)
  return result
}

function renderValueToEditor(root: HTMLElement, value: string) {
  root.replaceChildren()
  if (!value) return

  let lastIndex = 0
  MENTION_TOKEN_RE.lastIndex = 0
  let match: RegExpExecArray | null

  const appendText = (text: string) => {
    const lines = text.split('\n')
    lines.forEach((line, index) => {
      if (index > 0) root.appendChild(document.createElement('br'))
      if (line) root.appendChild(document.createTextNode(line))
    })
  }

  while ((match = MENTION_TOKEN_RE.exec(value)) !== null) {
    if (match.index > lastIndex) {
      appendText(value.slice(lastIndex, match.index))
    }
    const inner = match[1]
    if (isStructuredMention(inner)) {
      root.appendChild(createMentionElement(inner, detectMentionKind(inner)))
    } else {
      appendText(match[0])
    }
    lastIndex = match.index + match[0].length
  }

  if (lastIndex < value.length) {
    appendText(value.slice(lastIndex))
  }
}

function getTextBeforeCaret(editor: HTMLElement): string {
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0) return ''
  if (!editor.contains(selection.anchorNode)) return ''

  const range = selection.getRangeAt(0).cloneRange()
  range.selectNodeContents(editor)
  range.setEnd(selection.getRangeAt(0).startContainer, selection.getRangeAt(0).startOffset)
  return range.toString().replace(/\u00a0/g, ' ')
}

function getTextAfterCaret(editor: HTMLElement): string {
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0) return ''
  if (!editor.contains(selection.anchorNode)) return ''

  const range = selection.getRangeAt(0).cloneRange()
  range.selectNodeContents(editor)
  range.setStart(selection.getRangeAt(0).endContainer, selection.getRangeAt(0).endOffset)
  return range.toString().replace(/\u00a0/g, ' ')
}

function insertNodesAtCaret(editor: HTMLElement, nodes: Node[]) {
  const selection = window.getSelection()
  editor.focus()

  if (!selection) return

  let range: Range
  if (selection.rangeCount > 0 && editor.contains(selection.anchorNode)) {
    range = selection.getRangeAt(0)
  } else {
    range = document.createRange()
    range.selectNodeContents(editor)
    range.collapse(false)
  }

  range.deleteContents()

  const fragment = document.createDocumentFragment()
  for (const node of nodes) fragment.appendChild(node)
  const last = fragment.lastChild
  range.insertNode(fragment)

  if (last) {
    range.setStartAfter(last)
    range.collapse(true)
    selection.removeAllRanges()
    selection.addRange(range)
  }
}

export const ChatInputComposer = forwardRef<ChatInputComposerHandle, ChatInputComposerProps>(
  function ChatInputComposer(
    {
      value,
      onChange,
      onSubmit,
      placeholder,
      disabled,
      className,
      onPasteSelection,
      onPasteMedia
    },
    ref
  ) {
    const editorRef = useRef<HTMLDivElement>(null)
    const emittingRef = useRef(false)
    const composingRef = useRef(false)
    const [isComposing, setIsComposing] = useState(false)

    const emitChange = () => {
      const editor = editorRef.current
      if (!editor) return
      emittingRef.current = true
      onChange(serializeEditor(editor))
    }

    useImperativeHandle(ref, () => ({
      focus: () => {
        editorRef.current?.focus()
      },
      insertMention: (token: string) => {
        const editor = editorRef.current
        if (!editor || disabled) return

        const parsed = parseMentionToken(token)
        if (!parsed) return

        editor.focus()

        const before = getTextBeforeCaret(editor)
        const after = getTextAfterCaret(editor)
        const needsSpaceBefore = before.length > 0 && !/\s$/.test(before)
        const needsSpaceAfter = after.length > 0 && !/^\s/.test(after)

        const nodes: Node[] = []
        if (needsSpaceBefore) nodes.push(document.createTextNode(' '))
        nodes.push(createMentionElement(parsed.inner, parsed.kind))
        // contenteditable=false の直後にキャレットを置けるよう、末尾に空白を確保
        nodes.push(document.createTextNode(needsSpaceAfter ? ' ' : '\u00a0'))

        insertNodesAtCaret(editor, nodes)
        emitChange()
      }
    }))

    useLayoutEffect(() => {
      const editor = editorRef.current
      if (!editor) return

      if (emittingRef.current) {
        emittingRef.current = false
        // 自分で emit した直後でも、空文字クリア時は DOM を同期
        if (value === '' && serializeEditor(editor) !== '') {
          editor.replaceChildren()
        }
        return
      }

      if (serializeEditor(editor) === value) return
      renderValueToEditor(editor, value)
    }, [value])

    const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (disabled) return

      if (event.key === 'Enter' && !event.shiftKey && !composingRef.current) {
        event.preventDefault()
        onSubmit()
        return
      }

      if (event.key === 'Enter' && event.shiftKey) {
        event.preventDefault()
        document.execCommand('insertLineBreak')
        emitChange()
      }
    }

    const isEmpty = value.trim().length === 0 && !isComposing

    return (
      <div
        ref={editorRef}
        className={[
          'chat-input',
          'chat-input-composer',
          isEmpty ? 'is-empty' : '',
          className ?? ''
        ]
          .filter(Boolean)
          .join(' ')}
        contentEditable={!disabled}
        role="textbox"
        aria-multiline="true"
        aria-placeholder={placeholder}
        aria-disabled={disabled || undefined}
        data-placeholder={placeholder}
        suppressContentEditableWarning
        onInput={() => {
          if (composingRef.current) return
          emitChange()
        }}
        onCompositionStart={() => {
          composingRef.current = true
          setIsComposing(true)
        }}
        onCompositionEnd={() => {
          composingRef.current = false
          setIsComposing(false)
          emitChange()
        }}
        onKeyDown={handleKeyDown}
        onPaste={(event) => {
          const clipboard = event.clipboardData
          // Always take over paste so we can strip HTML / handle media & mentions.
          event.preventDefault()

          if (hasClipboardMedia(clipboard)) {
            void onPasteMedia?.(clipboard)
            return
          }

          if (onPasteSelection?.(clipboard)) return

          const text = clipboard.getData('text/plain')
          if (!text) return

          const editor = editorRef.current
          if (!editor) return

          document.execCommand('insertText', false, text)

          const next = serializeEditor(editor)
          if (/@\[[^\]\n]+\]/.test(next)) {
            renderValueToEditor(editor, next)
            const selection = window.getSelection()
            if (selection) {
              const range = document.createRange()
              range.selectNodeContents(editor)
              range.collapse(false)
              selection.removeAllRanges()
              selection.addRange(range)
            }
          }

          emitChange()
        }}
      />
    )
  }
)
