import { useCallback, useEffect, useState } from 'react'
import { basename } from '@/utils/path'
import { useI18n } from '@/i18n'

interface WorkspaceWelcomeProps {
  onOpenFolder: () => void
  onOpenRecent: (folder: string) => Promise<void>
}

export function WorkspaceWelcome({ onOpenFolder, onOpenRecent }: WorkspaceWelcomeProps) {
  const { t } = useI18n()
  const [recentFolders, setRecentFolders] = useState<string[]>([])
  const [openingPath, setOpeningPath] = useState<string | null>(null)

  const loadRecentFolders = useCallback(async () => {
    const recent = await window.compass.workspace.getRecent()
    setRecentFolders(recent)
  }, [])

  useEffect(() => {
    void loadRecentFolders()
  }, [loadRecentFolders])

  const handleOpenRecent = async (folder: string) => {
    if (openingPath) return
    setOpeningPath(folder)
    try {
      await onOpenRecent(folder)
    } catch {
      await window.compass.workspace.removeRecent(folder)
      await loadRecentFolders()
    } finally {
      setOpeningPath(null)
    }
  }

  return (
    <div className="workspace-welcome">
      <div className="workspace-welcome-content">
        <img className="workspace-welcome-icon" src="/icon.svg" alt="" width={72} height={72} />
        <h2>Compass</h2>
        <p className="workspace-welcome-lead">{t('welcome.lead')}</p>

        <button type="button" className="workspace-welcome-open-btn" onClick={onOpenFolder}>
          {t('welcome.openFolder')}
        </button>
        <p className="workspace-welcome-shortcut">Ctrl+O</p>

        {recentFolders.length > 0 && (
          <section className="workspace-welcome-recent">
            <h3>{t('welcome.recent')}</h3>
            <ul className="workspace-welcome-list">
              {recentFolders.map((folder) => (
                <li key={folder}>
                  <button
                    type="button"
                    className="workspace-welcome-item"
                    onClick={() => void handleOpenRecent(folder)}
                    disabled={openingPath !== null}
                  >
                    <span className="workspace-welcome-item-name">{basename(folder)}</span>
                    <span className="workspace-welcome-item-path">{folder}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  )
}
