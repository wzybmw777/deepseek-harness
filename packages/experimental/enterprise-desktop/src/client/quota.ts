/** Browser-side quota state for the enterprise workbench. */

/** Team allowance and the signed-in member's usage for one monthly cycle. */
export interface DesktopQuota {
  readonly planName: string
  readonly totalTokens: number
  readonly usedTokens: number
  readonly remainingTokens: number
  readonly userTokens: number
  readonly cycleStartsAt: string
  readonly cycleEndsAt: string
}

/** One successful billing snapshot returned by the local Host route. */
export interface DesktopQuotaState {
  readonly quota: DesktopQuota
  readonly planName: string
  readonly updatedAt: string
  readonly purchaseUrl: string
}

/** Loading, usable, exhausted, or retryable quota presentation. */
export type DesktopQuotaSnapshot =
  | { readonly status: 'loading'; readonly refreshing: boolean }
  | { readonly status: 'available'; readonly refreshing: boolean; readonly data: DesktopQuotaState }
  | { readonly status: 'exhausted'; readonly refreshing: boolean; readonly data?: DesktopQuotaState }
  | { readonly status: 'unavailable'; readonly refreshing: boolean; readonly data?: DesktopQuotaState }

/** Local route that projects the signed-in member's cloud quota. */
export const DESKTOP_BILLING_PATH = '/enterprise/api/desktop/billing'

/** Gateway error code that exhausts the team's monthly allowance. */
export const DESKTOP_QUOTA_EXHAUSTED = 'quota_exhausted'

export interface DesktopQuotaStoreOptions {
  readonly fetch?: typeof globalThis.fetch
  readonly path?: string
  readonly intervalMs?: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function tokenCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function timestamp(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
}

function httpUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false
  try {
    const url = new URL(value)
    return (url.protocol === 'https:' || url.protocol === 'http:') && url.username === '' && url.password === ''
  } catch {
    return false
  }
}

function state(value: unknown): DesktopQuotaState {
  if (!isRecord(value) || !isRecord(value.quota)) throw new Error('invalid enterprise billing response')
  const source = value.quota
  const { planName, totalTokens, usedTokens, remainingTokens, userTokens, cycleStartsAt, cycleEndsAt } = source
  if (typeof planName !== 'string' || planName.trim() === '' || planName.length > 120
    || typeof value.planName !== 'string' || value.planName.trim() === '' || value.planName.length > 120
    || !tokenCount(totalTokens) || !tokenCount(usedTokens) || !tokenCount(remainingTokens) || !tokenCount(userTokens)
    || !timestamp(cycleStartsAt) || !timestamp(cycleEndsAt) || !timestamp(value.updatedAt)
    || !httpUrl(value.purchaseUrl)) {
    throw new Error('invalid enterprise billing response')
  }
  return {
    quota: { planName, totalTokens, usedTokens, remainingTokens, userTokens, cycleStartsAt, cycleEndsAt },
    planName: value.planName,
    updatedAt: value.updatedAt,
    purchaseUrl: value.purchaseUrl,
  }
}

function view(status: 'available' | 'exhausted' | 'unavailable', data: DesktopQuotaState | undefined, refreshing: boolean): DesktopQuotaSnapshot {
  if (status === 'available') {
    if (data === undefined) throw new Error('available quota requires data')
    return { status, refreshing, data }
  }
  return data === undefined ? { status, refreshing } : { status, refreshing, data }
}

/** Coalesces billing reads and converts typed gateway exhaustion into a visible state. */
export class DesktopQuotaStore {
  readonly #fetch: typeof globalThis.fetch
  readonly #path: string
  #snapshot: DesktopQuotaSnapshot = { status: 'loading', refreshing: false }
  #listeners = new Set<() => void>()
  #request: Promise<void> | undefined
  #abort: AbortController | undefined
  #disposed = false

  constructor(options: DesktopQuotaStoreOptions = {}) {
    this.#fetch = options.fetch ?? globalThis.fetch.bind(globalThis)
    this.#path = options.path ?? DESKTOP_BILLING_PATH
  }

  /** Current presentation state. */
  getSnapshot = (): DesktopQuotaSnapshot => this.#snapshot

  /** Subscribe to presentation changes; returns an idempotent unsubscribe. */
  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener)
    return () => { this.#listeners.delete(listener) }
  }

  /**
   * Read the current quota. Concurrent callers share one request; a failed read
   * retains the last successful snapshot for display only.
   * @returns completion after the request settles.
   */
  refresh(): Promise<void> {
    if (this.#disposed) return Promise.resolve()
    if (this.#request !== undefined) return this.#request
    const running = this.#load().finally(() => {
      if (this.#request === running) this.#request = undefined
      this.#abort = undefined
    })
    this.#request = running
    this.#emit({ ...this.#snapshot, refreshing: true })
    return running
  }

  /**
   * Apply a typed gateway failure without waiting for the next billing read.
   * @param error - failure reported by the model surface.
   */
  noteGatewayError(error: { readonly code?: string }): void {
    if (error.code !== DESKTOP_QUOTA_EXHAUSTED && error.code !== 'QUOTA') return
    const data = 'data' in this.#snapshot ? this.#snapshot.data : undefined
    this.#request = undefined
    this.#abort?.abort()
    this.#emit(view('exhausted', data, false))
  }

  /**
   * Start an immediate read and periodic refresh.
   * @param intervalMs - refresh cadence; defaults to one minute.
   * @returns teardown for the timer and visibility listener.
   */
  start(intervalMs = 60_000): () => void {
    void this.refresh()
    const timer = setInterval(() => { void this.refresh() }, intervalMs)
    const onVisible = (): void => { if (document.visibilityState === 'visible') void this.refresh() }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }

  /** Abort an in-flight read and release every subscriber. */
  dispose(): void {
    this.#disposed = true
    this.#abort?.abort()
    this.#abort = undefined
    this.#request = undefined
    this.#listeners.clear()
  }

  async #load(): Promise<void> {
    const abort = new AbortController()
    this.#abort = abort
    try {
      const response = await this.#fetch(this.#path, {
        method: 'GET',
        headers: { accept: 'application/json' },
        credentials: 'same-origin',
        cache: 'no-store',
        signal: abort.signal,
      })
      if (!response.ok) throw new Error(`enterprise billing failed with ${String(response.status)}`)
      const next = state(await response.json())
      this.#emit(view(next.quota.remainingTokens > 0 ? 'available' : 'exhausted', next, false))
    } catch (error) {
      if (this.#disposed || abort.signal.aborted) return
      const data = 'data' in this.#snapshot ? this.#snapshot.data : undefined
      this.#emit(view('unavailable', data, false))
      console.warn('[enterprise-desktop] reading token quota failed:', error)
    }
  }

  #emit(snapshot: DesktopQuotaSnapshot): void {
    this.#snapshot = snapshot
    for (const listener of [...this.#listeners]) listener()
  }
}
