/**
 * Windows ビルドで exe にアプリアイコンを埋め込む。
 * signAndEditExecutable: false だと electron-builder がアイコン埋め込みを
 * スキップするため、afterPack で resedit により補完する。
 */
const fs = require('fs')
const path = require('path')
const { load: loadResEdit } = require('resedit/cjs')

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') {
    return
  }

  const ResEdit = await loadResEdit()
  const exeName = `${context.packager.appInfo.productFilename}.exe`
  const exePath = path.join(context.appOutDir, exeName)
  const iconPath = path.join(context.packager.projectDir, 'build', 'icon.ico')

  if (!fs.existsSync(exePath)) {
    throw new Error(`[after-pack] executable not found: ${exePath}`)
  }
  if (!fs.existsSync(iconPath)) {
    throw new Error(`[after-pack] icon not found: ${iconPath}`)
  }

  const exeData = fs.readFileSync(exePath)
  const exe = ResEdit.NtExecutable.from(exeData, { ignoreCert: true })
  const res = ResEdit.NtExecutableResource.from(exe)
  const iconFile = ResEdit.Data.IconFile.from(fs.readFileSync(iconPath))

  const iconGroups = ResEdit.Resource.IconGroupEntry.fromEntries(res.entries)
  if (iconGroups.length === 0) {
    throw new Error('[after-pack] no icon group found in executable')
  }

  for (const group of iconGroups) {
    ResEdit.Resource.IconGroupEntry.replaceIconsForResource(
      res.entries,
      group.id,
      group.lang,
      iconFile.icons.map((item) => item.data)
    )
  }

  res.outputResource(exe)
  fs.writeFileSync(exePath, Buffer.from(exe.generate()))
  console.log(`[after-pack] embedded icon into ${exeName}`)
}
