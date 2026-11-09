const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const path = require('node:path')
const { test } = require('node:test')
const { JSDOM } = require('jsdom')

const source = readFileSync(path.join(__dirname, '../skin.js'), 'utf8')
const preload = readFileSync(path.join(__dirname, '../preload.cjs'), 'utf8')

async function settle(window) {
  await new Promise(resolve => window.requestAnimationFrame(() => window.requestAnimationFrame(resolve)))
}

async function openPage(context, preference) {
  const dom = new JSDOM('<body data-ds-dark-theme><div class="_7kFT7W_frame"></div></body>', {
    url: 'https://example.test/t/default/harness/',
    runScripts: 'outside-only',
    pretendToBeVisual: true,
  })
  const observers = []
  const NativeObserver = dom.window.MutationObserver
  dom.window.MutationObserver = class extends NativeObserver {
    constructor(callback) {
      super(callback)
      observers.push(this)
    }
  }
  context.after(async () => {
    await settle(dom.window)
    for (const observer of observers) observer.disconnect()
    dom.window.close()
  })
  if (preference) dom.window.localStorage.setItem('zhiliu.desktop.theme', preference)
  dom.window.eval(source)
  await settle(dom.window)
  return dom.window
}

test('switches the whole palette and restores the saved selection on a new page', async context => {
  const window = await openPage(context)
  const root = window.document.documentElement
  const toggle = window.document.querySelector('[data-zl-theme-toggle]')
  assert.equal(root.dataset.zlTheme, 'light')
  assert.equal(window.document.body.hasAttribute('data-ds-dark-theme'), false)
  assert.equal(toggle.getAttribute('aria-label'), '切换到夜间模式')
  assert.equal(window.document.querySelectorAll('[data-zl-theme-toggle]').length, 1)
  assert.equal(window.document.querySelector('.zl-topbar-account'), null)
  toggle.focus()
  toggle.click()
  await settle(window)
  assert.equal(root.dataset.zlTheme, 'dark')
  assert.equal(window.document.body.hasAttribute('data-ds-dark-theme'), true)
  assert.equal(toggle.getAttribute('aria-label'), '切换到日间模式')
  assert.equal(toggle.title, '切换到日间模式')
  assert.equal(window.document.activeElement, toggle)
  const reopened = await openPage(context, window.localStorage.getItem('zhiliu.desktop.theme'))
  assert.equal(reopened.document.documentElement.dataset.zlTheme, 'dark')
  assert.equal(reopened.document.querySelector('[data-zl-theme-toggle]').title, '切换到日间模式')
  reopened.document.querySelector('[data-zl-theme-toggle]').click()
  assert.equal(reopened.document.body.hasAttribute('data-ds-dark-theme'), false)
})

test('keeps the desktop selection during native theme updates and restores native appearance on exit', async context => {
  const window = await openPage(context)
  window.document.body.setAttribute('data-ds-dark-theme', '')
  await settle(window)
  assert.equal(window.document.body.hasAttribute('data-ds-dark-theme'), false)
  window.history.replaceState(null, '', '/enterprise/admin')
  window.document.querySelector('._7kFT7W_frame').remove()
  await settle(window)
  assert.equal(window.document.querySelector('#zhiliu-enterprise-header'), null)
  assert.equal(window.document.documentElement.hasAttribute('data-zl-theme'), false)
  assert.equal(window.document.body.hasAttribute('data-ds-dark-theme'), true)
})

test('switches in memory when storage is unavailable', async context => {
  const window = await openPage(context)
  window.console.warn = () => {}
  Object.defineProperty(window, 'localStorage', { get() { throw new window.DOMException('Blocked', 'SecurityError') } })
  window.document.querySelector('[data-zl-theme-toggle]').click()
  assert.equal(window.document.documentElement.dataset.zlTheme, 'dark')
  window.document.querySelector('[data-zl-theme-toggle]').click()
  assert.equal(window.document.documentElement.dataset.zlTheme, 'light')
})

test('tracks the sidebar edge and clears alignment for collapsed, drawer and detached layouts', async context => {
  const window = await openPage(context)
  let notifyResize
  let disconnected = false
  window.ResizeObserver = class {
    constructor(callback) { notifyResize = callback }
    observe() {}
    disconnect() { disconnected = true }
  }
  const frame = window.document.querySelector('._7kFT7W_frame')
  const sidebar = window.document.createElement('div')
  sidebar.className = '_7kFT7W_sidebarCol'
  let edge = 280
  sidebar.getBoundingClientRect = () => ({ right: edge })
  frame.append(sidebar)
  await settle(window)
  const header = window.document.querySelector('#zhiliu-enterprise-header')
  assert.equal(header.style.getPropertyValue('--zl-sidebar-edge'), '280px')
  edge = 340
  notifyResize()
  await settle(window)
  assert.equal(header.style.getPropertyValue('--zl-sidebar-edge'), '340px')
  for (const attribute of ['data-sidebar-collapsed', 'data-sidebar-drawer']) {
    frame.setAttribute(attribute, '')
    await settle(window)
    assert.equal(header.hasAttribute('data-zl-sidebar-aligned'), false)
    frame.removeAttribute(attribute)
    await settle(window)
    assert.equal(header.hasAttribute('data-zl-sidebar-aligned'), true)
  }
  window.history.replaceState(null, '', '/enterprise/admin')
  frame.remove()
  await settle(window)
  assert.equal(disconnected, true)
})

test('keeps live quota data and its billing link in the page without copying it into the brand header', async context => {
  const window = await openPage(context)
  const frame = window.document.querySelector('._7kFT7W_frame')
  frame.innerHTML = '<a href="/enterprise/billing" data-dsh-enterprise-quota title="本月已用 170万 / 500万 Tokens；我的用量 170万"><span class="dsh-ent-quota-amount"><strong>330万</strong><small>Tokens</small></span></a>'
  const quota = frame.firstElementChild
  await settle(window)
  assert.equal(quota.parentElement, frame)
  assert.equal(quota.getAttribute('href'), '/enterprise/billing')
  assert.equal(window.document.querySelector('#zhiliu-enterprise-header').textContent.includes('330万'), false)
  quota.querySelector('strong').textContent = '320万'
  await settle(window)
  assert.equal(quota.querySelector('strong').textContent, '320万')
  assert.equal(window.document.querySelectorAll('[data-dsh-enterprise-quota]').length, 1)
  quota.hidden = true
  window.__zhiliuEnterpriseSkin.install()
  assert.equal(quota.hidden, true)
  quota.remove()
  await settle(window)
  assert.equal(window.document.body.textContent.includes('320万'), false)
})

test('mirrors desktop appearance to native chrome and falls back to the page theme on exit', async context => {
  const window = await openPage(context)
  const sent = []
  window.require = () => ({ ipcRenderer: { send: (...args) => sent.push(args) } })
  window.eval(preload)
  window.dispatchEvent(new window.Event('DOMContentLoaded'))
  window.document.querySelector('[data-zl-theme-toggle]').click()
  await settle(window)
  assert.deepEqual(sent.at(-1), ['zhiliu:appearance', 'dark'])
  window.history.replaceState(null, '', '/enterprise/admin')
  window.document.documentElement.setAttribute('data-ds-theme-source', 'light')
  window.document.querySelector('._7kFT7W_frame').remove()
  await settle(window)
  assert.deepEqual(sent.at(-1), ['zhiliu:appearance', 'light'])
})

test('labels console startup without changing workspace launch or keeping a stale loading overlay', async context => {
  const window = await openPage(context)
  window.history.replaceState(null, '', '/enterprise/admin/users')
  window.document.body.innerHTML = '<div class="boot-screen"><span class="brand-mark"></span><div><span class="spinner" aria-hidden="true"></span><span>正在进入 AI 工作台…</span></div></div>'
  await settle(window)
  const status = window.document.querySelector('[role="status"]')
  assert.equal(status.textContent, '正在加载企业控制台…')
  assert.equal(status.getAttribute('aria-busy'), 'true')
  window.document.body.innerHTML = '<main class="admin-shell">管理后台</main>'
  await settle(window)
  assert.equal(window.document.querySelector('[role="status"]'), null)
  window.history.replaceState(null, '', '/enterprise/workspace')
  window.document.body.innerHTML = '<div class="boot-screen"><div><span>正在进入 AI 工作台…</span></div></div>'
  await settle(window)
  assert.equal(window.document.querySelector('.boot-screen').textContent, '正在进入 AI 工作台…')
  assert.equal(window.document.querySelector('[data-zl-loading]'), null)
})

test('tracks the admin theme for native chrome without a workspace header', async context => {
  const window = await openPage(context)
  const sent = []
  window.require = () => ({ ipcRenderer: { send: (...args) => sent.push(args) } })
  window.eval(preload)
  window.dispatchEvent(new window.Event('DOMContentLoaded'))
  window.history.replaceState(null, '', '/enterprise/admin')
  window.document.querySelector('._7kFT7W_frame').remove()
  window.document.documentElement.setAttribute('data-theme', 'dark')
  await settle(window)
  assert.deepEqual(sent.at(-1), ['zhiliu:appearance', 'dark'])
  window.document.documentElement.setAttribute('data-theme', 'light')
  await settle(window)
  assert.deepEqual(sent.at(-1), ['zhiliu:appearance', 'light'])
})
