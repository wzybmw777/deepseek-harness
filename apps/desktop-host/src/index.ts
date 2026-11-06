/** Launch the Desktop profile through the Web application and report its URL to Electron. */

import { delimiter, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import type { PluginOperationRunId } from '@deepseek-ai/dsh-plugin-manager/diagnostic'
import { installEnterpriseDesktopRuntime } from '@deepseek-ai/dsh-enterprise-desktop'
import { formatFatalDiagnostic } from './fatal-diagnostic.ts'
import { loadLayeredEnv, loadProfileDirectory, reportSkippedBundles } from '@deepseek-ai/dsh-app-boot'
import { runProfile } from '@deepseek-ai/dsh/profile-boot'
import type {} from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-deepseek-account'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import * as desktopOffice from './office.ts'
import { localDragResource } from './file-drag.ts'

import { installDesktopUpdateTaskControl } from './update-tasks.ts'
import { installDesktopQuitInspection } from './quit-inspection.ts'
import { installPlatformSessionPublisher } from './platform-session.ts'
import { installOfficeEngineResolution } from './office-engine.ts'
import { installOperationDiagnostics } from './operation-diagnostics.ts'
import {
  EnterpriseBootstrapService, installEnterpriseBootstrap, parseEnterpriseHostBootstrap, waitForEnterpriseBootstrap,
  type EnterpriseBootstrapRefresh, type EnterpriseHostBootstrap,
} from './enterprise-bootstrap.ts'

const ENTERPRISE_REFRESH_TIMEOUT_MS = 15_000

function enterpriseDesktopEntry(): string {
  return pathToFileURL(createRequire(import.meta.url).resolve('@deepseek-ai/dsh-enterprise-desktop')).href
}

async function main(): Promise<void> {
  const runId = randomUUID() as PluginOperationRunId
  if (process.connected) process.send?.({ type: 'starting', runId }, (error) => { if (error !== null) console.error(error) })
  const enterpriseOriginArgument = process.argv.find(argument => argument.startsWith('--enterprise-cloud-origin='))
  const enterpriseOrigin = enterpriseOriginArgument?.slice('--enterprise-cloud-origin='.length)
  const enterpriseBootstrap = enterpriseOrigin === undefined ? undefined : await waitForEnterpriseBootstrap(enterpriseOrigin)
  const runtimeDir = process.argv[2] as string
  const projectDir = process.argv[3] as string
  installOfficeEngineResolution(runtimeDir)
  const installAnchor = join(runtimeDir, 'node_modules', '@deepseek-ai', 'dsh', 'package.json')
  const profile = loadProfileDirectory('dsh', projectDir, installAnchor)
  reportSkippedBundles('dsh', profile)
  const application = runProfile({
    environment: loadLayeredEnv('dsh'),
    profile: 'desktop',
    resolvedProfile: { profile, installAnchor },
    patchFiles: [],
    args: ['--no-open', '--host', '127.0.0.1', '--port', '0'],
    ...(process.argv[5] === undefined ? {} : {
      packageManager: {
        command: process.execPath,
        args: ['--expose-internals', process.argv[5]],
        env: {
          ELECTRON_RUN_AS_NODE: '1',
          DSH_DESKTOP_NODE_EXECUTABLE: process.execPath,
          PATH: `${process.argv[6] ?? ''}${delimiter}${process.env.PATH ?? ''}`,
        },
      },
    }),
  })
  let stopping: Promise<void> | undefined
  const dragReads = new Map<number, AbortController>()
  const dragTasks = new Set<Promise<void>>()
  const control: {
    updateTasks?: ReturnType<typeof installDesktopUpdateTaskControl>
    quitInspection?: ReturnType<typeof installDesktopQuitInspection>
  } = {}
  let enterpriseService: EnterpriseBootstrapService | undefined
  let disposeEnterprise: (() => void) | undefined
  const enterpriseRefreshes = new Map<number, {
    readonly resolve: (value: EnterpriseHostBootstrap) => void
    readonly reject: (error: Error) => void
    readonly timer: ReturnType<typeof setTimeout>
  }>()
  let nextEnterpriseRefreshId = 1
  const send = (message: object): Promise<void> => new Promise((resolve, reject) => {
    if (!process.connected || process.send === undefined) { resolve(); return }
    process.send(message, (error) => { if (error === null) resolve(); else reject(error) })
  })
  const requestEnterpriseRefresh: EnterpriseBootstrapRefresh = () => {
    if (!process.connected || process.send === undefined) {
      return Promise.reject(new Error('Enterprise Desktop refresh channel is unavailable'))
    }
    const requestId = nextEnterpriseRefreshId++
    return new Promise<EnterpriseHostBootstrap>((resolve, reject) => {
      const timer = setTimeout(() => {
        enterpriseRefreshes.delete(requestId)
        reject(new Error('Enterprise Desktop refresh timed out'))
      }, ENTERPRISE_REFRESH_TIMEOUT_MS)
      timer.unref()
      enterpriseRefreshes.set(requestId, { resolve, reject, timer })
      process.send?.({ type: 'enterprise-refresh', requestId }, (error) => {
        if (error === null) return
        const pending = enterpriseRefreshes.get(requestId)
        if (pending === undefined) return
        clearTimeout(pending.timer)
        enterpriseRefreshes.delete(requestId)
        pending.reject(error)
      })
    })
  }
  const stop = (): Promise<void> => stopping ??= (async () => {
    disposeEnterprise?.()
    disposeEnterprise = undefined
    for (const pending of enterpriseRefreshes.values()) {
      clearTimeout(pending.timer)
      pending.reject(new Error('Enterprise Host is stopping'))
    }
    enterpriseRefreshes.clear()
    enterpriseService?.clear()
    for (const abort of dragReads.values()) abort.abort()
    await Promise.allSettled(dragTasks)
    // Startup failure is reported by main; shutdown only owns a tree that booted.
    const running = await application.catch(() => undefined)
    await running?.shutdown.shutdown(0)
    await send({ type: 'shutdown-complete' })
    if (process.connected) process.disconnect()
    // A handle a disposed plugin left open would otherwise keep the Host alive past the shell's graceful
    // deadline; a startup failure keeps its own diagnostic exit.
    if (running !== undefined) process.exit()
  })()
  process.on('message', (message: unknown) => {
    if (typeof message !== 'object' || message === null || !('type' in message)) return
    if (message.type === 'shutdown') { void stop(); return }
    if (message.type === 'enterprise-bootstrap' && enterpriseService !== undefined && 'value' in message) {
      try {
        enterpriseService.replace(parseEnterpriseHostBootstrap(message.value, enterpriseOrigin ?? ''))
      } catch (error) {
        console.error(error)
        process.send?.({ type: 'fatal', message: 'Enterprise Desktop bootstrap refresh failed', diagnostic: formatFatalDiagnostic(error) })
      }
      return
    }
    if (message.type === 'enterprise-refresh' && 'requestId' in message
      && typeof message.requestId === 'number' && Number.isSafeInteger(message.requestId)) {
      const requestId = message.requestId
      const pending = enterpriseRefreshes.get(requestId)
      if (pending === undefined) return
      clearTimeout(pending.timer)
      enterpriseRefreshes.delete(requestId)
      if (!('value' in message)) {
        pending.reject(new Error('Enterprise Desktop access refresh failed'))
        return
      }
      try { pending.resolve(parseEnterpriseHostBootstrap(message.value, enterpriseOrigin ?? '')) }
      catch (error) { pending.reject(error instanceof Error ? error : new Error(String(error))) }
      return
    }
    if (message.type === 'enterprise-session-cleared') {
      enterpriseService?.clear()
      return
    }
    if (message.type === 'file-drag-cancel') {
      if ('requestId' in message && typeof message.requestId === 'number') dragReads.get(message.requestId)?.abort()
      return
    }
    if (message.type === 'file-drag-resource') {
      if (!('requestId' in message) || typeof message.requestId !== 'number' || !Number.isSafeInteger(message.requestId)
        || !('address' in message) || typeof message.address !== 'string') return
      const { requestId, address } = message
      const abort = new AbortController()
      dragReads.set(requestId, abort)
      const task = (async () => {
        try {
          if (stopping !== undefined) throw new Error('Host stopping')
          const { ctx } = await application
          const resource = await localDragResource(ctx, address, abort.signal)
          await send({ type: 'file-drag-resource', requestId, resource })
        } catch (error) {
          if (!abort.signal.aborted) console.error(error)
          await send({ type: 'file-drag-resource', requestId, resource: null, error: 'File drag resource unavailable' })
        } finally { dragReads.delete(requestId) }
      })().catch((error: unknown) => { console.error(error) })
      dragTasks.add(task)
      void task.finally(() => { dragTasks.delete(task) })
      return
    }
    if (message.type === 'quit-inspection') {
      if (!('requestId' in message) || !Number.isSafeInteger(message.requestId)) return
      const requestId = message.requestId
      void (async () => {
        try {
          if (stopping !== undefined || control.quitInspection === undefined) throw new Error('desktop quit: Host is unavailable')
          const inspection = await control.quitInspection()
          await send({ type: 'quit-inspection', requestId, ...inspection })
        } catch (error) {
          // The shell treats an unknown state as interruptible work and asks before quitting.
          await send({ type: 'quit-inspection', requestId, activeTasks: true, scheduledTasks: false,
            error: error instanceof Error ? error.message : String(error) })
        }
      })().catch((error: unknown) => { console.error(error) })
      return
    }
    if (message.type !== 'update-tasks' || !('requestId' in message) || !Number.isSafeInteger(message.requestId)
      || !('action' in message) || !['inspect', 'lock', 'unlock'].includes(String(message.action))) return
    void (async () => {
      try {
        if (stopping !== undefined || control.updateTasks === undefined) throw new Error('desktop update: Host is unavailable')
        const active = await control.updateTasks(message.action as 'inspect' | 'lock' | 'unlock')
        await send({ type: 'update-tasks', requestId: message.requestId, active })
      } catch (error) {
        await send({ type: 'update-tasks', requestId: message.requestId, active: true,
          error: error instanceof Error ? error.message : String(error) })
      }
    })().catch((error: unknown) => { console.error(error) })
  })
  process.once('disconnect', () => { void stop() })
  const { ctx } = await application
  if (enterpriseBootstrap !== undefined) {
    enterpriseService = installEnterpriseBootstrap(ctx, enterpriseBootstrap, requestEnterpriseRefresh)
    await ctx.loader.create({ name: enterpriseDesktopEntry() })
    disposeEnterprise = await installEnterpriseDesktopRuntime(ctx, enterpriseService)
  }
  installOperationDiagnostics(ctx, record => send({ type: 'plugin-operation', record }), 32, runId)
  control.updateTasks = installDesktopUpdateTaskControl(ctx)
  control.quitInspection = installDesktopQuitInspection(ctx)
  await ctx.plugin(desktopOffice, {
    runtimeDir,
    source: process.argv[4] ?? join(runtimeDir, '..', 'runtime', 'primary-runtime'),
    root: join(resolveDshHome(), 'dsh-runtimes', 'dsh-primary-runtime'),
  })
  installPlatformSessionPublisher(ctx, (session) => {
    if (process.connected) process.send?.({ type: 'platform-session', session })
  })
  const url = ctx.connection.authenticatedUrl(`${ctx.webServer.protocol}//127.0.0.1:${String(ctx.webServer.port)}`)
  if (process.connected) process.send?.({ type: 'ready', url, injections: ctx.webServer.collectIndexInjections(ctx.connection.browserPeer) }, (error) => { if (error !== null) console.error(error) })
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error)
    // The shell receives the complete inspected error here, not through stderr:
    // stderr bytes and this IPC message race, and the shell reports the first
    // failure it sees.
    const diagnostic = formatFatalDiagnostic(error)
    if (process.connected) process.send?.({ type: 'fatal', message, diagnostic }, (error) => { if (error !== null) console.error(error) })
    console.error(error)
    process.exitCode = 1
    if (process.connected) process.disconnect()
  })
}
