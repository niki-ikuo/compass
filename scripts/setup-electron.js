/**
 * Electron バイナリが未インストールの場合にダウンロード・展開する。
 * Electron 42 以降はパッケージ自身の postinstall では取得しないため、
 * 同梱の install.js を実行する。
 */
const { spawnSync } = require('child_process')
const path = require('path')

const installScript = path.join(__dirname, '..', 'node_modules', 'electron', 'install.js')

const result = spawnSync(process.execPath, [installScript], { stdio: 'inherit' })

if (result.error) {
  console.error('[compass] Electron セットアップに失敗:', result.error.message)
  process.exit(1)
}

process.exit(result.status ?? 1)
