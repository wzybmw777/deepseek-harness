;(() => {
  'use strict'

  if (window.__zhiliuEnterpriseSkin?.version === 1) {
    window.__zhiliuEnterpriseSkin.install()
    return
  }

  const HEADER_ID = 'zhiliu-enterprise-header'
  const MARKER = 'enterprise'
  const FRAME_SELECTOR = '[class*="_7kFT7W_frame"]'
  const PROJECT_SELECTOR = '[class*="_workspaceLabel"]'
  const THEME_KEY = 'zhiliu.desktop.theme'

  let observer
  let sidebarObserver
  let sidebarElement
  let scheduled = false
  let nativeDark
  let theme = readTheme()

  function readTheme() {
    try {
      return localStorage.getItem(THEME_KEY) === 'dark' ? 'dark' : 'light'
    } catch (error) {
      console.warn('Desktop appearance preference is unavailable', error.name)
      return 'light'
    }
  }

  function applyTheme() {
    if (!document.body || !document.documentElement.hasAttribute('data-zhiliu-skin')) return
    if (nativeDark === undefined) nativeDark = document.body.hasAttribute('data-ds-dark-theme')
    document.documentElement.setAttribute('data-zl-theme', theme)
    document.body.toggleAttribute('data-ds-dark-theme', theme === 'dark')
    const button = document.querySelector('[data-zl-theme-toggle]')
    if (button) {
      const label = theme === 'dark' ? '切换到日间模式' : '切换到夜间模式'
      button.setAttribute('aria-label', label)
      button.setAttribute('title', label)
    }
  }

  function selectTheme(value) {
    theme = value
    applyTheme()
    try {
      localStorage.setItem(THEME_KEY, theme)
    } catch (error) {
      console.warn('Desktop appearance could not be saved', error.name)
    }
  }

  function textOf(selector, fallback) {
    const nodes = [...document.querySelectorAll(selector)]
    const visibleNode = nodes.find((node) => {
      const rect = node.getBoundingClientRect()
      return node.textContent.trim() && rect.width > 0 && rect.height > 0
    })
    const value = visibleNode?.innerText?.trim()
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
      <div class="zl-topbar-brand" aria-label="企业 AI 工作台">
        <span class="zl-topbar-wordmark">
          <span class="zl-topbar-eyebrow">ZHILIU · ENTERPRISE</span>
          <strong>企业 AI 工作台</strong>
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
      <button type="button" class="zl-theme-toggle" data-zl-theme-toggle aria-label="切换到夜间模式" title="切换到夜间模式">
        <svg class="zl-theme-icon-light" width="18" height="18" aria-hidden="true" focusable="false"><use href="#dsw-icon-light-outline-regular"></use></svg>
        <svg class="zl-theme-icon-dark" width="18" height="18" aria-hidden="true" focusable="false"><use href="#dsw-icon-dark-outline-regular"></use></svg>
      </button>
    `
    header.querySelector('[data-zl-theme-toggle]').addEventListener('click', () => {
      selectTheme(theme === 'dark' ? 'light' : 'dark')
    })
    return header
  }

  function syncHeader(header) {
    setText(header, '[data-zl-project]', textOf(PROJECT_SELECTOR, '默认项目'))
  }

  function syncSidebarAlignment(header, frame) {
    const sidebar = frame?.querySelector('[class*="_7kFT7W_sidebarCol"]')
    if (sidebar !== sidebarElement) {
      sidebarObserver?.disconnect()
      sidebarElement = sidebar
      if (sidebar && typeof ResizeObserver === 'function') {
        sidebarObserver = new ResizeObserver(() => syncSidebarAlignment(header, frame))
        sidebarObserver.observe(sidebar)
      }
    }
    const edge = sidebar?.getBoundingClientRect().right ?? 0
    const aligned = edge > 0 && !frame.hasAttribute('data-sidebar-collapsed') && !frame.hasAttribute('data-sidebar-drawer')
    header.toggleAttribute('data-zl-sidebar-aligned', aligned)
    if (aligned) header.style.setProperty('--zl-sidebar-edge', `${edge}px`)
    else header.style.removeProperty('--zl-sidebar-edge')
  }

  function syncAdminLoading() {
    const boot = document.querySelector('.boot-screen')
    if (!boot || !location.pathname.startsWith('/enterprise')) return
    const isConsole = /^\/enterprise\/(admin|resources|billing|account)(\/|$)/u.test(location.pathname)
    if (!isConsole) return
    boot.setAttribute('data-zl-loading', '')
    boot.setAttribute('role', 'status')
    boot.setAttribute('aria-live', 'polite')
    boot.setAttribute('aria-busy', 'true')
    setText(boot, ':scope > div > span:not(.spinner)', '正在加载企业控制台…')
  }

  function install() {
    syncAdminLoading()
    for (const name of document.querySelectorAll('.admin-sidebar .sidebar-brand .brand-lockup-name')) {
      if (name.textContent.trim() === '织流企业 AI 工作台') name.textContent = '企业 AI 工作台'
    }
    const frame = document.querySelector(FRAME_SELECTOR)
    const existing = document.getElementById(HEADER_ID)
    const workspaceExpected = location.pathname.startsWith('/t/') && location.pathname.includes('/harness')

    if (!frame && !workspaceExpected) {
      sidebarObserver?.disconnect()
      sidebarElement = undefined
      existing?.remove()
      document.documentElement.removeAttribute('data-zhiliu-skin')
      document.documentElement.removeAttribute('data-zl-theme')
      document.body?.classList.remove('zhiliu-enterprise')
      if (nativeDark !== undefined) {
        document.body?.toggleAttribute('data-ds-dark-theme', nativeDark)
        nativeDark = undefined
      }
      return
    }

    document.documentElement.setAttribute('data-zhiliu-skin', MARKER)
    document.body?.classList.add('zhiliu-enterprise')

    let header = existing
    if (!header) {
      header = createHeader()
      document.body?.prepend(header)
    }
    syncSidebarAlignment(header, frame)
    syncHeader(header)
    applyTheme()
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
        if (record.type === 'attributes') {
          if (record.target.matches?.(FRAME_SELECTOR)) return true
          return record.target === document.body
            && document.documentElement.hasAttribute('data-zhiliu-skin')
            && document.body.hasAttribute('data-ds-dark-theme') !== (theme === 'dark')
        }
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
      attributes: true,
      attributeFilter: ['data-ds-dark-theme', 'data-sidebar-collapsed', 'data-sidebar-drawer'],
      subtree: true,
    })
  }

  function boot() {
    window.addEventListener('storage', (event) => {
      if (event.key !== THEME_KEY && event.key !== null) return
      theme = readTheme()
      applyTheme()
    })
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
