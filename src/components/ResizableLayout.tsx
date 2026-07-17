import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode
} from 'react'
import {
  MAX_SIDE_PANEL,
  MIN_EDITOR,
  MIN_SIDE_PANEL,
  PANEL_HANDLE_WIDTH,
  ratioFromPixelWidth
} from '@/utils/proportional-panel-widths'

interface ResizableLayoutProps {
  showLeft: boolean
  showRight: boolean
  leftRatio: number
  rightRatio: number
  onLeftRatioChange: (ratio: number) => void
  onRightRatioChange: (ratio: number) => void
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
  onDrag: (clientX: number) => void
  onDragEnd: () => void
}) {
  const [active, setActive] = useState(false)

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault()
    setActive(true)
    document.body.classList.add('is-resizing-panels')
  }

  useEffect(() => {
    if (!active) return

    const handleMouseMove = (e: MouseEvent) => {
      onDrag(e.clientX)
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

function sidePanelStyle(ratio: number): CSSProperties {
  return {
    width: `${ratio * 100}%`,
    minWidth: MIN_SIDE_PANEL,
    maxWidth: MAX_SIDE_PANEL
  }
}

export function ResizableLayout({
  showLeft,
  showRight,
  leftRatio,
  rightRatio,
  onLeftRatioChange,
  onRightRatioChange,
  left,
  center,
  right
}: ResizableLayoutProps) {
  const containerRef = useRef<HTMLDivElement>(null)

  const handleLeftDrag = useCallback(
    (clientX: number) => {
      const container = containerRef.current
      if (!container) return

      const rect = container.getBoundingClientRect()
      if (rect.width <= 0) return

      const handleSpace = PANEL_HANDLE_WIDTH + (showRight ? PANEL_HANDLE_WIDTH : 0)
      const maxWidth = Math.max(
        MIN_SIDE_PANEL,
        rect.width - handleSpace - (showRight ? rightRatio * rect.width : 0) - MIN_EDITOR
      )
      const nextWidth = clamp(clientX - rect.left, MIN_SIDE_PANEL, Math.min(MAX_SIDE_PANEL, maxWidth))
      onLeftRatioChange(ratioFromPixelWidth(nextWidth, rect.width))
    },
    [onLeftRatioChange, rightRatio, showRight]
  )

  const handleRightDrag = useCallback(
    (clientX: number) => {
      const container = containerRef.current
      if (!container) return

      const rect = container.getBoundingClientRect()
      if (rect.width <= 0) return

      const handleSpace = PANEL_HANDLE_WIDTH + (showLeft ? PANEL_HANDLE_WIDTH : 0)
      const maxWidth = Math.max(
        MIN_SIDE_PANEL,
        rect.width - handleSpace - (showLeft ? leftRatio * rect.width : 0) - MIN_EDITOR
      )
      const nextWidth = clamp(rect.right - clientX, MIN_SIDE_PANEL, Math.min(MAX_SIDE_PANEL, maxWidth))
      onRightRatioChange(ratioFromPixelWidth(nextWidth, rect.width))
    },
    [leftRatio, onRightRatioChange, showLeft]
  )

  return (
    <div className="main-content resizable-layout" ref={containerRef}>
      {showLeft && (
        <>
          <div className="panel file-tree-panel" style={sidePanelStyle(leftRatio)}>
            {left}
          </div>
          <ResizeHandle onDrag={handleLeftDrag} onDragEnd={() => undefined} />
        </>
      )}

      <div className="panel editor-panel">{center}</div>

      {showRight && (
        <>
          <ResizeHandle onDrag={handleRightDrag} onDragEnd={() => undefined} />
          <div className="panel chat-panel-container" style={sidePanelStyle(rightRatio)}>
            {right}
          </div>
        </>
      )}
    </div>
  )
}

export {
  PANEL_LAYOUT_DEFAULTS,
  PANEL_LAYOUT_LIMITS,
  TERMINAL_LAYOUT_LIMITS
} from '@/utils/proportional-panel-widths'
