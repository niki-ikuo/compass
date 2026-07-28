import { globalShortcut, BrowserWindow, Notification } from 'electron'
import type { DeskCaptureOpenTarget } from '../../src/types'
import { captureClipboardToInbox } from './desk-capture'
import { getLastWorkspaceRoot, getSettings } from './settings'
import { t } from '../../src/i18n/runtime'

const DEFAULT_ACCELERATOR = 'CommandOrControl+Alt+I'

let registeredAccelerator: string | null = null
let lastHotkeyStatus: {
  ok: boolean
  accelerator: string
  enabled: boolean
  error?: string
  reason?: 'conflict' | 'invalid'
} = {
  ok: true,
  accelerator: DEFAULT_ACCELERATOR,
  enabled: true
}

export function getDefaultDeskCaptureAccelerator(): string {
  return DEFAULT_ACCELERATOR
}

export function getDeskCaptureHotkeyStatus(): {
  ok: boolean
  accelerator: string
  enabled: boolean
  error?: string
  reason?: 'conflict' | 'invalid'
} {
  return { ...lastHotkeyStatus }
}

function notify(title: string, body: string): void {
  try {
    if (Notification.isSupported()) {
      new Notification({ title, body }).show()
    }
  } catch {
    // ignore
  }
}

export async function runDeskCaptureFromHotkey(
  getMainWindow: () => BrowserWindow | null
): Promise<void> {
  const settings = await getSettings()
  if (!settings.deskCaptureEnabled) return

  const workspaceRoot = await getLastWorkspaceRoot()
  const result = await captureClipboardToInbox(workspaceRoot)
  const win = getMainWindow()

  if (!result.ok) {
    notify(t('desk.capture.notifyFailTitle'), result.message)
    if (win && !win.isDestroyed()) {
      win.webContents.send('desk:captureResult', result)
    }
    return
  }

  notify(t('desk.capture.notifyOkTitle'), t('desk.capture.notifyOk'))
  if (win && !win.isDestroyed()) {
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
    win.webContents.send('desk:captureResult', {
      ok: true as const,
      absolutePath: result.absolutePath,
      relativePath: result.relativePath,
      openTarget: settings.deskCaptureOpenTarget as DeskCaptureOpenTarget
    })
  }
}

export function unregisterDeskCaptureHotkey(): void {
  if (registeredAccelerator) {
    try {
      globalShortcut.unregister(registeredAccelerator)
    } catch {
      // ignore
    }
    registeredAccelerator = null
  }
}

export async function refreshDeskCaptureHotkey(
  getMainWindow: () => BrowserWindow | null
): Promise<{
  ok: boolean
  accelerator: string
  enabled: boolean
  error?: string
  reason?: 'conflict' | 'invalid'
}> {
  unregisterDeskCaptureHotkey()
  const settings = await getSettings()
  const accelerator = (settings.deskCaptureAccelerator || DEFAULT_ACCELERATOR).trim()
  if (!settings.deskCaptureEnabled) {
    lastHotkeyStatus = { ok: true, accelerator, enabled: false }
    return lastHotkeyStatus
  }
  try {
    const ok = globalShortcut.register(accelerator, () => {
      void runDeskCaptureFromHotkey(getMainWindow)
    })
    if (!ok) {
      lastHotkeyStatus = {
        ok: false,
        accelerator,
        enabled: true,
        reason: 'conflict',
        error: t('desk.capture.hotkeyFailed', { accelerator })
      }
      return lastHotkeyStatus
    }
    registeredAccelerator = accelerator
    lastHotkeyStatus = { ok: true, accelerator, enabled: true }
    return lastHotkeyStatus
  } catch {
    // Electron throws English errors for invalid accelerators — never surface raw text.
    lastHotkeyStatus = {
      ok: false,
      accelerator,
      enabled: true,
      reason: 'invalid',
      error: t('desk.capture.hotkeyInvalid', { accelerator })
    }
    return lastHotkeyStatus
  }
}
