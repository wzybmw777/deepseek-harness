/** Enterprise desktop login, refresh rotation, and sign-out coordination. */

import type { EnterpriseCredentialStore } from './enterprise-credentials.ts'
import type { DesktopBootstrap, EnterpriseCredentialRecord } from './enterprise-types.ts'

/** Short-lived access token and identity bootstrap returned by login and refresh. */
export interface EnterpriseAuthSession {
  readonly accessToken: string
  readonly accessExpiresAt: string
  readonly bootstrap: DesktopBootstrap
}

/** Desktop login failure code suitable for the welcome renderer. */
export type EnterpriseLoginFailure = 'invalid_credentials' | 'network' | 'server'

/** Login failure without server diagnostics or credential material. */
export class EnterpriseLoginError extends Error {
  /** @param code - stable welcome failure code. */
  constructor(readonly code: EnterpriseLoginFailure) {
    super('Enterprise sign-in failed')
    this.name = 'EnterpriseLoginError'
  }
}

/** Terminal authentication failure that requires the local lifecycle to sign out. */
export class EnterpriseSignOutRequired extends Error {
  /** @param code - server or local failure code. */
  constructor(readonly code = 'desktop_auth_revoked') {
    super('Enterprise sign-in is no longer valid')
    this.name = 'EnterpriseSignOutRequired'
  }
}

/** Recoverable transport failure that retains the current credential. */
export class EnterpriseAuthTransportError extends Error {
  /** @param message - credential-free explanation. */
  constructor(message = 'Enterprise cloud is unreachable') {
    super(message)
    this.name = 'EnterpriseAuthTransportError'
  }
}

export interface EnterpriseAuthClientOptions {
  readonly store: EnterpriseCredentialStore
  readonly cloudBaseUrl: string
  readonly fetch?: typeof fetch
  readonly now?: () => number
}

interface WireGrant {
  readonly deviceId: string
  readonly accessToken: string
  readonly accessExpiresAt: string
  readonly refreshToken: string
  readonly refreshExpiresAt: string
  readonly bootstrap: DesktopBootstrap
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new EnterpriseLoginError('server')
  return value as Record<string, unknown>
}

function text(value: Record<string, unknown>, field: string): string {
  const candidate = value[field]
  if (typeof candidate !== 'string' || candidate === '') throw new EnterpriseLoginError('server')
  return candidate
}

function bootstrap(value: unknown): DesktopBootstrap {
  const candidate = record(value)
  const user = record(candidate.user)
  const team = record(candidate.team)
  const policy = record(candidate.policy)
  const endpoints = record(candidate.endpoints)
  if (candidate.apiVersion !== 1 || policy.consumerAnalytics !== false || policy.crashReports !== 'enterprise-support') {
    throw new EnterpriseLoginError('server')
  }
  return {
    apiVersion: 1,
    cloudBaseUrl: text(candidate, 'cloudBaseUrl'),
    profileKey: text(candidate, 'profileKey'),
    accessExpiresAt: text(candidate, 'accessExpiresAt'),
    user: {
      id: text(user, 'id'),
      email: text(user, 'email'),
      name: text(user, 'name'),
      roleId: text(user, 'roleId'),
    },
    team: { id: text(team, 'id'), name: text(team, 'name'), slug: text(team, 'slug') },
    minimumClientVersion: text(candidate, 'minimumClientVersion'),
    policy: {
      consumerAnalytics: false,
      crashReports: 'enterprise-support',
      supportEmail: text(policy, 'supportEmail'),
    },
    endpoints: {
      bootstrap: text(endpoints, 'bootstrap') as DesktopBootstrap['endpoints']['bootstrap'],
      models: text(endpoints, 'models') as DesktopBootstrap['endpoints']['models'],
      resources: text(endpoints, 'resources') as DesktopBootstrap['endpoints']['resources'],
      sessions: text(endpoints, 'sessions') as DesktopBootstrap['endpoints']['sessions'],
      plugins: text(endpoints, 'plugins') as DesktopBootstrap['endpoints']['plugins'],
      billing: text(endpoints, 'billing') as DesktopBootstrap['endpoints']['billing'],
    },
  }
}

function grant(value: unknown): WireGrant {
  const candidate = record(value)
  return {
    deviceId: text(candidate, 'deviceId'),
    accessToken: text(candidate, 'accessToken'),
    accessExpiresAt: text(candidate, 'accessExpiresAt'),
    refreshToken: text(candidate, 'refreshToken'),
    refreshExpiresAt: text(candidate, 'refreshExpiresAt'),
    bootstrap: bootstrap(candidate.bootstrap),
  }
}

function origin(value: string): string {
  const url = new URL(value)
  if ((url.protocol !== 'https:' && url.protocol !== 'http:') || url.username !== '' || url.password !== ''
    || url.search !== '' || url.hash !== '' || (url.pathname !== '' && url.pathname !== '/')) {
    throw new EnterpriseLoginError('server')
  }
  return url.origin
}

/** Owns refresh rotation, credential persistence, and terminal sign-out detection. */
export class EnterpriseAuthClient {
  private readonly store: EnterpriseCredentialStore
  private readonly fetcher: typeof fetch
  private readonly now: () => number
  private currentOrigin: string
  private refreshInFlight: Promise<EnterpriseAuthSession> | undefined

  /** @param options - credential store, pinned cloud origin, and injected transport/clock. */
  constructor(options: EnterpriseAuthClientOptions) {
    this.store = options.store
    this.fetcher = options.fetch ?? fetch
    this.now = options.now ?? Date.now
    this.currentOrigin = origin(options.cloudBaseUrl)
  }

  /**
   * Authenticate with the existing enterprise email/password account.
   * @param cloudBaseUrl - enterprise cloud origin.
   * @param email - enterprise account email.
   * @param password - ephemeral password value.
   * @param deviceName - operator-visible device label.
   * @returns the short-lived session; the refresh credential remains encrypted in the store.
   */
  async login(cloudBaseUrl: string, email: string, password: string, deviceName: string): Promise<EnterpriseAuthSession> {
    this.currentOrigin = origin(cloudBaseUrl)
    let response: Response
    try {
      response = await this.fetcher(`${this.currentOrigin}/enterprise/api/desktop/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password, deviceName }),
      })
    } catch {
      throw new EnterpriseLoginError('network')
    }
    if (response.status === 401 || response.status === 403) throw new EnterpriseLoginError('invalid_credentials')
    if (!response.ok) throw new EnterpriseLoginError('server')
    let parsed: WireGrant
    try {
      parsed = grant(await response.json())
    } catch (error) {
      if (error instanceof EnterpriseLoginError) throw error
      throw new EnterpriseLoginError('server')
    }
    await this.persist(parsed)
    return this.session(parsed)
  }

  /**
   * Load a stored credential and refresh it immediately.
   * @param cloudBaseUrl - enterprise cloud origin.
   * @returns the refreshed session, or undefined when no usable credential remains.
   */
  async restore(cloudBaseUrl: string): Promise<EnterpriseAuthSession | undefined> {
    this.currentOrigin = origin(cloudBaseUrl)
    const credential = await this.store.load(this.currentOrigin)
    if (credential === undefined) return undefined
    try {
      return await this.refresh()
    } catch (error) {
      if (error instanceof EnterpriseSignOutRequired) return undefined
      throw error
    }
  }

  /** Rotate the refresh credential once, sharing one request across concurrent callers. */
  refresh(): Promise<EnterpriseAuthSession> {
    if (this.refreshInFlight !== undefined) return this.refreshInFlight
    const run = this.performRefresh().finally(() => {
      if (this.refreshInFlight === run) this.refreshInFlight = undefined
    })
    this.refreshInFlight = run
    return run
  }

  /** Revoke the current device without deleting the local credential before owned teardown completes. */
  async revoke(): Promise<void> {
    const credential = await this.store.load(this.currentOrigin)
    if (credential === undefined) return
    let response: Response
    try {
      response = await this.fetcher(`${this.currentOrigin}/enterprise/api/desktop/auth/logout`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ refreshToken: credential.refreshToken }),
      })
    } catch {
      throw new EnterpriseAuthTransportError()
    }
    if (response.status === 401 || response.status === 403) {
      await this.store.clear(this.currentOrigin)
      throw new EnterpriseSignOutRequired()
    }
    if (!response.ok) throw new EnterpriseAuthTransportError('Enterprise logout failed')
  }

  /** Revoke the current device, retaining the credential when the request cannot reach the cloud. */
  async logout(): Promise<void> {
    await this.revoke()
    await this.store.clear(this.currentOrigin)
  }

  /** Current access expiry in milliseconds, or undefined before login/restore. */
  accessExpiresAt(): number | undefined {
    const parsed = Date.parse(this.lastSession?.accessExpiresAt ?? '')
    return Number.isFinite(parsed) ? parsed : undefined
  }

  private lastSession: EnterpriseAuthSession | undefined

  private async performRefresh(): Promise<EnterpriseAuthSession> {
    const credential = await this.store.load(this.currentOrigin)
    if (credential === undefined) throw new EnterpriseSignOutRequired()
    let response: Response
    try {
      response = await this.fetcher(`${this.currentOrigin}/enterprise/api/desktop/auth/refresh`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ refreshToken: credential.refreshToken }),
      })
    } catch {
      throw new EnterpriseAuthTransportError()
    }
    if (response.status === 401 || response.status === 403) {
      await this.store.clear(this.currentOrigin)
      throw new EnterpriseSignOutRequired()
    }
    if (!response.ok) throw new EnterpriseAuthTransportError('Enterprise refresh failed')
    let parsed: WireGrant
    try {
      parsed = grant(await response.json())
    } catch (error) {
      if (error instanceof EnterpriseLoginError) throw new EnterpriseSignOutRequired('desktop_auth_invalid')
      throw error
    }
    await this.persist(parsed)
    return this.session(parsed)
  }

  private async persist(value: WireGrant): Promise<void> {
    const credential: EnterpriseCredentialRecord = {
      cloudBaseUrl: this.currentOrigin,
      userId: value.bootstrap.user.id,
      email: value.bootstrap.user.email,
      deviceId: value.deviceId,
      profileKey: value.bootstrap.profileKey,
      refreshToken: value.refreshToken,
    }
    await this.store.save(credential)
  }

  private session(value: WireGrant): EnterpriseAuthSession {
    const expiresAt = Date.parse(value.accessExpiresAt)
    if (!Number.isFinite(expiresAt) || expiresAt <= this.now()) throw new EnterpriseLoginError('server')
    this.lastSession = Object.freeze({
      accessToken: value.accessToken,
      accessExpiresAt: value.accessExpiresAt,
      bootstrap: value.bootstrap,
    })
    return this.lastSession
  }
}
