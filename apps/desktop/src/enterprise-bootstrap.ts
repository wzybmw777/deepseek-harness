/** Short-lived enterprise identity delivered to one local Desktop Host. */

import type { EnterpriseAuthSession } from './enterprise-auth.ts'
import type { DesktopBootstrap } from './enterprise-types.ts'

/** Enterprise data the Host may hold; refresh credentials remain in Electron main. */
export interface EnterpriseHostBootstrap {
  readonly cloudBaseUrl: string
  readonly accessToken: string
  readonly accessExpiresAt: string
  readonly profileKey: string
  readonly user: DesktopBootstrap['user']
  readonly team: DesktopBootstrap['team']
}

/** Invalid bootstrap received from an untrusted boundary. */
export class EnterpriseBootstrapError extends Error {
  constructor(message = 'Enterprise Desktop bootstrap is invalid') {
    super(message)
    this.name = 'EnterpriseBootstrapError'
  }
}

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
  return url.origin
}

/**
 * Build the value sent over the private Host IPC channel.
 * @param session - freshly issued enterprise access grant.
 * @returns the exact Host payload, with no refresh credential.
 */
export function createEnterpriseHostBootstrap(session: EnterpriseAuthSession): EnterpriseHostBootstrap {
  return validateEnterpriseHostBootstrap({
    cloudBaseUrl: session.bootstrap.cloudBaseUrl,
    accessToken: session.accessToken,
    accessExpiresAt: session.accessExpiresAt,
    profileKey: session.bootstrap.profileKey,
    user: session.bootstrap.user,
    team: session.bootstrap.team,
  })
}

/**
 * Validate the Host payload before process IPC or plugin activation.
 * @param value - untrusted bootstrap value.
 * @returns a frozen payload containing only the allowed identity fields.
 */
export function validateEnterpriseHostBootstrap(value: unknown): EnterpriseHostBootstrap {
  const candidate = record(value)
  if ('refreshToken' in candidate || 'password' in candidate) throw new EnterpriseBootstrapError()
  const user = record(candidate.user)
  const team = record(candidate.team)
  const accessExpiresAt = text(candidate, 'accessExpiresAt', 64)
  const profileKey = text(candidate, 'profileKey', 64)
  if (!/^[a-f0-9]{64}$/u.test(profileKey) || !Number.isFinite(Date.parse(accessExpiresAt))) {
    throw new EnterpriseBootstrapError()
  }
  return Object.freeze({
    cloudBaseUrl: origin(text(candidate, 'cloudBaseUrl', 2048)),
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
