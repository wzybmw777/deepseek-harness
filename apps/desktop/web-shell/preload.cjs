const { ipcRenderer, contextBridge } = require('electron')

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
