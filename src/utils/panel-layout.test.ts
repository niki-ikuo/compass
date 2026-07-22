import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  loadPanelLayout,
  PANEL_VISIBILITY_DEFAULTS,
  savePanelLayout,
  toPersistedPanelLayout
} from '@/utils/panel-layout'
import { PANEL_LAYOUT_DEFAULTS } from '@/utils/proportional-panel-widths'

const STORAGE_KEY = 'compass-panel-layout'

function installLocalStorageMock(): Map<string, string> {
  const store = new Map<string, string>()
  const localStorageMock = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value)
    },
    removeItem: (key: string) => {
      store.delete(key)
    },
    clear: () => {
      store.clear()
    }
  }
  vi.stubGlobal('localStorage', localStorageMock)
  return store
}

describe('panel-layout', () => {
  let store: Map<string, string>

  beforeEach(() => {
    store = installLocalStorageMock()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns defaults when nothing is stored', () => {
    expect(loadPanelLayout()).toEqual({
      ...PANEL_LAYOUT_DEFAULTS,
      ...PANEL_VISIBILITY_DEFAULTS
    })
  })

  it('persists and restores panel visibility', () => {
    savePanelLayout({
      ...PANEL_LAYOUT_DEFAULTS,
      showFileTree: false,
      showChat: false,
      showTerminal: true
    })

    expect(loadPanelLayout()).toMatchObject({
      showFileTree: false,
      showChat: false,
      showTerminal: true
    })
  })

  it('keeps size ratios when restoring visibility', () => {
    const layout = {
      fileTreeWidthRatio: 0.2,
      chatWidthRatio: 0.3,
      terminalHeight: 300,
      showFileTree: false,
      showChat: true,
      showTerminal: true
    }
    savePanelLayout(layout)
    expect(loadPanelLayout()).toEqual(layout)
  })

  it('defaults missing visibility flags for legacy size-only storage', () => {
    store.set(
      STORAGE_KEY,
      JSON.stringify({
        fileTreeWidthRatio: 0.25,
        chatWidthRatio: 0.35,
        terminalHeight: 240
      })
    )

    expect(loadPanelLayout()).toMatchObject({
      fileTreeWidthRatio: 0.25,
      chatWidthRatio: 0.35,
      terminalHeight: 240,
      ...PANEL_VISIBILITY_DEFAULTS
    })
  })

  it('ignores invalid visibility values', () => {
    store.set(
      STORAGE_KEY,
      JSON.stringify({
        ...PANEL_LAYOUT_DEFAULTS,
        showFileTree: 'yes',
        showChat: 1,
        showTerminal: null
      })
    )

    expect(loadPanelLayout()).toMatchObject(PANEL_VISIBILITY_DEFAULTS)
  })

  it('returns defaults when stored JSON is invalid', () => {
    store.set(STORAGE_KEY, '{not-json')
    expect(loadPanelLayout()).toEqual({
      ...PANEL_LAYOUT_DEFAULTS,
      ...PANEL_VISIBILITY_DEFAULTS
    })
  })

  it('toPersistedPanelLayout merges sizes and visibility', () => {
    expect(
      toPersistedPanelLayout(
        {
          fileTreeWidthRatio: 0.1,
          chatWidthRatio: 0.2,
          terminalHeight: 180
        },
        {
          showFileTree: false,
          showChat: true,
          showTerminal: true
        }
      )
    ).toEqual({
      fileTreeWidthRatio: 0.1,
      chatWidthRatio: 0.2,
      terminalHeight: 180,
      showFileTree: false,
      showChat: true,
      showTerminal: true
    })
  })

  it('swallows localStorage write errors', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: () => {
        throw new Error('quota')
      },
      removeItem: () => undefined,
      clear: () => undefined
    })
    expect(() =>
      savePanelLayout({
        ...PANEL_LAYOUT_DEFAULTS,
        ...PANEL_VISIBILITY_DEFAULTS
      })
    ).not.toThrow()
  })
})
