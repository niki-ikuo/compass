import { describe, expect, it } from 'vitest'
import {
  PANEL_LAYOUT_DEFAULTS,
  ratioFromPixelWidth,
  REFERENCE_LAYOUT_WIDTH,
  resolveProportionalPanelWidths
} from './proportional-panel-widths'

describe('resolveProportionalPanelWidths', () => {
  it('scales side panels proportionally with container width', () => {
    const wide = resolveProportionalPanelWidths({
      containerWidth: REFERENCE_LAYOUT_WIDTH,
      showLeft: true,
      showRight: true,
      leftRatio: PANEL_LAYOUT_DEFAULTS.fileTreeWidthRatio,
      rightRatio: PANEL_LAYOUT_DEFAULTS.chatWidthRatio
    })

    const narrow = resolveProportionalPanelWidths({
      containerWidth: 800,
      showLeft: true,
      showRight: true,
      leftRatio: PANEL_LAYOUT_DEFAULTS.fileTreeWidthRatio,
      rightRatio: PANEL_LAYOUT_DEFAULTS.chatWidthRatio
    })

    expect(wide.leftWidth).toBe(240)
    expect(wide.rightWidth).toBe(360)
    expect(narrow.leftWidth).toBeLessThan(wide.leftWidth)
    expect(narrow.rightWidth).toBeLessThan(wide.rightWidth)
    expect(narrow.leftWidth / narrow.rightWidth).toBeCloseTo(wide.leftWidth / wide.rightWidth, 1)
  })

  it('keeps enough space for the editor when the window is narrow', () => {
    const resolved = resolveProportionalPanelWidths({
      containerWidth: 520,
      showLeft: true,
      showRight: true,
      leftRatio: PANEL_LAYOUT_DEFAULTS.fileTreeWidthRatio,
      rightRatio: PANEL_LAYOUT_DEFAULTS.chatWidthRatio
    })

    expect(resolved.leftWidth + resolved.rightWidth + 8 + 200).toBeLessThanOrEqual(520)
  })
})

describe('ratioFromPixelWidth', () => {
  it('converts dragged pixel widths into ratios', () => {
    expect(ratioFromPixelWidth(240, 1280)).toBeCloseTo(0.1875)
  })
})
