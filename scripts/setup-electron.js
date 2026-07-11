/**
 * Electron バイナリが未インストールの場合にダウンロード・展開する。
 * npm install 時に postinstall で実行される。
 */
const fs = require('fs')
const path = require('path')
const { downloadArtifact } = require('@electron/get')
const extract = require('extract-zip')

const electronDir = path.join(__dirname, '..', 'node_modules', 'electron')
const distPath = path.join(electronDir, 'dist')
const exePath = path.join(distPath, process.platform === 'win32' ? 'electron.exe' : 'electron')

async function main() {
  if (fs.existsSync(exePath)) {
    return
  }

  const pkg = require(path.join(electronDir, 'package.json'))
  const version = pkg.version

  console.log(`[compass] Electron バイナリを取得中 (v${version})...`)

  const zipPath = await downloadArtifact({
    version,
    artifactName: 'electron',
    platform: process.platform,
    arch: process.arch
  })

  fs.rmSync(distPath, { recursive: true, force: true })
  fs.mkdirSync(distPath, { recursive: true })
  await extract(zipPath, { dir: path.resolve(distPath) })

  const platformPath = process.platform === 'win32' ? 'electron.exe' : 'electron'
  fs.writeFileSync(path.join(electronDir, 'path.txt'), platformPath)
  fs.writeFileSync(path.join(distPath, 'version'), `v${version}`)

  console.log('[compass] Electron バイナリの準備が完了しました')
}

main().catch((err) => {
  console.error('[compass] Electron セットアップに失敗:', err.message)
  process.exit(1)
})
