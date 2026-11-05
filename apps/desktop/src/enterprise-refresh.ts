/** Timed enterprise access-token rotation owned by Electron main. */

import { EnterpriseAuthTransportError, EnterpriseSignOutRequired, type EnterpriseAuthSession } from './enterprise-auth.ts'

export interface EnterpriseRefreshClient {
  refresh(): Promise<EnterpriseAuthSession>
}

export interface EnterpriseRefreshOptions {
  readonly client: EnterpriseRefreshClient
  readonly apply: (session: EnterpriseAuthSession) => Promise<void>
  readonly onSignOut: (error: EnterpriseSignOutRequired) => Promise<void>
  readonly now?: () => number
  readonly refreshLeadMs?: number
  readonly retryMinMs?: number
  readonly retryMaxMs?: number
}

/** Renews a short-lived access grant and delays recoverable transport failures. */
export class EnterpriseAccessRefresh {
  private timer: ReturnType<typeof setTimeout> | undefined
  private retryMs: number
  private disposed = false

  constructor(private readonly options: EnterpriseRefreshOptions) {
    this.retryMs = options.retryMinMs ?? 5_000
  }

  /**
   * Schedule the first refresh from the supplied access expiry.
   * @param session - current access grant.
   */
  start(session: EnterpriseAuthSession): void {
    this.disposed = false
    this.retryMs = this.options.retryMinMs ?? 5_000
    this.schedule(session)
  }

  /** Cancel the pending refresh and any retry. */
  clear(): void {
    if (this.timer !== undefined) clearTimeout(this.timer)
    this.timer = undefined
  }

  /** Permanently stop scheduling refreshes. */
  dispose(): void {
    this.disposed = true
    this.clear()
  }

  private schedule(session: EnterpriseAuthSession): void {
    const now = this.options.now?.() ?? Date.now()
    const expiresAt = Date.parse(session.accessExpiresAt)
    const lead = this.options.refreshLeadMs ?? 60_000
    const delay = Number.isFinite(expiresAt) ? Math.max(250, expiresAt - now - lead) : 0
    this.clear()
    this.timer = setTimeout(() => { void this.refresh() }, delay)
    this.timer.unref?.()
  }

  private async refresh(): Promise<void> {
    if (this.disposed) return
    try {
      const session = await this.options.client.refresh()
      await this.options.apply(session)
      this.retryMs = this.options.retryMinMs ?? 5_000
      this.schedule(session)
    } catch (error) {
      if (this.disposed) return
      if (error instanceof EnterpriseSignOutRequired) {
        this.clear()
        await this.options.onSignOut(error)
        return
      }
      if (!(error instanceof EnterpriseAuthTransportError)) {
        this.clear()
        await this.options.onSignOut(new EnterpriseSignOutRequired('desktop_auth_invalid'))
        return
      }
      this.clear()
      const retry = this.retryMs
      this.retryMs = Math.min(this.retryMs * 2, this.options.retryMaxMs ?? 5 * 60_000)
      this.timer = setTimeout(() => { void this.retry() }, retry)
      this.timer.unref?.()
    }
  }

  private async retry(): Promise<void> {
    if (this.disposed) return
    try {
      const session = await this.options.client.refresh()
      await this.options.apply(session)
      this.retryMs = this.options.retryMinMs ?? 5_000
      this.schedule(session)
    } catch (error) {
      if (this.disposed) return
      if (error instanceof EnterpriseSignOutRequired) {
        this.clear()
        await this.options.onSignOut(error)
        return
      }
      if (!(error instanceof EnterpriseAuthTransportError)) {
        this.clear()
        await this.options.onSignOut(new EnterpriseSignOutRequired('desktop_auth_invalid'))
        return
      }
      const retry = this.retryMs
      this.retryMs = Math.min(this.retryMs * 2, this.options.retryMaxMs ?? 5 * 60_000)
      this.timer = setTimeout(() => { void this.retry() }, retry)
      this.timer.unref?.()
    }
  }
}
