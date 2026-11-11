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
  let chromeOnly = false
  let theme = readTheme()
  let updateState

  function syncUpdateButton() {
    const button = document.querySelector('[data-zl-update]')
    if (!button) return
    button.hidden = !updateState || updateState.status === 'unsupported'
    if (button.hidden) return
    const labels = {
      idle: '检查客户端更新',
      current: `已是最新版本 ${updateState.currentVersion}，点击重新检查`,
      unsupported: '当前为源码运行版，安装正式客户端后可自动更新',
      checking: '正在检查更新…',
      downloading: `正在下载 ${updateState.version} · ${updateState.percent}%`,
      downloaded: `版本 ${updateState.version} 已就绪，重启安装`,
      installing: '正在启动更新安装…',
      error: updateState.errorCode === 'integrity' ? '更新包校验失败，点击重新下载' : '更新失败，请检查网络后点击重试',
    }
    const captions = {
      idle: '检查更新', current: '已是最新', checking: '检查中', downloading: `${updateState.percent}%`,
      downloaded: '重启更新', installing: '安装中', error: '重试更新',
    }
    button.title = labels[updateState.status] ?? '检查客户端更新'
    button.setAttribute('aria-label', button.title)
    button.dataset.state = updateState.status
    button.disabled = ['checking', 'downloading', 'installing', 'unsupported'].includes(updateState.status)
    setText(button, '[data-zl-update-label]', captions[updateState.status] ?? '')
  }

  async function requestUpdate() {
    try {
      if (updateState.status === 'downloaded') await window.zhiliuUpdates.install()
      else await window.zhiliuUpdates.check()
    } catch (error) {
      updateState = { ...updateState, status: 'error', errorCode: 'network' }
      syncUpdateButton()
    }
  }

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
    const pageTheme = document.documentElement.getAttribute('data-theme')
    const effective = chromeOnly && (pageTheme === 'light' || pageTheme === 'dark') ? pageTheme : theme
    document.documentElement.setAttribute('data-zl-theme', effective)
    document.body.toggleAttribute('data-ds-dark-theme', effective === 'dark')
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
        <span class="zl-topbar-mark" aria-hidden="true"></span>
        <span class="zl-topbar-wordmark">
          <strong>企业 AI 工作台</strong>
        </span>
      </div>
      <div class="zl-topbar-divider" aria-hidden="true"></div>
      <div class="zl-topbar-context" aria-label="当前项目">
        <span class="zl-topbar-context-label">当前项目</span>
        <span class="zl-topbar-project" data-zl-project>默认项目</span>
      </div>
      <div class="zl-topbar-spacer"></div>
      <button type="button" class="zl-update-button" data-zl-update hidden>
        <svg width="18" height="18" aria-hidden="true" focusable="false"><use href="#dsw-icon-download-outline-regular"></use></svg>
        <span data-zl-update-label aria-live="polite"></span>
      </button>
      <button type="button" class="zl-theme-toggle" data-zl-theme-toggle aria-label="切换到夜间模式" title="切换到夜间模式">
        <svg class="zl-theme-icon-light" width="18" height="18" aria-hidden="true" focusable="false"><use href="#dsw-icon-light-outline-regular"></use></svg>
        <svg class="zl-theme-icon-dark" width="18" height="18" aria-hidden="true" focusable="false"><use href="#dsw-icon-dark-outline-regular"></use></svg>
      </button>
    `
    header.querySelector('[data-zl-theme-toggle]').addEventListener('click', () => {
      selectTheme(theme === 'dark' ? 'light' : 'dark')
    })
    header.querySelector('[data-zl-update]').addEventListener('click', requestUpdate)
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
    const aligned = frame !== null && edge > 0
      && !frame.hasAttribute('data-sidebar-collapsed') && !frame.hasAttribute('data-sidebar-drawer')
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

  function syncBrandName() {
    for (const name of document.querySelectorAll('.admin-sidebar .sidebar-brand .brand-lockup-name')) {
      if (name.textContent.trim() === '织流企业 AI 工作台') name.textContent = '企业 AI 工作台'
    }
    if (document.title.includes('织流企业 AI 工作台')) {
      document.title = document.title.split('织流企业 AI 工作台').join('企业 AI 工作台')
    }
  }

  function install() {
    syncAdminLoading()
    syncBrandName()
    const frame = document.querySelector(FRAME_SELECTOR)
    const existing = document.getElementById(HEADER_ID)
    const workspaceExpected = location.pathname.startsWith('/t/') && location.pathname.includes('/harness')
    chromeOnly = !frame && !workspaceExpected
    document.documentElement.setAttribute('data-zhiliu-skin', MARKER)
    document.body?.classList.add('zhiliu-enterprise')

    let header = existing
    if (!header) {
      header = createHeader()
      document.body?.prepend(header)
    }
    header.toggleAttribute('data-zl-chrome-only', chromeOnly)
    syncSidebarAlignment(header, frame)
    syncHeader(header)
    syncUpdateButton()
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
          if (record.target === document.documentElement && record.attributeName === 'data-theme') return true
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
      attributeFilter: ['data-ds-dark-theme', 'data-theme', 'data-sidebar-collapsed', 'data-sidebar-drawer'],
      subtree: true,
    })
  }

  function boot() {
    if (window.zhiliuUpdates) {
      let received = false
      const unsubscribe = window.zhiliuUpdates.onState(state => {
        received = true
        updateState = state
        syncUpdateButton()
      })
      window.addEventListener('pagehide', unsubscribe, { once: true })
      window.zhiliuUpdates.getState().then(state => {
        if (!received) updateState = state
        syncUpdateButton()
      }).catch(error => {
        if (!received) updateState = { status: 'error', errorCode: 'network' }
        syncUpdateButton()
      })
    }
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
