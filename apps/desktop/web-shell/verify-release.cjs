const fs = require('node:fs')
const path = require('node:path')
const { createHash } = require('node:crypto')
const { createRequire } = require('node:module')
const updaterRequire = createRequire(require.resolve('electron-updater'))
const { load } = updaterRequire('js-yaml')

function verify(directory) {
  const manifest = load(fs.readFileSync(path.join(directory, 'latest.yml'), 'utf8'))
  const filename = `Zhiliu-Setup-${manifest.version}-x64.exe`
  if (!/^\d+\.\d+\.\d+$/u.test(manifest.version) || manifest.path !== filename || manifest.files?.length !== 1) {
    throw new Error('Expected one stable Windows x64 installer')
  }
  const entry = manifest.files[0]
  const installer = fs.readFileSync(path.join(directory, filename))
  const sha512 = createHash('sha512').update(installer).digest('base64')
  if (entry.url !== filename || entry.size !== installer.length || entry.sha512 !== sha512 || manifest.sha512 !== sha512) {
    throw new Error('Installer size or SHA512 does not match latest.yml')
  }
  if (!fs.statSync(path.join(directory, `${filename}.blockmap`)).isFile()) throw new Error('Missing blockmap')
  return { version: manifest.version, filename, size: installer.length, sha512 }
}

if (require.main === module) {
  try {
    console.log(JSON.stringify(verify(path.resolve(process.argv[2] ?? path.join(__dirname, '../.desktop-build/zhiliu-web-shell')))))
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}

module.exports = { verify }
