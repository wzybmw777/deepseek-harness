;(() => {
  'use strict'

  if (window.__zhiliuEnterpriseSkin?.version === 1) {
    window.__zhiliuEnterpriseSkin.install()
    return
  }

  const HEADER_ID = 'zhiliu-enterprise-header'
  const MARKER = 'enterprise'
  const FRAME_SELECTOR = '[class*="_7kFT7W_frame"]'
  const ACCOUNT_NAME_SELECTOR = '.dsh-ent-name'
  const PROJECT_SELECTOR = '[class*="_workspaceLabel"]'
  const QUOTA_SELECTOR = '.dsh-ent-quota-amount'

  let observer
  let scheduled = false

  function textOf(selector, fallback, childSelector) {
    const nodes = [...document.querySelectorAll(selector)]
    const visibleNode = nodes.find((node) => {
      const rect = node.getBoundingClientRect()
      return node.textContent.trim() && rect.width > 0 && rect.height > 0
    })
    const child = childSelector ? visibleNode?.querySelector(childSelector) : undefined
    const value = child?.textContent?.trim() || visibleNode?.innerText?.trim()
    return value || fallback
  }

  function setText(root, selector, value) {
    const node = root.querySelector(selector)
    if (node && node.textContent !== value) node.textContent = value
  }

  function createHeader() {
    const header = document.createElement('header')
    header.id = HEADER_ID
    header.setAttribute('role', 'banner')
    header.innerHTML = `
      <div class="zl-topbar-brand" aria-label="织流企业 AI 工作台">
        <span class="zl-topbar-mark" aria-hidden="true">织</span>
        <span class="zl-topbar-wordmark">
          <span class="zl-topbar-eyebrow">ZHILIU · ENTERPRISE</span>
          <strong>织流企业 AI 工作台</strong>
        </span>
      </div>
      <div class="zl-topbar-divider" aria-hidden="true"></div>
      <div class="zl-topbar-context" aria-label="当前工作空间">
        <span class="zl-topbar-context-label">当前工作空间</span>
        <span class="zl-topbar-project" data-zl-project>默认项目</span>
      </div>
      <div class="zl-topbar-spacer"></div>
      <div class="zl-topbar-status" title="当前使用企业云服务">
        <span class="zl-status-dot" aria-hidden="true"></span>
        <span>企业云空间</span>
      </div>
      <div class="zl-topbar-quota" title="Token 配额">
        <span class="zl-quota-label">本月可用</span>
        <strong data-zl-quota>正在同步配额</strong>
        <span class="zl-quota-unit">Tokens</span>
      </div>
      <div class="zl-topbar-account">
        <span class="zl-account-avatar" aria-hidden="true">企</span>
        <span class="zl-topbar-account-copy">
          <span class="zl-account-label">当前账号</span>
          <strong data-zl-account>企业用户</strong>
        </span>
      </div>
    `
    return header
  }

  function syncHeader(header) {
    setText(header, '[data-zl-project]', textOf(PROJECT_SELECTOR, '默认项目'))
    setText(header, '[data-zl-quota]', textOf(QUOTA_SELECTOR, '配额同步中', 'strong'))
    setText(header, '[data-zl-account]', textOf(ACCOUNT_NAME_SELECTOR, '企业用户'))
  }

  function install() {
    const frame = document.querySelector(FRAME_SELECTOR)
    const existing = document.getElementById(HEADER_ID)
    const workspaceExpected = location.pathname.startsWith('/t/') && location.pathname.includes('/harness')

    if (!frame && !workspaceExpected) {
      existing?.remove()
      document.documentElement.removeAttribute('data-zhiliu-skin')
      document.body?.classList.remove('zhiliu-enterprise')
      return
    }

    document.documentElement.setAttribute('data-zhiliu-skin', MARKER)
    document.body?.classList.add('zhiliu-enterprise')

    let header = existing
    if (!header) {
      header = createHeader()
      document.body?.prepend(header)
    }
    syncHeader(header)
  }

  function scheduleInstall() {
    if (scheduled) return
    scheduled = true
    requestAnimationFrame(() => {
      scheduled = false
      install()
    })
  }

  function startObserver() {
    if (observer || !document.documentElement) return
    observer = new MutationObserver((records) => {
      const pageChanged = records.some((record) => {
        if (record.type === 'characterData') return true
        return [...record.addedNodes, ...record.removedNodes].some((node) => {
          if (node.nodeType !== Node.ELEMENT_NODE) return false
          return node.id !== HEADER_ID && !node.closest?.(`#${HEADER_ID}`)
        })
      })
      if (pageChanged) scheduleInstall()
    })
    observer.observe(document.documentElement, {
      childList: true,
      characterData: true,
      subtree: true,
    })
  }

  function boot() {
    startObserver()
    install()
    setInterval(() => {
      const header = document.getElementById(HEADER_ID)
      if (header) syncHeader(header)
    }, 1500)
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true })
  } else {
    boot()
  }

  window.__zhiliuEnterpriseSkin = {
    install,
    version: 1,
  }
})()
