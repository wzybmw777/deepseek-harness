function registerUpdateIpc({ ipcMain, getWindow, isCloudUrl, updates, confirmInstall }) {
  const handlers = {
    'zhiliu:update:state': () => updates.getState(),
    'zhiliu:update:check': () => updates.check(),
    'zhiliu:update:install': () => confirmInstall(),
  }
  for (const [channel, handler] of Object.entries(handlers)) {
    ipcMain.handle(channel, event => {
      const owner = getWindow()
      if (!owner || owner.isDestroyed() || event.sender !== owner.webContents || !event.senderFrame
        || event.senderFrame !== owner.webContents.mainFrame || !isCloudUrl(event.senderFrame.url)) {
        throw new Error('Update request denied')
      }
      return handler()
    })
  }
  return () => {
    for (const channel of Object.keys(handlers)) ipcMain.removeHandler(channel)
  }
}

module.exports = { registerUpdateIpc }
