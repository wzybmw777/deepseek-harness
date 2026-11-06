/** BrowserFrame implementation backed by one authenticated server-side Chromium page. */

import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { RemoteBrowserControl, RemoteBrowserEvent, RemoteBrowserViewState } from '../../../types.ts'
import { emptyBrowserFrame, type BrowserFrame, type BrowserFrameState } from '../BrowserFrame.ts'
import type { BrowserPageOptions } from '../BrowserPage.ts'
import { browserAddressCheckpoint } from '../BrowserPersistence.ts'
import { parseBrowserAddress, type BrowserTarget } from '../url.ts'
import { RemoteBrowserClient, RemoteBrowserRequestError } from './client.ts'
import type { RemoteBrowserPresentation } from './RemoteBrowserPresentation.ts'

const RETRY_MILLISECONDS = 750
const MAX_STREAM_RETRIES = 8

/** One remote page with persisted navigation and a reconnectable screen stream. */
export class RemoteBrowserSession implements BrowserFrame {
  private readonly store: SnapshotStore<BrowserFrameState>
  private target: BrowserTarget | undefined
  private pendingTarget: BrowserTarget | undefined
  private sessionId: string | undefined
  private opening: Promise<void> | undefined
  private streamController: AbortController | undefined
  private streamLoop: Promise<void> | undefined
  private desiredWidth = 960
  private desiredHeight = 720
  private revision = 0
  private disposed = false
  private disposal: Promise<void> | undefined

  /**
   * @param options - persisted checkpoint and callbacks.
   * @param endpoint - same-origin remote Browser API prefix.
   * @param presentation - canvas and input adapter.
   */
  constructor(
    private readonly options: BrowserPageOptions,
    endpoint: string,
    private readonly presentation: RemoteBrowserPresentation,
  ) {
    this.client = new RemoteBrowserClient(endpoint)
    this.target = options.initial === undefined || options.initial.index < 0
      ? undefined
      : options.initial.entries[options.initial.index]
    this.store = createSnapshotStore(emptyBrowserFrame())
  }

  private readonly client: RemoteBrowserClient

  /** @returns immutable carrier-neutral navigation state. */
  getSnapshot = (): BrowserFrameState => this.store.getSnapshot()
  /** @param listener - state invalidation. @returns unsubscribe callback. */
  subscribe = (listener: () => void): (() => void) => this.store.subscribe(listener)

  /** @param target - validated address; a new address reuses the page or allocates it on first use. */
  loadUrl(target: BrowserTarget): void {
    if (this.disposed) return
    this.revision += 1
    this.target = target
    this.pendingTarget = target
    this.publish({ target, address: 'requested', loading: true, canGoBack: false, canGoForward: false,
      error: undefined, sandboxEnabled: undefined })
    this.persist(target)
    if (this.sessionId !== undefined) {
      const sessionId = this.sessionId
      void this.client.control(sessionId, { action: 'navigate', url: target.url })
        .then((state) => { this.applyState(state) })
        .catch((error: unknown) => { this.fail(error) })
      return
    }
    this.startOpen()
  }

  /** Move backward in Chromium history. */
  goBack(): void {
    this.command({ action: 'back' })
  }

  /** Move forward in Chromium history. */
  goForward(): void {
    this.command({ action: 'forward' })
  }

  /** Reload Chromium's current document, or start a saved target. */
  reload(): void {
    if (this.sessionId === undefined) {
      if (this.target !== undefined) this.loadUrl(this.target)
      return
    }
    this.publish({ ...this.store.getSnapshot(), loading: true, error: undefined })
    this.command({ action: 'reload' })
  }

  /**
   * Update the Chromium viewport after the Sidebar measures its content container.
   * @param width - CSS width. @param height - CSS height.
   */
  resizeViewport(width: number, height: number): void {
    this.desiredWidth = width
    this.desiredHeight = height
    if (this.sessionId !== undefined) this.command({ action: 'resize', width, height })
  }

  /**
   * Deliver input originating from the remote canvas.
   * @param control - pointer, wheel, keyboard, or resize operation.
   */
  controlFromPresentation(control: RemoteBrowserControl): void {
    if (this.disposed || this.sessionId === undefined) return
    void this.client.control(this.sessionId, control)
      .then((state) => { if (control.action !== 'resize') this.applyState(state) })
      .catch((error: unknown) => {
        console.error('Remote browser input failed', error)
      })
  }

  /** @returns after the stream, Chromium page, and canvas listeners are released. */
  dispose(): Promise<void> {
    if (this.disposal !== undefined) return this.disposal
    this.disposed = true
    this.streamController?.abort()
    this.streamController = undefined
    this.presentation.dispose()
    const sessionId = this.sessionId
    this.sessionId = undefined
    this.disposal = sessionId === undefined
      ? Promise.resolve()
      : this.client.close(sessionId).catch((error: unknown) => {
        console.error('Remote browser session close failed', error)
      })
    return this.disposal
  }

  private startOpen(): void {
    if (this.opening !== undefined || this.disposed) return
    const first = this.pendingTarget
    if (first === undefined) return
    this.opening = this.client.open({ url: first.url, width: this.desiredWidth, height: this.desiredHeight })
      .then((result) => {
        if (this.disposed) {
          void this.client.close(result.sessionId)
          return
        }
        this.sessionId = result.sessionId
        this.applyState(result.state)
        this.startStream()
        const pending = this.pendingTarget
        if (pending !== undefined && pending.url !== first.url) {
          return this.client.control(result.sessionId, { action: 'navigate', url: pending.url })
            .then((state) => { this.applyState(state) })
        }
      })
      .catch((error: unknown) => { this.fail(error) })
      .finally(() => { this.opening = undefined })
  }

  private command(control: RemoteBrowserControl): void {
    if (this.disposed || this.sessionId === undefined) return
    void this.client.control(this.sessionId, control)
      .then((state) => { this.applyState(state) })
      .catch((error: unknown) => { this.fail(error) })
  }

  private startStream(): void {
    if (this.disposed || this.sessionId === undefined || this.streamLoop !== undefined) return
    this.streamLoop = this.consumeStream(this.sessionId)
      .catch((error: unknown) => {
        if (!this.disposed) this.fail(error)
      })
      .finally(() => { this.streamLoop = undefined })
  }

  private async consumeStream(sessionId: string): Promise<void> {
    let retries = 0
    while (!this.disposed && this.sessionId === sessionId) {
      const controller = new AbortController()
      this.streamController = controller
      try {
        await this.client.stream(sessionId, (event) => { this.accept(event) }, controller.signal)
        retries += 1
      } catch (error) {
        if (this.isDisposed() || this.streamController !== controller) return
        if (error instanceof RemoteBrowserRequestError && (error.status === 401 || error.status === 403 || error.status === 404)) {
          throw error
        }
        retries += 1
      } finally {
        if (this.streamController === controller) this.streamController = undefined
      }
      if (retries > MAX_STREAM_RETRIES) throw new RemoteBrowserRequestError(0, '')
      await delay(RETRY_MILLISECONDS)
    }
  }

  private accept(event: RemoteBrowserEvent): void {
    if (this.disposed) return
    switch (event.type) {
      case 'state':
        this.applyState(event.state)
        break
      case 'frame':
        this.presentation.showFrame(event.data, event.width, event.height)
        break
      case 'failure':
        this.fail(new Error(event.message))
        break
      default: {
        const exhaustive: never = event
        console.error('Remote browser sent an unsupported event', exhaustive)
      }
    }
  }

  private applyState(state: RemoteBrowserViewState): void {
    if (this.disposed) return
    const parsed = parseBrowserAddress(state.url)
    if (parsed.ok) {
      const title = state.title.trim() === '' ? parsed.target.title : state.title
      const target: BrowserTarget = { ...parsed.target, title }
      this.target = target
      this.pendingTarget = undefined
      this.persist(target)
      this.presentation.setTitle(title)
      this.publish({ target, address: 'observed', loading: state.loading,
        canGoBack: state.canGoBack, canGoForward: state.canGoForward, error: undefined, sandboxEnabled: undefined })
      return
    }
    this.publish({ ...this.store.getSnapshot(), loading: state.loading,
      canGoBack: state.canGoBack, canGoForward: state.canGoForward })
  }

  private publish(next: BrowserFrameState): void {
    if (!this.disposed) this.store.set(next)
  }

  private persist(target: BrowserTarget): void {
    if (this.disposed) return
    this.options.persist(browserAddressCheckpoint(target, this.revision))
  }

  private fail(error: unknown): void {
    if (this.disposed) return
    const message = error instanceof Error ? error.message : String(error)
    this.publish({ ...this.store.getSnapshot(), loading: false,
      error: { code: undefined, description: message } })
  }

  private isDisposed(): boolean {
    return this.disposed
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, milliseconds) })
}
