import { useEffect, useRef, useState, type MouseEvent } from 'react'
import { useI18n } from '@/i18n'

export type HelpCommandId =
  | 'Open Settings'
  | 'Open Provider'
  | 'Open Folder'
  | 'Focus Chat'

export function isHelpCommandId(value: string): value is HelpCommandId {
  return (
    value === 'Open Settings' ||
    value === 'Open Provider' ||
    value === 'Open Folder' ||
    value === 'Focus Chat'
  )
}

export function commandLabelKey(
  command: HelpCommandId
):
  | 'help.cmdOpenSettings'
  | 'help.cmdOpenProvider'
  | 'help.cmdOpenFolder'
  | 'help.cmdFocusChat' {
  switch (command) {
    case 'Open Settings':
      return 'help.cmdOpenSettings'
    case 'Open Provider':
      return 'help.cmdOpenProvider'
    case 'Open Folder':
      return 'help.cmdOpenFolder'
    case 'Focus Chat':
      return 'help.cmdFocusChat'
  }
}

export function resolveRelativeHelpId(fromId: string, href: string): string {
  const raw = href.split('#')[0]?.trim() ?? ''
  if (!raw) return fromId.replace(/\\/g, '/')

  const from = fromId.replace(/\\/g, '/').replace(/^\/+/, '')
  if (!raw.includes('/') && !raw.startsWith('.')) {
    const slash = from.lastIndexOf('/')
    const dir = slash >= 0 ? from.slice(0, slash + 1) : ''
    return `${dir}${raw}`
  }

  const fromDir = from.includes('/') ? from.slice(0, from.lastIndexOf('/')) : ''
  const parts = [...(fromDir ? fromDir.split('/') : []), ...raw.split('/')]
  const stack: string[] = []
  for (const part of parts) {
    if (!part || part === '.') continue
    if (part === '..') {
      stack.pop()
      continue
    }
    stack.push(part)
  }
  return stack.join('/')
}

export const HELP_DEFAULT_WIDTH = 960
export const HELP_DEFAULT_HEIGHT = 720
export const HELP_ASK_DEFAULT_WIDTH = 640
export const HELP_ASK_DEFAULT_HEIGHT = 520
export const HELP_MIN_WIDTH = 480
export const HELP_MIN_HEIGHT = 360

export function clampHelpSize(width: number, height: number): { width: number; height: number } {
  const maxWidth = Math.max(HELP_MIN_WIDTH, Math.floor(window.innerWidth * 0.96))
  const maxHeight = Math.max(HELP_MIN_HEIGHT, Math.floor(window.innerHeight * 0.92))
  return {
    width: Math.min(maxWidth, Math.max(HELP_MIN_WIDTH, Math.round(width))),
    height: Math.min(maxHeight, Math.max(HELP_MIN_HEIGHT, Math.round(height)))
  }
}

export function HelpResizeHandle({
  onResize
}: {
  onResize: (deltaWidth: number, deltaHeight: number) => void
}) {
  const { t } = useI18n()
  const [active, setActive] = useState(false)
  const lastPosRef = useRef({ x: 0, y: 0 })

  const handleMouseDown = (event: MouseEvent<HTMLDivElement>): void => {
    event.preventDefault()
    event.stopPropagation()
    setActive(true)
    lastPosRef.current = { x: event.clientX, y: event.clientY }
    document.body.classList.add('is-resizing-help')
  }

  useEffect(() => {
    if (!active) return

    const handleMouseMove = (event: globalThis.MouseEvent): void => {
      const deltaWidth = event.clientX - lastPosRef.current.x
      const deltaHeight = event.clientY - lastPosRef.current.y
      lastPosRef.current = { x: event.clientX, y: event.clientY }
      onResize(deltaWidth, deltaHeight)
    }

    const handleMouseUp = (): void => {
      setActive(false)
      document.body.classList.remove('is-resizing-help')
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
      document.body.classList.remove('is-resizing-help')
    }
  }, [active, onResize])

  return (
    <div
      className={`help-resize-handle${active ? ' active' : ''}`}
      onMouseDown={handleMouseDown}
      title={t('help.resize')}
      aria-label={t('help.resize')}
      role="separator"
      aria-orientation="horizontal"
    />
  )
}
