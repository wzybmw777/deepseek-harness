const assert = require('node:assert/strict')
const { createServer } = require('node:http')
const { createHash } = require('node:crypto')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { app } = require('electron')
const { NsisUpdater } = require('electron-updater')
const { createUpdater } = require('../updater.cjs')

async function run() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'zhiliu-update-smoke-'))
  const payload = Buffer.alloc(1024 * 128, 'update transport fixture')
  const digest = createHash('sha512').update(payload).digest('base64')
  let mode = 'current'
  const server = createServer((request, response) => {
    if (request.url.startsWith('/latest.yml')) {
      if (mode === 'missing') { response.writeHead(404); response.end(); return }
      const version = mode === 'current' ? '0.1.0' : mode === 'corrupt' ? '0.3.0' : '0.2.0'
      const expectedDigest = mode === 'corrupt' ? createHash('sha512').update(Buffer.alloc(payload.length, 1)).digest('base64') : digest
      response.setHeader('Content-Type', 'text/yaml')
      response.end(`version: ${version}\nfiles:\n  - url: fixture-${version}.exe\n    sha512: ${expectedDigest}\n    size: ${payload.length}\npath: fixture-${version}.exe\nsha512: ${expectedDigest}\n`)
      return
    }
    response.setHeader('Content-Length', payload.length)
    response.end(mode === 'corrupt' ? Buffer.alloc(payload.length, 0) : payload)
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const adapter = {
    version: '0.1.0', name: 'zhiliu-update-smoke', isPackaged: true,
    appUpdateConfigPath: path.join(directory, 'app-update.yml'),
    baseCachePath: directory, userDataPath: directory,
    whenReady: () => app.whenReady(),
    onQuit() {},
  }
  await fs.writeFile(adapter.appUpdateConfigPath, 'updaterCacheDirName: cache\n')
  const updater = new NsisUpdater(null, adapter)
  const { createRequire } = require('node:module')
  const updaterRequire = createRequire(require.resolve('electron-updater'))
  const { ElectronHttpExecutor } = updaterRequire('./electronHttpExecutor')
  updater.httpExecutor = new ElectronHttpExecutor(() => {})
  updater.setFeedURL({ provider: 'generic', url: `http://127.0.0.1:${server.address().port}/`, useMultipleRangeRequest: false })
  updater.disableDifferentialDownload = true
  updater.logger = { info() {}, warn() {}, error: (...args) => console.error(...args), debug() {} }
  const states = []
  let controller = createUpdater({ updater, enabled: true, version: '0.1.0', onState: state => states.push(state.status) })
  try {
    assert.equal((await controller.check()).status, 'current')
    mode = 'missing'
    assert.equal((await controller.check()).status, 'error')
    mode = 'available'
    assert.equal((await controller.check()).status, 'downloaded')
    const downloaded = await fs.readFile(path.join(directory, 'cache', 'pending', 'fixture-0.2.0.exe'))
    assert.equal(createHash('sha512').update(downloaded).digest('base64'), digest)
    controller.dispose()
    mode = 'corrupt'
    controller = createUpdater({ updater, enabled: true, version: '0.1.0', onState: state => states.push(state.status) })
    const corrupted = await controller.check()
    assert.equal(corrupted.status, 'error')
    assert.equal(corrupted.errorCode, 'integrity')
    assert.equal(controller.install(), false)
    console.log(JSON.stringify({ passed: true, scenarios: ['current', 'missing feed', 'download and SHA512', 'corrupt download rejected'], states }))
  } finally {
    controller.dispose()
    await new Promise(resolve => server.close(resolve))
    await fs.rm(directory, { recursive: true, force: true })
  }
}

app.whenReady().then(run).then(() => app.exit(0), error => { console.error(error); app.exit(1) })
