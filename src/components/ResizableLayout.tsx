import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'

const MIN_SIDE_PANEL = 120
const MAX_SIDE_PANEL = 1200
const MIN_EDITOR = 200

interface ResizableLayoutProps {
  showLeft: boolean
  showRight: boolean
  leftWidth: number
  rightWidth: number
  onLeftWidthChange: (width: number) => void
  onRightWidthChange: (width: number) => void
  left: ReactNode
  center: ReactNode
  right: ReactNode
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function ResizeHandle({
  onDrag,
  onDragEnd
}: {
  onDrag: (deltaX: number) => void
  onDragEnd: () => void
}) {
  const [active, setActive] = useState(false)
  const lastXRef = useRef(0)

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault()
    setActive(true)
    lastXRef.current = e.clientX
    document.body.classList.add('is-resizing-panels')
  }

  useEffect(() => {
    if (!active) return

    const handleMouseMove = (e: MouseEvent) => {
      const delta = e.clientX - lastXRef.current
      lastXRef.current = e.clientX
      onDrag(delta)
    }

    const handleMouseUp = () => {
      setActive(false)
      document.body.classList.remove('is-resizing-panels')
      onDragEnd()
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [active, onDrag, onDragEnd])

  return <div className={`panel-resize-handle${active ? ' active' : ''}`} onMouseDown={handleMouseDown} />
}

export function ResizableLayout({
  showLeft,
  showRight,
  leftWidth,
  rightWidth,
  onLeftWidthChange,
  onRightWidthChange,
  left,
  center,
  right
}: ResizableLayoutProps) {
  const containerRef = useRef<HTMLDivElement>(null)

  const getMaxLeftWidth = useCallback(() => {
    const total = containerRef.current?.clientWidth ?? window.innerWidth
    const reservedRight = showRight ? rightWidth + 4 : 0
    return Math.min(MAX_SIDE_PANEL, total - reservedRight - MIN_EDITOR - 4)
  }, [rightWidth, showRight])

  const getMaxRightWidth = useCallback(() => {
    const total = containerRef.current?.clientWidth ?? window.innerWidth
    const reservedLeft = showLeft ? leftWidth + 4 : 0
    return Math.min(MAX_SIDE_PANEL, total - reservedLeft - MIN_EDITOR - 4)
  }, [leftWidth, showLeft])

  const handleLeftDrag = useCallback(
    (deltaX: number) => {
      onLeftWidthChange(clamp(leftWidth + deltaX, MIN_SIDE_PANEL, getMaxLeftWidth()))
    },
    [leftWidth, onLeftWidthChange, getMaxLeftWidth]
  )

  const handleRightDrag = useCallback(
    (deltaX: number) => {
      onRightWidthChange(clamp(rightWidth - deltaX, MIN_SIDE_PANEL, getMaxRightWidth()))
    },
    [rightWidth, onRightWidthChange, getMaxRightWidth]
  )

  return (
    <div className="main-content resizable-layout" ref={containerRef}>
      {showLeft && (
        <>
          <div className="panel file-tree-panel" style={{ width: leftWidth }}>
            {left}
          </div>
          <ResizeHandle onDrag={handleLeftDrag} onDragEnd={() => undefined} />
        </>
      )}

      <div className="panel editor-panel">{center}</div>

      {showRight && (
        <>
          <ResizeHandle onDrag={handleRightDrag} onDragEnd={() => undefined} />
          <div className="panel chat-panel-container" style={{ width: rightWidth }}>
            {right}
          </div>
        </>
      )}
    </div>
  )
}

export const PANEL_LAYOUT_DEFAULTS = {
  fileTreeWidth: 240,
  chatWidth: 360,
  terminalHeight: 220
}

export const PANEL_LAYOUT_LIMITS = {
  fileTree: { min: MIN_SIDE_PANEL, max: MAX_SIDE_PANEL },
  chat: { min: MIN_SIDE_PANEL, max: MAX_SIDE_PANEL }
}

export const TERMINAL_LAYOUT_LIMITS = {
  min: 100,
  max: 600
}
