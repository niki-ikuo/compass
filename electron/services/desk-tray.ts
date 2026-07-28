import { Tray, Menu, nativeImage, type BrowserWindow, type NativeImage } from 'electron'
import { getSettings } from './settings'
import { t } from '../../src/i18n/runtime'

let tray: Tray | null = null

export type DeskTrayCallbacks = {
  getMainWindow: () => BrowserWindow | null
  /** Start the normal quit confirm flow (unsaved tabs). */
  requestQuit: () => void
}

function resolveTrayImage(icon: string | NativeImage): NativeImage {
  if (typeof icon === 'string') {
    return nativeImage.createFromPath(icon)
  }
  return icon
}

export function destroyDeskTray(): void {
  if (!tray) return
  try {
    tray.destroy()
  } catch {
    // ignore
  }
  tray = null
}

export function showMainWindowFromTray(getMainWindow: () => BrowserWindow | null): void {
  const win = getMainWindow()
  if (!win || win.isDestroyed()) return
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}

/**
 * Create or destroy the Clip tray icon from settings.
 * When enabled, closing the window should hide (handled in main), not quit.
 */
export async function refreshDeskTray(
  icon: string | NativeImage,
  callbacks: DeskTrayCallbacks
): Promise<void> {
  const settings = await getSettings()
  if (!settings.deskTrayEnabled) {
    destroyDeskTray()
    return
  }

  const image = resolveTrayImage(icon)
  if (!tray) {
    tray = new Tray(image.isEmpty() && typeof icon === 'string' ? icon : image)
    tray.setToolTip('Compass')
    tray.on('click', () => {
      showMainWindowFromTray(callbacks.getMainWindow)
    })
    tray.on('double-click', () => {
      showMainWindowFromTray(callbacks.getMainWindow)
    })
  } else if (!image.isEmpty()) {
    tray.setImage(image)
  }

  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: t('desk.tray.show'),
        click: () => showMainWindowFromTray(callbacks.getMainWindow)
      },
      { type: 'separator' },
      {
        label: t('desk.tray.quit'),
        click: () => callbacks.requestQuit()
      }
    ])
  )
}

/** Pure helper for tests — whether close should hide instead of quit. */
export function shouldHideToTray(options: {
  deskTrayEnabled: boolean
  isAppQuitting: boolean
  allowWindowClose: boolean
}): boolean {
  if (options.allowWindowClose || options.isAppQuitting) return false
  return options.deskTrayEnabled
}
