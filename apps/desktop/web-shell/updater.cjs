function createUpdater({ updater, version, enabled, onState, timers = globalThis }) {
  let state = { status: enabled ? 'idle' : 'unsupported', currentVersion: version, version: null, percent: 0 }
  let operation
  let disposed = false
  let started = false
  let startupTimer
  let periodicTimer
  const subscriptions = []

  function getState() {
    return { ...state }
  }

  function publish(values) {
    if (disposed) return
    state = { ...state, ...values }
    onState(getState())
  }

  function fail(error) {
    publish({ status: 'error', errorCode: error?.code === 'ERR_UPDATER_INVALID_SIGNATURE' || error?.code === 'ERR_CHECKSUM_MISMATCH' ? 'integrity' : 'network' })
  }

  function listen(name, handler) {
    updater.on(name, handler)
    subscriptions.push([name, handler])
  }

  if (enabled) {
    updater.autoDownload = false
    updater.autoInstallOnAppQuit = false
    updater.allowPrerelease = false
    updater.allowDowngrade = false
    updater.disableWebInstaller = true
    listen('error', fail)
    listen('download-progress', progress => {
      if (state.status !== 'downloading' || !Number.isFinite(progress.percent)) return
      publish({ percent: Math.max(0, Math.min(100, Math.round(progress.percent))) })
    })
    listen('update-downloaded', info => publish({ status: 'downloaded', version: info.version, percent: 100 }))
  }

  async function runCheck() {
    try {
      const result = await updater.checkForUpdates()
      if (disposed) return
      if (!result) throw new Error('Update check unavailable')
      if (!result.isUpdateAvailable) {
        publish({ status: 'current', version: null, percent: 0 })
        return
      }
      publish({ status: 'downloading', version: result.updateInfo.version, percent: 0 })
      await updater.downloadUpdate(result.cancellationToken)
    } catch (error) {
      fail(error)
    }
  }

  function check() {
    if (disposed || !enabled || state.status === 'downloaded' || state.status === 'installing') return Promise.resolve(getState())
    if (operation) return operation
    publish({ status: 'checking', errorCode: undefined, percent: 0, version: null })
    operation = runCheck().finally(() => { operation = undefined }).then(getState)
    return operation
  }

  function start() {
    if (started || disposed || !enabled) return
    started = true
    startupTimer = timers.setTimeout(() => { void check() }, 15_000)
    periodicTimer = timers.setInterval(() => { void check() }, 4 * 60 * 60 * 1000)
  }

  function install() {
    if (disposed || state.status !== 'downloaded') return false
    publish({ status: 'installing' })
    try {
      updater.quitAndInstall(false, true)
      return true
    } catch (error) {
      fail(error)
      return false
    }
  }

  function dispose() {
    disposed = true
    timers.clearTimeout(startupTimer)
    timers.clearInterval(periodicTimer)
    for (const [name, handler] of subscriptions) updater.removeListener(name, handler)
  }

  return { getState, check, start, install, dispose }
}

module.exports = { createUpdater }
