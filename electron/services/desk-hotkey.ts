import { globalShortcut, BrowserWindow, Notification } from 'electron'
import type { DeskCaptureOpenTarget } from '../../src/types'
import { captureClipboardToInbox } from './desk-capture'
import { getLastWorkspaceRoot, getSettings } from './settings'
import { t } from '../../src/i18n/runtime'

const DEFAULT_ACCELERATOR = 'CommandOrControl+Alt+I'

let registeredAccelerator: string | null = null

export function getDefaultDeskCaptureAccelerator(): string {
  return DEFAULT_ACCELERATOR
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
    notify(t('desk.capture.notifyTitle'), result.message)
    if (win && !win.isDestroyed()) {
      win.webContents.send('desk:captureResult', result)
    }
    return
  }

  notify(t('desk.capture.notifyTitle'), t('desk.capture.notifyOk'))
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
): Promise<{ ok: boolean; accelerator: string; error?: string }> {
  unregisterDeskCaptureHotkey()
  const settings = await getSettings()
  const accelerator = (settings.deskCaptureAccelerator || DEFAULT_ACCELERATOR).trim()
  if (!settings.deskCaptureEnabled) {
    return { ok: true, accelerator }
  }
  try {
    const ok = globalShortcut.register(accelerator, () => {
      void runDeskCaptureFromHotkey(getMainWindow)
    })
    if (!ok) {
      return {
        ok: false,
        accelerator,
        error: t('desk.capture.hotkeyFailed', { accelerator })
      }
    }
    registeredAccelerator = accelerator
    return { ok: true, accelerator }
  } catch (error) {
    return {
      ok: false,
      accelerator,
      error: error instanceof Error ? error.message : String(error)
    }
  }
}
