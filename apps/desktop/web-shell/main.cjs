const fs = require('node:fs')
const path = require('node:path')
const { app, BrowserWindow, Menu, shell, ipcMain, nativeTheme } = require('electron')

const CLOUD_ORIGIN = new URL(
  process.env.DSH_ENTERPRISE_CLOUD_ORIGIN ?? 'https://dev.echoai.best',
).origin
const START_URL = new URL('/enterprise/login?next=%2Fenterprise%2Fworkspace', CLOUD_ORIGIN).href
const ICON_PATH = path.join(__dirname, 'assets', 'zhiliu-icon.png')
const SKIN_CSS_PATH = path.join(__dirname, 'skin.css')
const SKIN_JS_PATH = path.join(__dirname, 'skin.js')
const SKIN_CSS = fs.readFileSync(SKIN_CSS_PATH, 'utf8')
const SKIN_JS = `${fs.readFileSync(SKIN_JS_PATH, 'utf8')}\n//# sourceURL=zhiliu-enterprise-skin.js`

app.setName('织流')
app.commandLine.appendSwitch('lang', 'zh-CN')
const debugPort = process.env.ZHILIU_DEBUG_PORT
if (debugPort && /^[0-9]+$/u.test(debugPort)) app.commandLine.appendSwitch('remote-debugging-port', debugPort)

let mainWindow

ipcMain.on('zhiliu:appearance', (event, theme) => {
  if (event.sender !== mainWindow?.webContents || event.senderFrame !== event.sender.mainFrame) return
  if (!isCloudUrl(event.senderFrame.url) || !['light', 'dark', 'system'].includes(theme)) return
  nativeTheme.themeSource = theme
})

function isCloudUrl(value) {
  try {
    return new URL(value).origin === CLOUD_ORIGIN
  } catch {
    return false
  }
}

function openExternal(value) {
  try {
    const url = new URL(value)
    if (url.protocol === 'https:' || url.protocol === 'http:' || url.protocol === 'mailto:') {
      void shell.openExternal(url.href)
    }
  } catch {
    // Ignore malformed or unsupported navigation targets.
  }
}

function focusWindow() {
  if (mainWindow === undefined || mainWindow.isDestroyed()) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 900,
    minHeight: 640,
    show: false,
    title: '织流',
    backgroundColor: '#ffffff',
    autoHideMenuBar: true,
    icon: ICON_PATH,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  let skinAppliedForDocument = false

  async function applyEnterpriseSkin() {
    if (skinAppliedForDocument || mainWindow === undefined || mainWindow.isDestroyed()) return
    skinAppliedForDocument = true
    try {
      await mainWindow.webContents.insertCSS(SKIN_CSS, { cssOrigin: 'author' })
      await mainWindow.webContents.executeJavaScript(SKIN_JS, true)
    } catch (error) {
      skinAppliedForDocument = false
      console.error('zhiliu web shell: failed to apply enterprise skin', error)
    }
  }

  Menu.setApplicationMenu(null)
  mainWindow.webContents.setUserAgent(
    mainWindow.webContents.getUserAgent().replace(/\sElectron\/\S+/u, ''),
  )

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isCloudUrl(url)) void mainWindow.loadURL(url)
    else openExternal(url)
    return { action: 'deny' }
  })

  mainWindow.webContents.on('did-start-navigation', (_event, _url, isInPlace, isMainFrame) => {
    if (isMainFrame && !isInPlace) skinAppliedForDocument = false
  })

  mainWindow.webContents.on('dom-ready', () => {
    void applyEnterpriseSkin()
  })

  mainWindow.webContents.on('did-finish-load', () => {
    void applyEnterpriseSkin()
    if (!mainWindow.isVisible()) mainWindow.show()
  })

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (isCloudUrl(url)) return
    event.preventDefault()
    openExternal(url)
  })

  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (!isMainFrame || errorCode === -3) return
    console.error(`zhiliu web shell: ${validatedURL} failed (${String(errorCode)}): ${errorDescription}`)
    if (!mainWindow.isVisible()) mainWindow.show()
  })

  mainWindow.once('ready-to-show', () => mainWindow.show())
  mainWindow.on('closed', () => { mainWindow = undefined })
  mainWindow.on('page-title-updated', (event) => {
    event.preventDefault()
    mainWindow?.setTitle('织流')
  })

  void mainWindow.loadURL(START_URL).catch((error) => {
    console.error('zhiliu web shell: failed to load enterprise UI', error)
  })
}

const lock = app.requestSingleInstanceLock()
if (!lock) {
  app.quit()
} else {
  app.on('second-instance', focusWindow)
  app.whenReady().then(() => {
    app.setAppUserModelId('com.echoai.zhiliu.desktop')
    createWindow()
  }).catch((error) => {
    console.error('zhiliu web shell: startup failed', error)
    app.quit()
  })

  app.on('activate', () => {
    if (mainWindow === undefined || mainWindow.isDestroyed()) createWindow()
    else focusWindow()
  })
  app.on('window-all-closed', () => app.quit())
}
