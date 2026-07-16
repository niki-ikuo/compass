import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import {
  getMaxLeftWidth,
  getMaxRightWidth,
  MIN_SIDE_PANEL,
  PANEL_HANDLE_WIDTH,
  ratioFromPixelWidth,
  resolveProportionalPanelWidths
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
  leftRatio,
  rightRatio,
  onLeftRatioChange,
  onRightRatioChange,
  left,
  center,
  right
}: ResizableLayoutProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [containerWidth, setContainerWidth] = useState(0)

  useEffect(() => {
    const element = containerRef.current
    if (!element) return

    const updateWidth = () => {
      setContainerWidth(element.clientWidth)
    }

    updateWidth()
    const resizeObserver = new ResizeObserver(updateWidth)
    resizeObserver.observe(element)
    return () => resizeObserver.disconnect()
  }, [])

  const { leftWidth, rightWidth } = resolveProportionalPanelWidths({
    containerWidth,
    showLeft,
    showRight,
    leftRatio,
    rightRatio
  })

  const handleLeftDrag = useCallback(
    (deltaX: number) => {
      if (containerWidth <= 0) return
      const nextWidth = clamp(
        leftWidth + deltaX,
        MIN_SIDE_PANEL,
        getMaxLeftWidth(containerWidth, showRight, rightWidth)
      )
      onLeftRatioChange(ratioFromPixelWidth(nextWidth, containerWidth))
    },
    [containerWidth, leftWidth, onLeftRatioChange, rightWidth, showRight]
  )

  const handleRightDrag = useCallback(
    (deltaX: number) => {
      if (containerWidth <= 0) return
      const nextWidth = clamp(
        rightWidth - deltaX,
        MIN_SIDE_PANEL,
        getMaxRightWidth(containerWidth, showLeft, leftWidth)
      )
      onRightRatioChange(ratioFromPixelWidth(nextWidth, containerWidth))
    },
    [containerWidth, leftWidth, onRightRatioChange, rightWidth, showLeft]
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

export {
  PANEL_LAYOUT_DEFAULTS,
  PANEL_LAYOUT_LIMITS,
  TERMINAL_LAYOUT_LIMITS
} from '@/utils/proportional-panel-widths'
