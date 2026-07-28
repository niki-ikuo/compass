import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  Tray: class {
    setToolTip() {}
    setContextMenu() {}
    setImage() {}
    on() {}
    destroy() {}
  },
  Menu: { buildFromTemplate: () => ({}) },
  nativeImage: {
    createFromPath: () => ({ isEmpty: () => true })
  }
}))

vi.mock('./settings', () => ({
  getSettings: vi.fn(async () => ({ deskTrayEnabled: true }))
}))

vi.mock('../../src/i18n/runtime', () => ({
  t: (key: string) => key
}))

import { shouldHideToTray } from './desk-tray'

describe('shouldHideToTray', () => {
  it('hides when tray is enabled and user is not quitting', () => {
    expect(
      shouldHideToTray({
        deskTrayEnabled: true,
        isAppQuitting: false,
        allowWindowClose: false
      })
    ).toBe(true)
  })

  it('does not hide when tray is disabled', () => {
    expect(
      shouldHideToTray({
        deskTrayEnabled: false,
        isAppQuitting: false,
        allowWindowClose: false
      })
    ).toBe(false)
  })

  it('does not hide during quit or allowed close', () => {
    expect(
      shouldHideToTray({
        deskTrayEnabled: true,
        isAppQuitting: true,
        allowWindowClose: false
      })
    ).toBe(false)
    expect(
      shouldHideToTray({
        deskTrayEnabled: true,
        isAppQuitting: false,
        allowWindowClose: true
      })
    ).toBe(false)
  })
})
