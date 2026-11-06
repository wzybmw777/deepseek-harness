/** Authenticated server-side Chromium sessions for the Sidebar Browser. */

import { randomBytes } from 'node:crypto'
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { isIP } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium, type BrowserContext, type CDPSession, type Page } from 'playwright-core'
import type {
  RemoteBrowserControl,
  RemoteBrowserEvent,
  RemoteBrowserOpenResult,
  RemoteBrowserViewState,
} from '@deepseek-ai/dsh-client-ui-sidebar-browser/types'
import { scrubbedParentEnv } from '@deepseek-ai/dsh-subprocess'

const MAX_REMOTE_BROWSER_URL_LENGTH = 16 * 1024
const DEFAULT_VIEWPORT_WIDTH = 960
const DEFAULT_VIEWPORT_HEIGHT = 720
const MIN_VIEWPORT_WIDTH = 320
const MAX_VIEWPORT_WIDTH = 1600
const MIN_VIEWPORT_HEIGHT = 320
const MAX_VIEWPORT_HEIGHT = 1200
const IDLE_SWEEP_MILLISECONDS = 30_000
const STREAM_RETRY_MILLISECONDS = 750
const DISPLAY_START_TIMEOUT_MILLISECONDS = 8_000

/** A browser-session failure safe to expose through the enterprise API. */
export class RemoteBrowserError extends Error {
  /** @param status - HTTP status the API should return. @param message - user-facing failure. @param code - stable API code. */
  constructor(readonly status: number, message: string, readonly code: string) {
    super(message)
  }
}

/** One page implementation created by a remote-browser runtime. */
export interface RemoteBrowserRuntime {
  /** @returns the latest page state without waiting for a stream listener. */
  getState(): RemoteBrowserViewState
  /** @param listener - frame, state, and failure consumer. @returns unsubscribe callback. */
  subscribe(listener: (event: RemoteBrowserEvent) => void): () => void
  /** @param url - validated HTTP(S) address. */
  navigate(url: string): Promise<void>
  back(): Promise<void>
  forward(): Promise<void>
  reload(): Promise<void>
  /** @param width - CSS viewport width. @param height - CSS viewport height. */
  resize(width: number, height: number): Promise<void>
  /** @param control - pointer input in CSS viewport coordinates. */
  pointer(control: Extract<RemoteBrowserControl, { action: 'pointer' }>): Promise<void>
  /** @param deltaX - horizontal wheel delta. @param deltaY - vertical wheel delta. */
  wheel(deltaX: number, deltaY: number): Promise<void>
  /** @param control - key chord or inserted text. */
  key(control: Extract<RemoteBrowserControl, { action: 'key' | 'insertText' }>): Promise<void>
  /** @returns after the context and temporary profile are released. */
  close(): Promise<void>
}

/** Creates isolated Chromium contexts and owns their shared display runtime. */
export interface RemoteBrowserRuntimeFactory {
  /** @param request - initial address and viewport. @returns a ready page with its first navigation pending. */
  create(request: { readonly url: string; readonly width: number; readonly height: number }): Promise<RemoteBrowserRuntime>
  /** @returns after every owned Chromium context and display process is released. */
  dispose(): Promise<void>
}

/** Inputs shared by the HTTP service and its Chromium runtime. */
export interface RemoteBrowserConfig {
  readonly chromePath: string
  readonly xvfbPath: string
  readonly proxyUrl?: string
  readonly proxyBypass?: string
  readonly maxSessions: number
  readonly maxSessionsPerUser: number
  readonly idleTimeoutMs: number
  readonly navigationTimeoutMs: number
  readonly blockedOrigins: readonly string[]
}

/** Open request accepted by the remote-browser service. */
export interface RemoteBrowserOpenRequest {
  readonly url: string
  readonly width: number
  readonly height: number
}

/** Authenticated browser operations exposed to the enterprise API. */
export interface RemoteBrowserService {
  /** @param owner - team-and-user identity. @param request - validated initial address and viewport. */
  open(owner: string, request: RemoteBrowserOpenRequest): Promise<RemoteBrowserOpenResult>
  /** @param owner - team-and-user identity. @param sessionId - opaque session capability. @param control - page operation. */
  control(owner: string, sessionId: string, control: RemoteBrowserControl): Promise<RemoteBrowserViewState>
  /** @param owner - team-and-user identity. @param sessionId - opaque session capability. */
  close(owner: string, sessionId: string): Promise<void>
  /** @param owner - team-and-user identity. @param sessionId - opaque session capability. @param listener - event consumer. */
  subscribe(owner: string, sessionId: string, listener: (event: RemoteBrowserEvent) => void): () => void
  /** @returns after every page, Chromium context, and display process has stopped. */
  dispose(): Promise<void>
}

interface BrowserSession {
  readonly id: string
  readonly owner: string
  readonly runtime: RemoteBrowserRuntime
  unsubscribeRuntime: () => void
  readonly listeners: Set<(event: RemoteBrowserEvent) => void>
  state: RemoteBrowserViewState
  failure: Extract<RemoteBrowserEvent, { type: 'failure' }> | undefined
  lastActive: number
}

/**
 * Validate an address before allocating a Chromium page.
 * @param value - address submitted by the authenticated browser client.
 * @param blockedOrigins - application origins the remote page may not open.
 * @returns the canonical HTTP(S) address.
 * @throws {RemoteBrowserError} when the address is malformed or reaches a private destination.
 */
export function normalizeRemoteBrowserUrl(value: string, blockedOrigins: readonly string[] = []): string {
  if (value.length === 0 || value.length > MAX_REMOTE_BROWSER_URL_LENGTH) {
    throw new RemoteBrowserError(400, '浏览器地址无效或过长', 'invalid_browser_url')
  }
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new RemoteBrowserError(400, '浏览器地址无效', 'invalid_browser_url')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new RemoteBrowserError(400, '远程浏览器只支持 HTTP 和 HTTPS 地址', 'unsupported_browser_protocol')
  }
  if (url.username !== '' || url.password !== '') {
    throw new RemoteBrowserError(400, '浏览器地址不能包含用户名或密码', 'browser_credentials_forbidden')
  }
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/gu, '')
  if (isIP(hostname) !== 0 || hostname === 'localhost' || hostname.endsWith('.localhost')
    || hostname.endsWith('.local') || hostname.endsWith('.internal')) {
    throw new RemoteBrowserError(400, '远程浏览器不能访问本机或内网地址', 'browser_private_address')
  }
  if (blockedOrigins.includes(url.origin)) {
    throw new RemoteBrowserError(400, '远程浏览器不能打开当前工作台', 'browser_application_origin')
  }
  return url.href
}

function viewportDimension(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) return minimum
  return Math.max(minimum, Math.min(maximum, Math.round(value)))
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

function titleFor(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return ''
  }
}

/**
 * Own authenticated Chromium page lifetimes, capacity, and idle cleanup.
 * Exact owner matching keeps one team member from controlling another member's page.
 */
export class RemoteBrowserPool implements RemoteBrowserService {
  private readonly sessions = new Map<string, BrowserSession>()
  private readonly pendingOwners = new Map<string, number>()
  private readonly idleTimer: ReturnType<typeof setInterval>
  private pendingOpens = 0
  private disposed = false

  /** @param config - capacity and idle policy. @param factory - Chromium context creator. */
  constructor(
    private readonly config: Pick<RemoteBrowserConfig, 'maxSessions' | 'maxSessionsPerUser' | 'idleTimeoutMs' | 'blockedOrigins'>,
    private readonly factory: RemoteBrowserRuntimeFactory,
  ) {
    this.idleTimer = setInterval(() => { void this.evictIdle() }, IDLE_SWEEP_MILLISECONDS)
    this.idleTimer.unref()
  }

  /** @param owner - team-and-user identity. @param request - initial address and viewport. */
  async open(owner: string, request: RemoteBrowserOpenRequest): Promise<RemoteBrowserOpenResult> {
    if (this.disposed) throw new RemoteBrowserError(503, '远程浏览器正在关闭', 'browser_unavailable')
    const url = normalizeRemoteBrowserUrl(request.url, this.config.blockedOrigins)
    const owned = [...this.sessions.values()].filter(session => session.owner === owner).length
      + (this.pendingOwners.get(owner) ?? 0)
    if (owned >= this.config.maxSessionsPerUser) {
      throw new RemoteBrowserError(429, '当前账号打开的远程浏览器过多，请先关闭一个标签', 'browser_session_limit')
    }
    if (this.sessions.size + this.pendingOpens >= this.config.maxSessions) {
      throw new RemoteBrowserError(503, '远程浏览器资源已满，请稍后重试', 'browser_capacity')
    }
    const width = viewportDimension(request.width, MIN_VIEWPORT_WIDTH, MAX_VIEWPORT_WIDTH)
    const height = viewportDimension(request.height, MIN_VIEWPORT_HEIGHT, MAX_VIEWPORT_HEIGHT)
    this.reserveOpen(owner)
    try {
      const runtime = await this.factory.create({ url, width, height })
      try {
        if (this.isDisposed()) throw new RemoteBrowserError(503, '远程浏览器正在关闭', 'browser_unavailable')
        const id = randomBytes(24).toString('base64url')
        const initial: RemoteBrowserViewState = { url, title: titleFor(url), loading: true,
          canGoBack: false, canGoForward: false }
        const session: BrowserSession = {
          id, owner, runtime, state: initial, failure: undefined, listeners: new Set(), lastActive: Date.now(),
          unsubscribeRuntime: () => {},
        }
        const unsubscribeRuntime = runtime.subscribe((event) => {
          if (event.type === 'state') session.state = event.state
          if (event.type === 'failure') session.failure = event
          for (const listener of session.listeners) listener(event)
        })
        session.unsubscribeRuntime = unsubscribeRuntime
        this.sessions.set(id, session)
        void runtime.navigate(url).catch((error: unknown) => {
          const message = error instanceof Error ? error.message : '远程浏览器无法加载页面'
          this.publish(session, { type: 'failure', code: 'browser_navigation_failed', message })
        })
        return { sessionId: id, state: runtime.getState() }
      } catch (error) {
        await runtime.close().catch(() => {})
        throw error
      }
    } finally {
      this.releaseOpen(owner)
    }
  }

  /** @param owner - team-and-user identity. @param sessionId - opaque session capability. @param control - page operation. */
  async control(owner: string, sessionId: string, control: RemoteBrowserControl): Promise<RemoteBrowserViewState> {
    const session = this.require(owner, sessionId)
    session.lastActive = Date.now()
    switch (control.action) {
      case 'navigate': {
        const url = normalizeRemoteBrowserUrl(control.url, this.config.blockedOrigins)
        await session.runtime.navigate(url)
        break
      }
      case 'back':
        await session.runtime.back()
        break
      case 'forward':
        await session.runtime.forward()
        break
      case 'reload':
        await session.runtime.reload()
        break
      case 'resize':
        await session.runtime.resize(
          viewportDimension(control.width, MIN_VIEWPORT_WIDTH, MAX_VIEWPORT_WIDTH),
          viewportDimension(control.height, MIN_VIEWPORT_HEIGHT, MAX_VIEWPORT_HEIGHT),
        )
        break
      case 'pointer':
        await session.runtime.pointer(control)
        break
      case 'wheel':
        await session.runtime.wheel(control.deltaX, control.deltaY)
        break
      case 'key':
      case 'insertText':
        await session.runtime.key(control)
        break
      default: {
        const exhaustive: never = control
        throw new Error(`remote browser: unsupported control ${JSON.stringify(exhaustive)}`)
      }
    }
    session.state = session.runtime.getState()
    return session.state
  }

  /** @param owner - team-and-user identity. @param sessionId - opaque session capability. */
  async close(owner: string, sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId)
    if (session === undefined || session.owner !== owner) return
    this.sessions.delete(sessionId)
    session.unsubscribeRuntime()
    await session.runtime.close()
  }

  /** @param owner - team-and-user identity. @param sessionId - opaque session capability. @param listener - event consumer. */
  subscribe(owner: string, sessionId: string, listener: (event: RemoteBrowserEvent) => void): () => void {
    const session = this.require(owner, sessionId)
    session.listeners.add(listener)
    session.lastActive = Date.now()
    listener({ type: 'state', state: session.runtime.getState() })
    if (session.failure !== undefined) listener(session.failure)
    return () => {
      session.listeners.delete(listener)
      session.lastActive = Date.now()
    }
  }

  /** @returns after every browser and the shared display process has stopped. */
  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    clearInterval(this.idleTimer)
    const sessions = [...this.sessions.values()]
    this.sessions.clear()
    await Promise.all(sessions.map(async (session) => {
      session.unsubscribeRuntime()
      await session.runtime.close()
    }))
    await this.factory.dispose()
  }

  private require(owner: string, sessionId: string): BrowserSession {
    const session = this.sessions.get(sessionId)
    if (session === undefined || session.owner !== owner) {
      throw new RemoteBrowserError(404, '远程浏览器会话不存在或已关闭', 'browser_session_not_found')
    }
    session.lastActive = Date.now()
    return session
  }

  private reserveOpen(owner: string): void {
    this.pendingOwners.set(owner, (this.pendingOwners.get(owner) ?? 0) + 1)
    this.pendingOpens += 1
  }

  private isDisposed(): boolean {
    return this.disposed
  }

  private releaseOpen(owner: string): void {
    const pending = this.pendingOwners.get(owner)
    if (pending === undefined || pending <= 1) this.pendingOwners.delete(owner)
    else this.pendingOwners.set(owner, pending - 1)
    this.pendingOpens = Math.max(0, this.pendingOpens - 1)
  }

  private publish(session: BrowserSession, event: RemoteBrowserEvent): void {
    if (event.type === 'failure') session.failure = event
    for (const listener of session.listeners) listener(event)
  }

  private async evictIdle(): Promise<void> {
    const now = Date.now()
    const idle = [...this.sessions.values()].filter(session =>
      session.listeners.size === 0 && now - session.lastActive >= this.config.idleTimeoutMs)
    await Promise.all(idle.map(async (session) => {
      this.sessions.delete(session.id)
      session.unsubscribeRuntime()
      await session.runtime.close()
    }))
  }
}

interface ScreencastFrame {
  readonly data: string
  readonly sessionId: number
  readonly metadata: { readonly deviceWidth: number; readonly deviceHeight: number }
}

/** One Playwright page with input, navigation, and JPEG screencast delivery. */
class PlaywrightBrowserRuntime implements RemoteBrowserRuntime {
  private readonly listeners = new Set<(event: RemoteBrowserEvent) => void>()
  private state: RemoteBrowserViewState
  private closed = false
  private closing: Promise<void> | undefined
  private screencast = false
  private viewportWidth: number
  private viewportHeight: number
  private syncGeneration = 0
  private refreshTimer: ReturnType<typeof setTimeout> | undefined

  private constructor(
    private readonly context: BrowserContext,
    private readonly page: Page,
    private readonly cdp: CDPSession,
    private readonly profile: string,
    initial: { readonly url: string; readonly width: number; readonly height: number },
  ) {
    this.viewportWidth = initial.width
    this.viewportHeight = initial.height
    this.state = { url: initial.url, title: titleFor(initial.url), loading: true,
      canGoBack: false, canGoForward: false }
    cdp.on('Page.screencastFrame', (frame) => { void this.acceptFrame(frame) })
    page.on('request', (request) => {
      if (request.isNavigationRequest() && request.frame() === page.mainFrame() && isHttpUrl(request.url())) {
        this.publishState({ ...this.state, url: request.url(), loading: true })
      }
    })
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame()) this.scheduleRefresh(false)
    })
    page.on('domcontentloaded', () => { this.scheduleRefresh(false) })
    page.on('load', () => { this.scheduleRefresh(false) })
    page.on('dialog', (dialog) => { void dialog.dismiss() })
    page.on('crash', () => {
      this.fail('browser_page_crashed', '远程浏览器页面已崩溃')
    })
    page.on('close', () => {
      if (!this.closed) this.fail('browser_page_closed', '远程浏览器页面已关闭')
    })
  }

  static async create(
    context: BrowserContext,
    profile: string,
    initial: { readonly url: string; readonly width: number; readonly height: number },
    timeoutMs: number,
  ): Promise<PlaywrightBrowserRuntime> {
    const page = context.pages()[0] ?? await context.newPage()
    page.setDefaultTimeout(timeoutMs)
    page.setDefaultNavigationTimeout(timeoutMs)
    const cdp = await context.newCDPSession(page)
    await cdp.send('Page.enable')
    const runtime = new PlaywrightBrowserRuntime(context, page, cdp, profile, initial)
    await runtime.resize(initial.width, initial.height)
    return runtime
  }

  getState(): RemoteBrowserViewState {
    return this.state
  }

  subscribe(listener: (event: RemoteBrowserEvent) => void): () => void {
    this.listeners.add(listener)
    listener({ type: 'state', state: this.state })
    if (!this.screencast) void this.startScreencast()
    return () => {
      this.listeners.delete(listener)
      if (this.listeners.size === 0 && this.screencast) void this.stopScreencast()
    }
  }

  async navigate(url: string): Promise<void> {
    this.publishState({ ...this.state, url, title: titleFor(url), loading: true })
    try {
      await this.page.goto(url, { waitUntil: 'domcontentloaded' })
    } catch (error) {
      if (!isHttpUrl(this.page.url())) throw error
    } finally {
      this.scheduleRefresh(false)
    }
  }

  async back(): Promise<void> {
    await this.page.goBack({ waitUntil: 'domcontentloaded' })
    this.scheduleRefresh(false)
  }

  async forward(): Promise<void> {
    await this.page.goForward({ waitUntil: 'domcontentloaded' })
    this.scheduleRefresh(false)
  }

  async reload(): Promise<void> {
    this.publishState({ ...this.state, loading: true })
    await this.page.reload({ waitUntil: 'domcontentloaded' })
    this.scheduleRefresh(false)
  }

  async resize(width: number, height: number): Promise<void> {
    this.viewportWidth = width
    this.viewportHeight = height
    await this.cdp.send('Emulation.setDeviceMetricsOverride', {
      width, height, deviceScaleFactor: 1, mobile: false,
    })
    if (this.screencast) {
      await this.stopScreencast()
      await this.startScreencast()
    }
  }

  async pointer(control: Extract<RemoteBrowserControl, { action: 'pointer' }>): Promise<void> {
    const button = control.button ?? 'left'
    if (control.event === 'click') {
      await this.page.mouse.click(control.x, control.y, { button })
    } else if (control.event === 'move') {
      await this.page.mouse.move(control.x, control.y)
    } else if (control.event === 'down') {
      await this.page.mouse.move(control.x, control.y)
      await this.page.mouse.down({ button })
    } else {
      await this.page.mouse.move(control.x, control.y)
      await this.page.mouse.up({ button })
    }
  }

  async wheel(deltaX: number, deltaY: number): Promise<void> {
    await this.page.mouse.wheel(deltaX, deltaY)
  }

  async key(control: Extract<RemoteBrowserControl, { action: 'key' | 'insertText' }>): Promise<void> {
    if (control.action === 'insertText') {
      await this.page.keyboard.insertText(control.text)
      return
    }
    const modifiers = control.modifiers ?? []
    for (const modifier of modifiers) await this.page.keyboard.down(modifier)
    try {
      await this.page.keyboard.press(control.key)
    } finally {
      for (const modifier of [...modifiers].reverse()) await this.page.keyboard.up(modifier)
    }
  }

  close(): Promise<void> {
    if (this.closing !== undefined) return this.closing
    this.closed = true
    if (this.refreshTimer !== undefined) clearTimeout(this.refreshTimer)
    this.closing = (async () => {
      await this.context.close().catch(() => {})
      await rm(this.profile, { recursive: true, force: true }).catch(() => {})
    })()
    return this.closing
  }

  private async startScreencast(): Promise<void> {
    if (this.closed || this.screencast) return
    this.screencast = true
    await this.cdp.send('Page.startScreencast', {
      format: 'jpeg',
      quality: 62,
      maxWidth: this.viewportWidth,
      maxHeight: this.viewportHeight,
      everyNthFrame: 1,
    }).catch(() => { this.screencast = false })
  }

  private async stopScreencast(): Promise<void> {
    if (!this.screencast) return
    this.screencast = false
    await this.cdp.send('Page.stopScreencast').catch(() => {})
  }

  private async acceptFrame(frame: ScreencastFrame): Promise<void> {
    if (this.closed) return
    for (const listener of this.listeners) {
      listener({ type: 'frame', data: frame.data, width: frame.metadata.deviceWidth,
        height: frame.metadata.deviceHeight })
    }
    await this.cdp.send('Page.screencastFrameAck', { sessionId: frame.sessionId }).catch(() => {})
  }

  private scheduleRefresh(loading: boolean): void {
    if (this.refreshTimer !== undefined) clearTimeout(this.refreshTimer)
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = undefined
      void this.refresh(loading)
    }, 120)
  }

  private async refresh(loading: boolean): Promise<void> {
    if (this.closed) return
    const generation = ++this.syncGeneration
    try {
      const currentUrl = this.page.url()
      const title = await this.page.title().catch(() => '')
      const history = await this.cdp.send('Page.getNavigationHistory')
        .catch(() => undefined) as { currentIndex: number; entries: unknown[] } | undefined
      if (generation !== this.syncGeneration) return
      const url = isHttpUrl(currentUrl) ? currentUrl : this.state.url
      this.publishState({
        url,
        title: title.trim() === '' ? titleFor(url) : title,
        loading,
        canGoBack: history === undefined ? this.state.canGoBack : history.currentIndex > 0,
        canGoForward: history === undefined
          ? this.state.canGoForward
          : history.currentIndex >= 0 && history.currentIndex < history.entries.length - 1,
      })
    } catch {
      // A page closing during a refresh is reported by its own close handler.
    }
  }

  private publishState(state: RemoteBrowserViewState): void {
    if (this.closed) return
    this.state = state
    for (const listener of this.listeners) listener({ type: 'state', state })
  }

  private fail(code: string, message: string): void {
    for (const listener of this.listeners) listener({ type: 'failure', code, message })
  }
}

/** Own the private X display and create one headful Chromium context per browser tab. */
class PlaywrightRuntimeFactory implements RemoteBrowserRuntimeFactory {
  private display: string | undefined
  private displayProcess: ChildProcess | undefined
  private displayStarting: Promise<string> | undefined
  private readonly profiles = new Set<string>()
  private readonly contexts = new Set<BrowserContext>()
  private disposed = false

  constructor(private readonly config: RemoteBrowserConfig) {}

  async create(request: { readonly url: string; readonly width: number; readonly height: number }): Promise<RemoteBrowserRuntime> {
    if (this.isDisposed()) throw new RemoteBrowserError(503, '远程浏览器正在关闭', 'browser_unavailable')
    const display = await this.ensureDisplay()
    if (this.isDisposed()) throw new RemoteBrowserError(503, '远程浏览器正在关闭', 'browser_unavailable')
    const profile = await mkdtemp(join(tmpdir(), 'dsh-remote-browser-'))
    this.profiles.add(profile)
    let context: BrowserContext | undefined
    try {
      context = await chromium.launchPersistentContext(profile, {
        executablePath: this.config.chromePath,
        headless: false,
        acceptDownloads: false,
        locale: 'zh-CN',
        viewport: { width: request.width, height: request.height },
        timeout: this.config.navigationTimeoutMs,
        args: [
          '--no-sandbox',
          '--disable-dev-shm-usage',
          '--disable-blink-features=AutomationControlled',
          '--disable-features=Translate,MediaRouter',
          '--no-first-run',
          '--no-default-browser-check',
          '--password-store=basic',
          '--use-mock-keychain',
        ],
        ...this.config.proxyUrl === undefined ? {} : {
          proxy: {
            server: this.config.proxyUrl,
            ...this.config.proxyBypass === undefined ? {} : { bypass: this.config.proxyBypass },
          },
        },
        env: { ...scrubbedParentEnv(), DISPLAY: display, LANG: 'zh-CN.UTF-8' },
      })
      if (this.isDisposed()) throw new RemoteBrowserError(503, '远程浏览器正在关闭', 'browser_unavailable')
      this.contexts.add(context)
      const blockedOrigins = this.config.blockedOrigins
      await context.route('**/*', (route) => {
        const url = route.request().url()
        if (!isHttpUrl(url)) return route.abort('blockedbyclient')
        try {
          if (blockedOrigins.includes(new URL(url).origin)) return route.abort('blockedbyclient')
        } catch {
          return route.abort('blockedbyclient')
        }
        return route.continue()
      })
      context.on('page', (page) => {
        if (page !== context?.pages()[0]) void page.close().catch(() => {})
      })
      return await PlaywrightBrowserRuntime.create(context, profile, request, this.config.navigationTimeoutMs)
    } catch (error) {
      if (context !== undefined) await context.close().catch(() => {})
      this.profiles.delete(profile)
      await rm(profile, { recursive: true, force: true }).catch(() => {})
      if (error instanceof RemoteBrowserError) throw error
      const message = error instanceof Error ? error.message : String(error)
      throw new RemoteBrowserError(503, `远程浏览器启动失败：${message}`, 'browser_start_failed')
    }
  }

  async dispose(): Promise<void> {
    this.disposed = true
    this.displayStarting = undefined
    await Promise.all([...this.contexts].map(context => context.close().catch(() => {})))
    this.contexts.clear()
    await Promise.all([...this.profiles].map(profile => rm(profile, { recursive: true, force: true }).catch(() => {})))
    this.profiles.clear()
    const child = this.displayProcess
    this.displayProcess = undefined
    this.display = undefined
    if (child !== undefined && child.exitCode === null) {
      child.kill('SIGTERM')
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => { child.kill('SIGKILL'); resolve() }, 1_000)
        timer.unref()
        child.once('exit', () => { clearTimeout(timer); resolve() })
      })
    }
  }

  private isDisposed(): boolean {
    return this.disposed
  }

  private ensureDisplay(): Promise<string> {
    if (this.display !== undefined) return Promise.resolve(this.display)
    if (this.displayStarting !== undefined) return this.displayStarting
    const starting = this.startDisplay()
    this.displayStarting = starting
    return starting.catch((error: unknown) => {
      if (this.displayStarting === starting) this.displayStarting = undefined
      throw error
    })
  }

  private async startDisplay(): Promise<string> {
    for (let number = 100; number < 200; number += 1) {
      const socket = `/tmp/.X11-unix/X${String(number)}`
      const lock = `/tmp/.X${String(number)}-lock`
      if (existsSync(socket) || existsSync(lock)) continue
      const display = `:${String(number)}`
      const child = spawn(this.config.xvfbPath, [display, '-screen', '0', '1920x1200x24', '-nolisten', 'tcp'], {
        stdio: 'ignore',
      })
      let spawnFailed = false
      child.once('error', () => { spawnFailed = true })
      const started = await waitForDisplay(child, socket, () => spawnFailed)
      if (this.isDisposed()) {
        child.kill('SIGKILL')
        throw new RemoteBrowserError(503, '远程浏览器正在关闭', 'browser_unavailable')
      }
      if (!started) {
        child.kill('SIGKILL')
        continue
      }
      this.displayProcess = child
      this.display = display
      child.once('exit', () => {
        if (this.displayProcess === child) {
          this.displayProcess = undefined
          this.display = undefined
          this.displayStarting = undefined
        }
      })
      return display
    }
    throw new RemoteBrowserError(503, '找不到可用的虚拟显示，远程浏览器暂时不可用', 'browser_display_unavailable')
  }
}

async function waitForDisplay(child: ChildProcess, socket: string, failed: () => boolean): Promise<boolean> {
  const deadline = Date.now() + DISPLAY_START_TIMEOUT_MILLISECONDS
  while (Date.now() < deadline) {
    if (existsSync(socket)) return true
    if (child.exitCode !== null || failed()) return false
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  return false
}

/**
 * Create the production runtime factory.
 * @param config - Chromium, network, capacity, and timeout settings.
 * @returns a factory whose contexts are released by {@link RemoteBrowserPool.dispose}.
 */
export function createPlaywrightRuntimeFactory(config: RemoteBrowserConfig): RemoteBrowserRuntimeFactory {
  return new PlaywrightRuntimeFactory(config)
}

/** @internal Exported for the HTTP layer's retry delay without another timer owner. */
export const REMOTE_BROWSER_STREAM_RETRY_MILLISECONDS = STREAM_RETRY_MILLISECONDS

/** @internal Default viewport used before the connected Sidebar reports its dimensions. */
export const REMOTE_BROWSER_DEFAULT_VIEWPORT = {
  width: DEFAULT_VIEWPORT_WIDTH,
  height: DEFAULT_VIEWPORT_HEIGHT,
} as const
