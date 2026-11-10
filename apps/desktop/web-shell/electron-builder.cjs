const updateUrl = new URL(process.env.ZHILIU_UPDATE_URL ?? 'https://dev.echoai.best/desktop-updates/windows/x64/')
process.env.ELECTRON_BUILDER_NSIS_EXTRACT_UNINSTALLER = '1'
if (updateUrl.protocol !== 'https:' || updateUrl.username || updateUrl.password || updateUrl.search || updateUrl.hash) {
  throw new Error('ZHILIU_UPDATE_URL must be an HTTPS directory without credentials, query or fragment')
}
if (!updateUrl.pathname.endsWith('/')) updateUrl.pathname += '/'

module.exports = {
  appId: 'com.echoai.zhiliu.desktop',
  productName: '织流',
  directories: { output: '../.desktop-build/zhiliu-web-shell' },
  files: ['main.cjs', 'preload.cjs', 'updater.cjs', 'update-ipc.cjs', 'skin.js', 'skin.css', 'assets/**', 'package.json'],
  asar: true,
  npmRebuild: false,
  artifactName: 'Zhiliu-Setup-${version}-${arch}.${ext}',
  win: {
    target: [{ target: 'nsis', arch: ['x64'] }],
    icon: 'assets/zhiliu-icon.ico',
    ...(process.env.ZHILIU_PUBLISHER_NAME ? { publisherName: process.env.ZHILIU_PUBLISHER_NAME } : {}),
  },
  nsis: {
    oneClick: false,
    perMachine: false,
    allowToChangeInstallationDirectory: true,
    shortcutName: '织流',
    deleteAppDataOnUninstall: false,
  },
  publish: [{ provider: 'generic', url: updateUrl.href, channel: 'latest', useMultipleRangeRequest: false }],
}
