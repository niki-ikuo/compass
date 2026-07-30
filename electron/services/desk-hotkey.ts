import { globalShortcut, BrowserWindow, Notification } from 'electron'
import type { DeskCaptureOpenTarget, DeskCaptureHotkeyStatus } from '../../src/types'
import { captureClipboardToInbox } from './desk-capture'
import { getLastWorkspaceRoot, getSettings } from './settings'
import { showMainWindowFromTray } from './desk-tray'
import { t } from '../../src/i18n/runtime'

const DEFAULT_CAPTURE_ACCELERATOR = 'CommandOrControl+Alt+I'
const DEFAULT_SHOW_ACCELERATOR = 'CommandOrControl+Alt+C'

let registeredCaptureAccelerator: string | null = null
let registeredShowAccelerator: string | null = null

let lastCaptureHotkeyStatus: DeskCaptureHotkeyStatus = {
  ok: true,
  accelerator: DEFAULT_CAPTURE_ACCELERATOR,
  enabled: true
}

let lastShowHotkeyStatus: DeskCaptureHotkeyStatus = {
  ok: true,
  accelerator: DEFAULT_SHOW_ACCELERATOR,
  enabled: false
}

export function getDefaultDeskCaptureAccelerator(): string {
  return DEFAULT_CAPTURE_ACCELERATOR
}

export function getDefaultDeskShowAccelerator(): string {
  return DEFAULT_SHOW_ACCELERATOR
}

export function getDeskCaptureHotkeyStatus(): DeskCaptureHotkeyStatus {
  return { ...lastCaptureHotkeyStatus }
}

export function getDeskShowHotkeyStatus(): DeskCaptureHotkeyStatus {
  return { ...lastShowHotkeyStatus }
}

function normalizeAcceleratorKey(accelerator: string): string {
  return accelerator.trim().toLowerCase()
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

export function runDeskShowFromHotkey(getMainWindow: () => BrowserWindow | null): void {
  showMainWindowFromTray(getMainWindow)
}

export function unregisterDeskCaptureHotkey(): void {
  if (registeredCaptureAccelerator) {
    try {
      globalShortcut.unregister(registeredCaptureAccelerator)
    } catch {
      // ignore
    }
    registeredCaptureAccelerator = null
  }
}

export function unregisterDeskShowHotkey(): void {
  if (registeredShowAccelerator) {
    try {
      globalShortcut.unregister(registeredShowAccelerator)
    } catch {
      // ignore
    }
    registeredShowAccelerator = null
  }
}

export function unregisterDeskHotkeys(): void {
  unregisterDeskCaptureHotkey()
  unregisterDeskShowHotkey()
}

export async function refreshDeskCaptureHotkey(
  getMainWindow: () => BrowserWindow | null
): Promise<DeskCaptureHotkeyStatus> {
  unregisterDeskCaptureHotkey()
  const settings = await getSettings()
  const accelerator = (settings.deskCaptureAccelerator || DEFAULT_CAPTURE_ACCELERATOR).trim()
  if (!settings.deskCaptureEnabled) {
    lastCaptureHotkeyStatus = { ok: true, accelerator, enabled: false }
    return lastCaptureHotkeyStatus
  }
  try {
    const ok = globalShortcut.register(accelerator, () => {
      void runDeskCaptureFromHotkey(getMainWindow)
    })
    if (!ok) {
      lastCaptureHotkeyStatus = {
        ok: false,
        accelerator,
        enabled: true,
        reason: 'conflict',
        error: t('desk.capture.hotkeyFailed', { accelerator })
      }
      return lastCaptureHotkeyStatus
    }
    registeredCaptureAccelerator = accelerator
    lastCaptureHotkeyStatus = { ok: true, accelerator, enabled: true }
    return lastCaptureHotkeyStatus
  } catch {
    // Electron throws English errors for invalid accelerators — never surface raw text.
    lastCaptureHotkeyStatus = {
      ok: false,
      accelerator,
      enabled: true,
      reason: 'invalid',
      error: t('desk.capture.hotkeyInvalid', { accelerator })
    }
    return lastCaptureHotkeyStatus
  }
}

export async function refreshDeskShowHotkey(
  getMainWindow: () => BrowserWindow | null
): Promise<DeskCaptureHotkeyStatus> {
  unregisterDeskShowHotkey()
  const settings = await getSettings()
  const accelerator = (settings.deskShowAccelerator || DEFAULT_SHOW_ACCELERATOR).trim()
  if (!settings.deskShowEnabled) {
    lastShowHotkeyStatus = { ok: true, accelerator, enabled: false }
    return lastShowHotkeyStatus
  }

  const captureAccelerator = (settings.deskCaptureAccelerator || DEFAULT_CAPTURE_ACCELERATOR).trim()
  if (
    settings.deskCaptureEnabled &&
    normalizeAcceleratorKey(accelerator) === normalizeAcceleratorKey(captureAccelerator)
  ) {
    lastShowHotkeyStatus = {
      ok: false,
      accelerator,
      enabled: true,
      reason: 'duplicate',
      error: t('desk.show.hotkeyDuplicate', { accelerator })
    }
    return lastShowHotkeyStatus
  }

  try {
    const ok = globalShortcut.register(accelerator, () => {
      runDeskShowFromHotkey(getMainWindow)
    })
    if (!ok) {
      lastShowHotkeyStatus = {
        ok: false,
        accelerator,
        enabled: true,
        reason: 'conflict',
        error: t('desk.show.hotkeyFailed', { accelerator })
      }
      return lastShowHotkeyStatus
    }
    registeredShowAccelerator = accelerator
    lastShowHotkeyStatus = { ok: true, accelerator, enabled: true }
    return lastShowHotkeyStatus
  } catch {
    lastShowHotkeyStatus = {
      ok: false,
      accelerator,
      enabled: true,
      reason: 'invalid',
      error: t('desk.show.hotkeyInvalid', { accelerator })
    }
    return lastShowHotkeyStatus
  }
}

/** Unregister and re-register capture + show hotkeys (show after capture for duplicate check). */
export async function refreshDeskHotkeys(
  getMainWindow: () => BrowserWindow | null
): Promise<{
  capture: DeskCaptureHotkeyStatus
  show: DeskCaptureHotkeyStatus
}> {
  unregisterDeskHotkeys()
  const capture = await refreshDeskCaptureHotkey(getMainWindow)
  const show = await refreshDeskShowHotkey(getMainWindow)
  return { capture, show }
}
