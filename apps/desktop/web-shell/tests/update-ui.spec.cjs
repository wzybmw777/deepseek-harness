const assert = require('node:assert/strict')
const { test } = require('node:test')
const { readFileSync } = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { JSDOM } = require('jsdom')

test('preload exposes fixed update actions and never passes the Electron event to the page', () => {
  let bridge
  let eventListener
  const calls = []
  const ipcRenderer = {
    invoke: channel => calls.push(channel),
    on: (channel, listener) => { assert.equal(channel, 'zhiliu:update:changed'); eventListener = listener },
    removeListener: (channel, listener) => { assert.equal(channel, 'zhiliu:update:changed'); assert.equal(listener, eventListener) },
  }
  vm.runInNewContext(readFileSync(path.join(__dirname, '../preload.cjs'), 'utf8'), {
    require: () => ({ ipcRenderer, contextBridge: { exposeInMainWorld: (name, value) => { assert.equal(name, 'zhiliuUpdates'); bridge = value } } }),
    window: { addEventListener() {} },
  })
  bridge.getState()
  bridge.check('https://untrusted.test/')
  bridge.install('/untrusted.exe')
  assert.deepEqual(calls, ['zhiliu:update:state', 'zhiliu:update:check', 'zhiliu:update:install'])
  const state = { status: 'downloaded' }
  const unsubscribe = bridge.onState((...args) => assert.deepEqual(args, [state]))
  eventListener({ sender: 'private' }, state)
  unsubscribe()
})

test('update control tracks progress, retry and restart in both themes without accepting stale state', async context => {
  const dom = new JSDOM('<body><div class="_7kFT7W_frame"></div></body>', {
    url: 'https://example.test/t/default/harness/', runScripts: 'outside-only', pretendToBeVisual: true,
  })
  const observers = []
  const NativeObserver = dom.window.MutationObserver
  dom.window.MutationObserver = class extends NativeObserver {
    constructor(callback) { super(callback); observers.push(this) }
  }
  context.after(async () => {
    await new Promise(resolve => dom.window.requestAnimationFrame(() => dom.window.requestAnimationFrame(resolve)))
    for (const observer of observers) observer.disconnect()
    dom.window.close()
  })
  let notify
  let resolveInitial
  let checks = 0
  let installs = 0
  dom.window.zhiliuUpdates = {
    onState: callback => { notify = callback; return () => {} },
    getState: () => new Promise(resolve => { resolveInitial = resolve }),
    check: async () => { checks++ }, install: async () => { installs++ },
  }
  dom.window.eval(readFileSync(path.join(__dirname, '../skin.js'), 'utf8'))
  await new Promise(resolve => dom.window.requestAnimationFrame(resolve))
  const button = dom.window.document.querySelector('[data-zl-update]')
  notify({ status: 'downloading', version: '0.2.0', percent: 48 })
  resolveInitial({ status: 'idle' })
  await Promise.resolve()
  assert.equal(button.dataset.state, 'downloading')
  assert.equal(button.disabled, true)
  assert.equal(button.textContent.trim(), '48%')
  notify({ status: 'error', errorCode: 'integrity' })
  assert.match(button.title, /校验失败/)
  button.click()
  assert.equal(checks, 1)
  notify({ status: 'downloaded', version: '0.2.0' })
  dom.window.document.querySelector('[data-zl-theme-toggle]').click()
  button.click()
  assert.equal(installs, 1)
  assert.equal(button.textContent.trim(), '重启更新')
  notify({ status: 'current', currentVersion: '0.2.0' })
  assert.match(button.title, /已是最新版本 0.2.0/)
  assert.equal(button.textContent.trim(), '')
})
