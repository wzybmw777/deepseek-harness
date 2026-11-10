const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const { test } = require('node:test')
const { createUpdater } = require('../updater.cjs')
const { registerUpdateIpc } = require('../update-ipc.cjs')

function fixture(context, enabled = true) {
  const engine = new EventEmitter()
  const states = []
  const scheduled = new Map()
  const timers = {
    setTimeout: (callback, delay) => { scheduled.set(delay, callback); return delay },
    setInterval: (callback, delay) => { scheduled.set(delay, callback); return delay },
    clearTimeout: handle => scheduled.delete(handle),
    clearInterval: handle => scheduled.delete(handle),
  }
  let checks = 0
  let installs = 0
  engine.checkForUpdates = async () => { checks++; return { isUpdateAvailable: false } }
  engine.quitAndInstall = (silent, restart) => { assert.equal(silent, false); assert.equal(restart, true); installs++ }
  const updates = createUpdater({ updater: engine, enabled, version: '0.1.0', onState: state => states.push(state), timers })
  context.after(() => updates.dispose())
  return { engine, states, updates, scheduled, checks: () => checks, installs: () => installs }
}

test('checks on startup and periodically, never updates a source launch', async context => {
  const active = fixture(context)
  active.updates.start()
  active.updates.start()
  assert.equal(active.scheduled.size, 2)
  active.scheduled.get(15_000)()
  await active.updates.check()
  assert.equal(active.checks(), 1)
  assert.equal(active.updates.getState().status, 'current')
  assert.equal(active.engine.autoInstallOnAppQuit, false)
  assert.equal(active.engine.allowDowngrade, false)
  assert.equal(active.engine.allowPrerelease, false)
  active.updates.dispose()
  assert.equal(active.scheduled.size, 0)
  const source = fixture(context, false)
  source.updates.start()
  await source.updates.check()
  assert.equal(source.scheduled.size, 0)
  assert.equal(source.checks(), 0)
  assert.equal(source.updates.getState().status, 'unsupported')
})

test('deduplicates check and download, reports progress, and installs only a ready package once', async context => {
  const { engine, updates, installs } = fixture(context)
  let finishCheck
  let finishDownload
  let downloads = 0
  engine.checkForUpdates = () => new Promise(resolve => { finishCheck = resolve })
  engine.downloadUpdate = async () => { downloads++; await new Promise(resolve => { finishDownload = resolve }) }
  assert.equal(updates.install(), false)
  const first = updates.check()
  assert.equal(updates.check(), first)
  finishCheck({ isUpdateAvailable: true, updateInfo: { version: '0.2.0' } })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(downloads, 1)
  assert.equal(updates.check(), first)
  engine.emit('download-progress', { percent: 42.8 })
  assert.equal(updates.getState().percent, 43)
  engine.emit('download-progress', { percent: NaN })
  assert.equal(updates.getState().percent, 43)
  engine.emit('update-downloaded', { version: '0.2.0' })
  finishDownload()
  await first
  assert.equal((await updates.check()).status, 'downloaded')
  assert.equal(installs(), 0)
  assert.equal(updates.install(), true)
  assert.equal(updates.install(), false)
  assert.equal(installs(), 1)
})

test('contains check, download and integrity failures; retry can recover without allowing early install', async context => {
  const { engine, updates } = fixture(context)
  engine.checkForUpdates = async () => { throw new Error('offline') }
  assert.equal((await updates.check()).status, 'error')
  assert.equal(updates.install(), false)
  engine.checkForUpdates = async () => ({ isUpdateAvailable: true, updateInfo: { version: '0.2.0' } })
  engine.downloadUpdate = async () => { throw Object.assign(new Error('bad checksum'), { code: 'ERR_CHECKSUM_MISMATCH' }) }
  assert.equal((await updates.check()).errorCode, 'integrity')
  engine.downloadUpdate = async () => { engine.emit('update-downloaded', { version: '0.2.0' }) }
  assert.equal((await updates.check()).status, 'downloaded')
})

test('does not download or publish after shutdown during a check', async context => {
  const { engine, updates, states } = fixture(context)
  let finish
  engine.checkForUpdates = () => new Promise(resolve => { finish = resolve })
  engine.downloadUpdate = () => assert.fail('download after disposal')
  const pending = updates.check()
  updates.dispose()
  finish({ isUpdateAvailable: true, updateInfo: { version: '0.2.0' } })
  await pending
  assert.equal(states.length, 1)
  assert.equal(engine.listenerCount('download-progress'), 0)
})

test('IPC accepts only the owned cloud top frame and removes every handler at shutdown', async () => {
  const handlers = new Map()
  const owner = { isDestroyed: () => false, webContents: { mainFrame: { url: 'https://cloud.test/app' } } }
  let installs = 0
  const dispose = registerUpdateIpc({
    ipcMain: { handle: (name, handler) => handlers.set(name, handler), removeHandler: name => handlers.delete(name) },
    getWindow: () => owner,
    isCloudUrl: value => new URL(value).origin === 'https://cloud.test',
    updates: { getState: () => ({ status: 'idle' }), check: () => ({ status: 'current' }) },
    confirmInstall: () => { installs++; return true },
  })
  const valid = { sender: owner.webContents, senderFrame: owner.webContents.mainFrame }
  assert.equal(handlers.get('zhiliu:update:state')(valid).status, 'idle')
  for (const handler of handlers.values()) {
    assert.throws(() => handler({ ...valid, sender: {} }), /denied/)
    assert.throws(() => handler({ ...valid, senderFrame: { url: 'https://cloud.test/frame' } }), /denied/)
    owner.webContents.mainFrame.url = 'https://other.test/'
    assert.throws(() => handler(valid), /denied/)
    owner.webContents.mainFrame.url = 'https://cloud.test/app'
  }
  handlers.get('zhiliu:update:install')(valid)
  assert.equal(installs, 1)
  dispose()
  assert.equal(handlers.size, 0)
})
