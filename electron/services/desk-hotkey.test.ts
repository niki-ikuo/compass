import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const register = vi.fn(() => true)
const unregister = vi.fn()
const captureClipboardToInbox = vi.fn()
const getSettings = vi.fn()
const getLastWorkspaceRoot = vi.fn()
const showMainWindowFromTray = vi.fn()

vi.mock('electron', () => ({
  globalShortcut: {
    register: (...args: unknown[]) => register.apply(null, args as never),
    unregister: (...args: unknown[]) => unregister.apply(null, args as never)
  },
  BrowserWindow: class {},
  Notification: Object.assign(
    class {
      show() {}
    },
    { isSupported: () => false }
  )
}))

vi.mock('./desk-capture', () => ({
  captureClipboardToInbox: (...args: unknown[]) =>
    captureClipboardToInbox.apply(null, args as never)
}))

vi.mock('./settings', () => ({
  getSettings: (...args: unknown[]) => getSettings.apply(null, args as never),
  getLastWorkspaceRoot: (...args: unknown[]) =>
    getLastWorkspaceRoot.apply(null, args as never)
}))

vi.mock('./desk-tray', () => ({
  showMainWindowFromTray: (...args: unknown[]) =>
    showMainWindowFromTray.apply(null, args as never)
}))

import {
  refreshDeskCaptureHotkey,
  refreshDeskHotkeys,
  refreshDeskShowHotkey,
  runDeskCaptureFromHotkey,
  runDeskShowFromHotkey,
  unregisterDeskHotkeys
} from './desk-hotkey'

describe('desk-hotkey', () => {
  beforeEach(() => {
    register.mockReset()
    register.mockReturnValue(true)
    unregister.mockReset()
    captureClipboardToInbox.mockReset()
    getSettings.mockReset()
    getLastWorkspaceRoot.mockReset()
    showMainWindowFromTray.mockReset()
    unregisterDeskHotkeys()
  })

  afterEach(() => {
    unregisterDeskHotkeys()
  })

  it('does not capture when deskCaptureEnabled is false', async () => {
    getSettings.mockResolvedValue({
      deskCaptureEnabled: false,
      deskCaptureAccelerator: 'CommandOrControl+Alt+I',
      deskCaptureOpenTarget: 'file',
      deskShowEnabled: false,
      deskShowAccelerator: 'CommandOrControl+Alt+C'
    })
    await runDeskCaptureFromHotkey(() => null)
    expect(captureClipboardToInbox).not.toHaveBeenCalled()
    expect(getLastWorkspaceRoot).not.toHaveBeenCalled()
  })

  it('unregisters and reports disabled without registering', async () => {
    getSettings.mockResolvedValue({
      deskCaptureEnabled: false,
      deskCaptureAccelerator: 'CommandOrControl+Alt+I',
      deskCaptureOpenTarget: 'file',
      deskShowEnabled: false,
      deskShowAccelerator: 'CommandOrControl+Alt+C'
    })
    const status = await refreshDeskCaptureHotkey(() => null)
    expect(status.enabled).toBe(false)
    expect(status.ok).toBe(true)
    expect(register).not.toHaveBeenCalled()
  })

  it('registers accelerator when enabled', async () => {
    getSettings.mockResolvedValue({
      deskCaptureEnabled: true,
      deskCaptureAccelerator: 'CommandOrControl+Alt+I',
      deskCaptureOpenTarget: 'file',
      deskShowEnabled: false,
      deskShowAccelerator: 'CommandOrControl+Alt+C'
    })
    const status = await refreshDeskCaptureHotkey(() => null)
    expect(status.enabled).toBe(true)
    expect(status.ok).toBe(true)
    expect(register).toHaveBeenCalledWith('CommandOrControl+Alt+I', expect.any(Function))
  })

  it('registers show hotkey when enabled', async () => {
    getSettings.mockResolvedValue({
      deskCaptureEnabled: false,
      deskCaptureAccelerator: 'CommandOrControl+Alt+I',
      deskCaptureOpenTarget: 'file',
      deskShowEnabled: true,
      deskShowAccelerator: 'CommandOrControl+Alt+C'
    })
    const status = await refreshDeskShowHotkey(() => null)
    expect(status.enabled).toBe(true)
    expect(status.ok).toBe(true)
    expect(register).toHaveBeenCalledWith('CommandOrControl+Alt+C', expect.any(Function))
  })

  it('rejects show hotkey when it duplicates capture', async () => {
    getSettings.mockResolvedValue({
      deskCaptureEnabled: true,
      deskCaptureAccelerator: 'CommandOrControl+Alt+I',
      deskCaptureOpenTarget: 'file',
      deskShowEnabled: true,
      deskShowAccelerator: 'CommandOrControl+Alt+I'
    })
    const { show } = await refreshDeskHotkeys(() => null)
    expect(show.ok).toBe(false)
    expect(show.reason).toBe('duplicate')
    expect(register).toHaveBeenCalledTimes(1)
    expect(register).toHaveBeenCalledWith('CommandOrControl+Alt+I', expect.any(Function))
  })

  it('show hotkey focuses the main window', () => {
    const getMainWindow = () => null
    runDeskShowFromHotkey(getMainWindow)
    expect(showMainWindowFromTray).toHaveBeenCalledWith(getMainWindow)
  })
})
