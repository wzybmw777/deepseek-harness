/** Iframe navigation provider with bounded application-known history. */
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { IframePresentation } from '../view/IframePresentation.ts'
import { emptyBrowserFrame, type BrowserFrame, type BrowserFrameState, type BrowserLoadError, type BrowserSandboxControl } from './BrowserFrame.ts'
import type { BrowserPageOptions } from './BrowserPage.ts'
import { BrowserNavigation } from './BrowserNavigation.ts'
import type { BrowserTarget } from './url.ts'

/** How long an iframe may remain silent before the UI offers recovery. */
export const IFRAME_LOAD_TIMEOUT_MS = 20_000

/** Owns iframe navigation; the view reports loads without reading cross-origin content. */
export class IframeImpl implements BrowserFrame {
  readonly sandbox: BrowserSandboxControl = { setEnabled: (enabled) => { this.setSandbox(enabled) } }
  private readonly navigation: BrowserNavigation
  private readonly store: SnapshotStore<BrowserFrameState>
  private sandboxed: boolean
  private error: BrowserLoadError | undefined
  private loadTimer: ReturnType<typeof setTimeout> | undefined
  private disposed = false
  private disposal: Promise<void> | undefined

  /** @param options - initial checkpoint and persistence writer. @param presentation - iframe DOM adapter. */
  constructor(private readonly options: BrowserPageOptions, private readonly presentation: IframePresentation) {
    this.navigation = new BrowserNavigation(options.initial)
    this.sandboxed = options.sandboxEnabled
    this.store = createSnapshotStore({ ...emptyBrowserFrame(), sandboxEnabled: this.sandboxed })
  }

  /**
   * Record a controlled load or a later navigation to an unreadable address.
   * @param revision - document generation whose iframe emitted load.
   */
  handleLoaded(revision: number): void {
    if (this.disposed) return
    if (this.navigation.snapshot.request?.revision !== revision) return
    this.clearLoadTimer()
    this.error = undefined
    this.navigation.frameLoaded(revision)
    this.publish()
  }

  /**
   * Publish a failure only for the current document generation.
   * @param revision - document generation whose iframe reported failure.
   */
  handleLoadFailed(revision: number): void {
    if (this.disposed || this.navigation.snapshot.request?.revision !== revision) return
    this.clearLoadTimer()
    this.error = { code: undefined, description: undefined }
    this.publish()
  }

  /** @returns immutable navigation state. */
  getSnapshot = (): BrowserFrameState => this.store.getSnapshot()
  /** @param listener - state invalidation. @returns unsubscribe callback. */
  subscribe = (listener: () => void): (() => void) => this.store.subscribe(listener)

  /** @param target - validated address; submitting the current address reloads it. */
  loadUrl(target: BrowserTarget): void {
    if (this.disposed) return
    const request = BrowserNavigation.current(this.navigation.snapshot)?.url === target.url
      ? this.navigation.reload() : this.navigation.navigate(target)
    this.load(request)
  }

  /** Move through application-known history while the iframe address remains known. */
  goBack(): void { if (!this.disposed) this.load(this.navigation.back()) }
  /** Move through application-known history while the iframe address remains known. */
  goForward(): void { if (!this.disposed) this.load(this.navigation.forward()) }
  /** Reload the last application-known address. */
  reload(): void { if (!this.disposed) this.load(this.navigation.reload()) }

  /** @returns after the presentation has been removed; repeated calls join disposal. */
  dispose(): Promise<void> {
    if (this.disposal !== undefined) return this.disposal
    this.disposed = true
    this.clearLoadTimer()
    this.presentation.dispose()
    this.disposal = Promise.resolve()
    return this.disposal
  }

  private setSandbox(enabled: boolean): void {
    if (this.disposed || enabled === this.sandboxed) return
    this.sandboxed = enabled
    if (this.store.getSnapshot().target === undefined) {
      this.store.set({ ...this.store.getSnapshot(), sandboxEnabled: enabled })
      return
    }
    this.load(this.navigation.reload())
  }

  private load(request: ReturnType<BrowserNavigation['navigate']> | undefined): void {
    if (request === undefined) return
    this.clearLoadTimer()
    this.error = undefined
    this.publish()
    const revision = request.revision
    this.loadTimer = setTimeout(() => {
      this.loadTimer = undefined
      if (this.disposed) return
      const state = this.navigation.snapshot
      if (state.request?.revision !== revision || state.navigation.status !== 'loading') return
      this.error = { code: undefined, description: undefined, timedOut: true }
      this.publish()
    }, IFRAME_LOAD_TIMEOUT_MS)
    this.presentation.show({ target: request.target, revision: request.revision, sandboxed: this.sandboxed })
  }

  private clearLoadTimer(): void {
    if (this.loadTimer === undefined) return
    clearTimeout(this.loadTimer)
    this.loadTimer = undefined
  }

  private snapshot(): BrowserFrameState {
    const state = this.navigation.snapshot
    const target = BrowserNavigation.current(state)
    return { target, address: state.navigation.status === 'unknown' ? 'unknown' : 'requested',
      loading: state.navigation.status === 'loading' && this.error === undefined,
      canGoBack: this.navigation.canGoBack, canGoForward: this.navigation.canGoForward,
      error: this.error, sandboxEnabled: this.sandboxed }
  }

  private publish(): void {
    this.store.set(this.snapshot())
    this.options.persist(this.navigation.snapshot)
  }
}
