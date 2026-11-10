const { ipcRenderer, contextBridge } = require('electron')

const THEME_KEY = 'zhiliu.desktop.theme'
const BOOT_BACKGROUND = { light: '#fcfdff', dark: '#141922' }

function readDesktopTheme() {
  try {
    return localStorage.getItem(THEME_KEY) === 'dark' ? 'dark' : 'light'
  } catch {
    return 'light'
  }
}

function applyBootTheme() {
  const root = document.documentElement
  if (root === null) return false
  const theme = readDesktopTheme()
  root.setAttribute('data-zl-theme', theme)
  root.setAttribute('data-zhiliu-skin', 'enterprise')
  root.style.colorScheme = theme
  root.style.setProperty('--zl-boot-bg', BOOT_BACKGROUND[theme])
  return true
}

if (!applyBootTheme()) {
  const observer = new MutationObserver(() => {
    if (applyBootTheme()) observer.disconnect()
  })
  observer.observe(document, { childList: true })
}

contextBridge.exposeInMainWorld('zhiliuUpdates', {
  getState: () => ipcRenderer.invoke('zhiliu:update:state'),
  check: () => ipcRenderer.invoke('zhiliu:update:check'),
  install: () => ipcRenderer.invoke('zhiliu:update:install'),
  onState: callback => {
    const listener = (_event, state) => callback(state)
    ipcRenderer.on('zhiliu:update:changed', listener)
    return () => ipcRenderer.removeListener('zhiliu:update:changed', listener)
  },
})

function syncAppearance() {
  const root = document.documentElement
  const theme = root.getAttribute('data-zl-theme') ?? root.getAttribute('data-theme') ?? root.getAttribute('data-ds-theme-source') ?? 'system'
  if (['light', 'dark', 'system'].includes(theme)) ipcRenderer.send('zhiliu:appearance', theme)
}

window.addEventListener('DOMContentLoaded', () => {
  const observer = new MutationObserver(syncAppearance)
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-zl-theme', 'data-theme', 'data-ds-theme-source'],
  })
  syncAppearance()
}, { once: true })
