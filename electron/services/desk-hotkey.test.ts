import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const register = vi.fn(() => true)
const unregister = vi.fn()
const captureClipboardToInbox = vi.fn()
const getSettings = vi.fn()
const getLastWorkspaceRoot = vi.fn()

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

import {
  refreshDeskCaptureHotkey,
  runDeskCaptureFromHotkey,
  unregisterDeskCaptureHotkey
} from './desk-hotkey'

describe('desk-hotkey', () => {
  beforeEach(() => {
    register.mockReset()
    register.mockReturnValue(true)
    unregister.mockReset()
    captureClipboardToInbox.mockReset()
    getSettings.mockReset()
    getLastWorkspaceRoot.mockReset()
    unregisterDeskCaptureHotkey()
  })

  afterEach(() => {
    unregisterDeskCaptureHotkey()
  })

  it('does not capture when deskCaptureEnabled is false', async () => {
    getSettings.mockResolvedValue({
      deskCaptureEnabled: false,
      deskCaptureAccelerator: 'CommandOrControl+Alt+I',
      deskCaptureOpenTarget: 'file'
    })
    await runDeskCaptureFromHotkey(() => null)
    expect(captureClipboardToInbox).not.toHaveBeenCalled()
    expect(getLastWorkspaceRoot).not.toHaveBeenCalled()
  })

  it('unregisters and reports disabled without registering', async () => {
    getSettings.mockResolvedValue({
      deskCaptureEnabled: false,
      deskCaptureAccelerator: 'CommandOrControl+Alt+I',
      deskCaptureOpenTarget: 'file'
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
      deskCaptureOpenTarget: 'file'
    })
    const status = await refreshDeskCaptureHotkey(() => null)
    expect(status.enabled).toBe(true)
    expect(status.ok).toBe(true)
    expect(register).toHaveBeenCalledWith('CommandOrControl+Alt+I', expect.any(Function))
  })
})
