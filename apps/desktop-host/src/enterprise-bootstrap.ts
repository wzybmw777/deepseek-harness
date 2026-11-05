/** Enterprise bootstrap received over the private Electron child-process channel. */

import { Service, type Context } from '@deepseek-ai/cordis'

declare module '@deepseek-ai/cordis' {
  interface Context {
    enterpriseBootstrap: EnterpriseBootstrapService
  }
}

/** Identity and short-lived access grant available to enterprise Host plugins. */
export interface EnterpriseHostBootstrap {
  readonly cloudBaseUrl: string
  readonly accessToken: string
  readonly accessExpiresAt: string
  readonly profileKey: string
  readonly user: { readonly id: string; readonly email: string; readonly name: string; readonly roleId: string }
  readonly team: { readonly id: string; readonly name: string; readonly slug: string }
}

/** Invalid enterprise bootstrap from Electron main. */
export class EnterpriseBootstrapError extends Error {
  constructor(message = 'Enterprise Desktop bootstrap is invalid') {
    super(message)
    this.name = 'EnterpriseBootstrapError'
  }
}

/** Ask Electron main to rotate the access grant without exposing the refresh credential. */
export type EnterpriseBootstrapRefresh = () => Promise<EnterpriseHostBootstrap>

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new EnterpriseBootstrapError()
  return value as Record<string, unknown>
}

function text(value: Record<string, unknown>, field: string, maximum = 512): string {
  const candidate = value[field]
  if (typeof candidate !== 'string' || candidate === '' || candidate.length > maximum) throw new EnterpriseBootstrapError()
  return candidate
}

function origin(value: string): string {
  const url = new URL(value)
  if ((url.protocol !== 'https:' && url.protocol !== 'http:') || url.username !== '' || url.password !== ''
    || url.search !== '' || url.hash !== '' || (url.pathname !== '' && url.pathname !== '/')) {
    throw new EnterpriseBootstrapError()
  }
  if (url.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
    throw new EnterpriseBootstrapError()
  }
  return url.origin
}

/**
 * Validate one bootstrap message and enforce the pinned cloud origin.
 * @param value - message value received from Electron.
 * @param pinnedOrigin - cloud origin selected by the installed application.
 * @returns a frozen Host bootstrap.
 */
export function parseEnterpriseHostBootstrap(value: unknown, pinnedOrigin: string): EnterpriseHostBootstrap {
  const candidate = record(value)
  if ('refreshToken' in candidate || 'password' in candidate) throw new EnterpriseBootstrapError()
  const user = record(candidate.user)
  const team = record(candidate.team)
  const cloudBaseUrl = origin(text(candidate, 'cloudBaseUrl', 2048))
  if (cloudBaseUrl !== origin(pinnedOrigin)) throw new EnterpriseBootstrapError('Enterprise Desktop cloud origin changed')
  const accessExpiresAt = text(candidate, 'accessExpiresAt', 64)
  const profileKey = text(candidate, 'profileKey', 64)
  if (!/^[a-f0-9]{64}$/u.test(profileKey) || !Number.isFinite(Date.parse(accessExpiresAt))) {
    throw new EnterpriseBootstrapError()
  }
  return Object.freeze({
    cloudBaseUrl,
    accessToken: text(candidate, 'accessToken', 8192),
    accessExpiresAt,
    profileKey,
    user: Object.freeze({
      id: text(user, 'id', 200), email: text(user, 'email', 320), name: text(user, 'name', 200),
      roleId: text(user, 'roleId', 200),
    }),
    team: Object.freeze({ id: text(team, 'id', 200), name: text(team, 'name', 200), slug: text(team, 'slug', 200) }),
  })
}

/**
 * Wait for the first enterprise bootstrap before any profile plugin is loaded.
 * @param pinnedOrigin - cloud origin selected by the installed application.
 * @returns the validated bootstrap.
 */
export function waitForEnterpriseBootstrap(pinnedOrigin: string): Promise<EnterpriseHostBootstrap> {
  return new Promise((resolve, reject) => {
    const cleanup = (): void => {
      process.removeListener('message', receive)
      process.removeListener('disconnect', disconnected)
    }
    const receive = (message: unknown): void => {
      if (typeof message !== 'object' || message === null || !('type' in message)) return
      if (message.type === 'shutdown') {
        cleanup()
        reject(new Error('Enterprise Host stopped before bootstrap'))
        return
      }
      if (message.type !== 'enterprise-bootstrap' || !('value' in message)) return
      cleanup()
      try { resolve(parseEnterpriseHostBootstrap(message.value, pinnedOrigin)) }
      catch (error) { reject(error) }
    }
    const disconnected = (): void => {
      cleanup()
      reject(new Error('Enterprise bootstrap channel disconnected'))
    }
    process.on('message', receive)
    process.once('disconnect', disconnected)
  })
}

/** Mutable bootstrap service retained for Host lifetime and cleared before shutdown. */
export class EnterpriseBootstrapService extends Service {
  #value: EnterpriseHostBootstrap | undefined
  #refresh: EnterpriseBootstrapRefresh | undefined
  #refreshing: Promise<EnterpriseHostBootstrap> | undefined

  /**
   * @param ctx - Host context owning this service.
   * @param value - first validated bootstrap.
   * @param refresh - optional request to Electron main for a replacement grant.
   */
  constructor(ctx: Context, value: EnterpriseHostBootstrap, refresh?: EnterpriseBootstrapRefresh) {
    super(ctx, 'enterpriseBootstrap')
    this.#value = value
    this.#refresh = refresh
  }

  /** Current access grant, or undefined after sign-out or refresh teardown. */
  current(): EnterpriseHostBootstrap | undefined { return this.#value }

  /**
   * Rotate the access grant through the private Electron refresh channel.
   * @param current - grant whose token was rejected or is about to expire.
   * @returns the replacement grant for the same identity.
   */
  refresh(current: EnterpriseHostBootstrap): Promise<EnterpriseHostBootstrap> {
    if (this.#refreshing !== undefined) return this.#refreshing
    if (this.#value === undefined) return Promise.reject(new Error('Enterprise Desktop session is unavailable'))
    if (this.#value.profileKey !== current.profileKey || this.#value.user.id !== current.user.id
      || this.#value.team.id !== current.team.id) {
      return Promise.reject(new EnterpriseBootstrapError('Enterprise identity changed before refresh'))
    }
    const request = this.#refresh
    if (request === undefined) return Promise.reject(new Error('Enterprise Desktop refresh is unavailable'))
    const running = (async () => {
      const next = await request()
      this.replace(next)
      return next
    })()
    this.#refreshing = running
    const clear = (): void => { if (this.#refreshing === running) this.#refreshing = undefined }
    void running.then(clear, clear)
    return running
  }

  /**
   * Replace an expiring access grant without restarting the Host.
   * @param value - validated replacement for the same identity.
   */
  replace(value: EnterpriseHostBootstrap): void {
    const current = this.#value
    if (current === undefined || current.profileKey !== value.profileKey || current.user.id !== value.user.id
      || current.team.id !== value.team.id) throw new EnterpriseBootstrapError('Enterprise identity changed without a Host restart')
    this.#value = value
  }

  /** Remove the access grant before dependent resources close. */
  clear(): void { this.#value = undefined }
}

/**
 * Register the validated bootstrap service on the Host context.
 * @param ctx - Host context owning this service.
 * @param value - first validated bootstrap.
 * @param refresh - optional request to Electron main for a replacement grant.
 * @returns the installed service.
 */
export function installEnterpriseBootstrap(
  ctx: Context,
  value: EnterpriseHostBootstrap,
  refresh?: EnterpriseBootstrapRefresh,
): EnterpriseBootstrapService {
  return new EnterpriseBootstrapService(ctx, value, refresh)
}
