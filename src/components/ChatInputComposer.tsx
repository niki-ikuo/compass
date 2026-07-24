import {
  forwardRef,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent
} from 'react'
import {
  detectMentionKind,
  hasStructuredMention,
  isStructuredMention,
  type ChatMentionKind
} from '@/utils/chat-mentions'
import { hasClipboardMedia } from '@/utils/clipboard-media'

/** これを超えるとパスカプセル化を避ける（大量テキスト対策） */
const CAPSULE_RENDER_MAX_CHARS = 8_000
const CAPSULE_RENDER_MAX_LINES = 120

export interface ChatInputComposerHandle {
  focus: () => void
  insertMention: (token: string) => void
  getValue: () => string
  clear: () => void
}

interface ChatInputComposerProps {
  /** 外部から内容を同期するときだけ使う。通常の入力中は DOM が正本 */
  value?: string
  onChange?: (value: string) => void
  /** 送信可否が変わったときだけ通知（巨大文字列での親再レンダー抑制用） */
  onCanSendChange?: (canSend: boolean) => void
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

function exceedsCapsuleBudget(text: string): boolean {
  if (text.length > CAPSULE_RENDER_MAX_CHARS) return true
  let lines = 1
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) {
      lines++
      if (lines > CAPSULE_RENDER_MAX_LINES) return true
    }
  }
  return false
}

function canSendFromValue(text: string): boolean {
  if (text.length === 0) return false
  if (text.length >= 64) return true
  return text.trim().length > 0
}

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

/** 選択範囲を除いた前後のシリアライズ（貼り付け置換用） */
function serializeEditorSplitAtSelection(root: HTMLElement): { before: string; after: string } {
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0 || !root.contains(sel.getRangeAt(0).commonAncestorContainer)) {
    return { before: serializeEditor(root), after: '' }
  }

  const range = sel.getRangeAt(0)
  let before = ''
  let after = ''

  const placeElement = (el: HTMLElement, token: string) => {
    const elRange = document.createRange()
    elRange.selectNode(el)
    if (elRange.compareBoundaryPoints(Range.END_TO_START, range) <= 0) {
      before += token
    } else if (elRange.compareBoundaryPoints(Range.START_TO_END, range) >= 0) {
      after += token
    }
  }

  const walk = (node: Node, isRoot = false) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = (node.textContent ?? '').replace(/\u00a0/g, ' ')
      if (!text) return

      if (range.startContainer === node && range.endContainer === node) {
        before += text.slice(0, range.startOffset)
        after += text.slice(range.endOffset)
        return
      }
      if (range.startContainer === node) {
        before += text.slice(0, range.startOffset)
        return
      }
      if (range.endContainer === node) {
        after += text.slice(range.endOffset)
        return
      }

      const cp = range.comparePoint(node, 0)
      if (cp < 0) before += text
      else if (cp > 0) after += text
      return
    }

    if (node.nodeType !== Node.ELEMENT_NODE) return
    const el = node as HTMLElement

    if (el.dataset.mention) {
      placeElement(el, el.dataset.mention)
      return
    }

    if (el.tagName === 'BR') {
      placeElement(el, '\n')
      return
    }

    const isBlock = el.tagName === 'DIV' || el.tagName === 'P'
    if (isBlock && !isRoot) {
      const elRange = document.createRange()
      elRange.selectNode(el)
      if (
        elRange.compareBoundaryPoints(Range.END_TO_START, range) <= 0 &&
        before.length > 0 &&
        !before.endsWith('\n')
      ) {
        before += '\n'
      }
    }

    for (const child of Array.from(el.childNodes)) {
      walk(child)
    }
  }

  walk(root, true)
  return { before, after }
}

/** pre-wrap 前提: 改行は TextNode 内の \n で足りる（行ごとの <br> は作らない） */
function appendPlainText(target: ParentNode, text: string) {
  if (!text) return
  target.appendChild(document.createTextNode(text))
}

function renderValueToEditor(root: HTMLElement, value: string) {
  root.replaceChildren()
  if (!value) return

  if (exceedsCapsuleBudget(value) || !hasStructuredMention(value)) {
    appendPlainText(root, value)
    return
  }

  let lastIndex = 0
  MENTION_TOKEN_RE.lastIndex = 0
  let match: RegExpExecArray | null
  const fragment = document.createDocumentFragment()

  while ((match = MENTION_TOKEN_RE.exec(value)) !== null) {
    if (match.index > lastIndex) {
      appendPlainText(fragment, value.slice(lastIndex, match.index))
    }
    const inner = match[1]
    if (isStructuredMention(inner)) {
      fragment.appendChild(createMentionElement(inner, detectMentionKind(inner)))
    } else {
      appendPlainText(fragment, match[0])
    }
    lastIndex = match.index + match[0].length
  }

  if (lastIndex < value.length) {
    appendPlainText(fragment, value.slice(lastIndex))
  }

  root.appendChild(fragment)
}

function setCaretAtSerializedOffset(root: HTMLElement, offset: number) {
  const selection = window.getSelection()
  if (!selection) return

  let remaining = Math.max(0, offset)

  const placeAfter = (node: Node) => {
    const range = document.createRange()
    range.setStartAfter(node)
    range.collapse(true)
    selection.removeAllRanges()
    selection.addRange(range)
  }

  const walk = (node: Node): boolean => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = (node.textContent ?? '').replace(/\u00a0/g, ' ')
      if (remaining <= text.length) {
        const range = document.createRange()
        range.setStart(node, remaining)
        range.collapse(true)
        selection.removeAllRanges()
        selection.addRange(range)
        return true
      }
      remaining -= text.length
      return false
    }

    if (node.nodeType !== Node.ELEMENT_NODE) return false
    const el = node as HTMLElement

    if (el.dataset.mention) {
      const token = el.dataset.mention ?? ''
      if (remaining <= token.length) {
        placeAfter(el)
        return true
      }
      remaining -= token.length
      return false
    }

    if (el.tagName === 'BR') {
      if (remaining <= 1) {
        placeAfter(el)
        return true
      }
      remaining -= 1
      return false
    }

    for (const child of Array.from(el.childNodes)) {
      if (walk(child)) return true
    }
    return false
  }

  if (!walk(root)) {
    const range = document.createRange()
    range.selectNodeContents(root)
    range.collapse(false)
    selection.removeAllRanges()
    selection.addRange(range)
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
      onCanSendChange,
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
    const valueRef = useRef(value ?? '')
    const canSendRef = useRef(canSendFromValue(value ?? ''))
    const composingRef = useRef(false)
    const [isComposing, setIsComposing] = useState(false)
    const [isEmpty, setIsEmpty] = useState(() => !canSendFromValue(value ?? ''))

    const syncValue = (next: string) => {
      valueRef.current = next
      const empty = !canSendFromValue(next)
      setIsEmpty((prev) => (prev === empty ? prev : empty))

      const canSend = !empty
      if (canSendRef.current !== canSend) {
        canSendRef.current = canSend
        onCanSendChange?.(canSend)
      }

      onChange?.(next)
    }

    const readEditorValue = () => {
      const editor = editorRef.current
      if (!editor) return valueRef.current
      return serializeEditor(editor)
    }

    useImperativeHandle(ref, () => ({
      focus: () => {
        const editor = editorRef.current
        if (!editor || disabled) return
        editor.focus()

        // DnD 直後などは activeElement だけ composer で Selection が外れたまま、
        // 見た目はフォーカス済みでも文字が入らないことがある。
        const selection = window.getSelection()
        if (!selection) return
        if (selection.rangeCount === 0 || !editor.contains(selection.anchorNode)) {
          const range = document.createRange()
          range.selectNodeContents(editor)
          range.collapse(false)
          selection.removeAllRanges()
          selection.addRange(range)
        }
      },
      getValue: () => valueRef.current,
      clear: () => {
        const editor = editorRef.current
        if (editor) editor.replaceChildren()
        syncValue('')
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
        syncValue(serializeEditor(editor))
      }
    }))

    useLayoutEffect(() => {
      if (value === undefined) return
      if (value === valueRef.current) return
      const editor = editorRef.current
      if (!editor) return
      valueRef.current = value
      renderValueToEditor(editor, value)
      const empty = !canSendFromValue(value)
      setIsEmpty(empty)
      canSendRef.current = !empty
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
        syncValue(readEditorValue())
      }
    }

    return (
      <div
        ref={editorRef}
        className={[
          'chat-input',
          'chat-input-composer',
          isEmpty && !isComposing ? 'is-empty' : '',
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
          syncValue(readEditorValue())
        }}
        onCompositionStart={() => {
          composingRef.current = true
          setIsComposing(true)
        }}
        onCompositionEnd={() => {
          composingRef.current = false
          setIsComposing(false)
          syncValue(readEditorValue())
        }}
        onKeyDown={handleKeyDown}
        onDragOver={(event) => {
          // contentEditable のネイティブ drop を避け、親の chat-input-area に処理を寄せる
          if (event.dataTransfer.types.length > 0) {
            event.preventDefault()
          }
        }}
        onDrop={(event) => {
          event.preventDefault()
        }}
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

          // insertText は改行ごとに DOM を増やすため使わない。
          // pre-wrap + 単一 TextNode（必要なら capsule）へ直接描画する。
          const { before, after } = serializeEditorSplitAtSelection(editor)
          const next = before + text + after
          const caretOffset = before.length + text.length

          renderValueToEditor(editor, next)
          setCaretAtSerializedOffset(editor, caretOffset)

          // 大きい貼り付けは先に描画し、親/ローカルの React 更新は次フレームへ
          if (exceedsCapsuleBudget(text)) {
            valueRef.current = next
            requestAnimationFrame(() => {
              syncValue(next)
            })
            return
          }

          syncValue(next)
        }}
      />
    )
  }
)
