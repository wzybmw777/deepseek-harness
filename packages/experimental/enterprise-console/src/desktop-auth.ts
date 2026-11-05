/** Desktop device authentication, short-lived access grants, and bootstrap policy. */

import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import type { EnterpriseRequestSession } from './api.ts'
import { isEmail, normalizeEmail, recordId, verifyPassword } from './security.ts'
import type { EnterpriseStore } from './store.ts'
import type { AuditRecord, DesktopAuthGrant, DesktopBootstrap, DesktopDeviceRecord, TeamRecord, UserRecord } from './types.ts'
import { permissionsFor } from './views.ts'

const ACCESS_LIFETIME_MS = 15 * 60 * 1000
const REFRESH_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000
const ACCESS_TOKEN_VERSION = 1
const MAX_DEVICE_NAME_LENGTH = 120

/** Lowest desktop build accepted by the current cloud control plane. */
export const DESKTOP_MINIMUM_CLIENT_VERSION = '0.2.2-alpha.2'

/** Stable desktop authentication failure codes returned by the API. */
export type DesktopAuthErrorCode =
  | 'invalid_credentials'
  | 'desktop_auth_revoked'
  | 'desktop_auth_expired'
  | 'desktop_auth_invalid'
  | 'team_unavailable'

/** Typed desktop authentication failure with its HTTP status. */
export class DesktopAuthError extends Error {
  /**
   * @param code - stable failure code safe to return to the desktop client.
   * @param status - HTTP status for the API response.
   * @param message - localized operator-facing explanation.
   */
  constructor(
    readonly code: DesktopAuthErrorCode,
    readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'DesktopAuthError'
  }
}

interface DesktopAccessClaims {
  readonly version: typeof ACCESS_TOKEN_VERSION
  readonly userId: string
  readonly deviceId: string
  readonly userSessionVersion: number
  readonly expiresAt: number
}

export interface DesktopAuthServiceOptions {
  /** Clock injected by tests and callers that need deterministic expiry. */
  readonly now?: () => number
  /** Lowest client version advertised in bootstrap. */
  readonly minimumClientVersion?: string
}

function base64url(value: Buffer): string {
  return value.toString('base64url')
}

function canonicalCloudBaseUrl(value: string): string {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new DesktopAuthError('desktop_auth_invalid', 400, '云服务地址无效')
  }
  if ((url.protocol !== 'https:' && url.protocol !== 'http:') || url.username !== '' || url.password !== ''
    || url.search !== '' || url.hash !== '' || (url.pathname !== '' && url.pathname !== '/')) {
    throw new DesktopAuthError('desktop_auth_invalid', 400, '云服务地址必须是不含路径的 HTTP(S) 源')
  }
  return url.origin
}

function refreshHash(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex')
}

function encodeRefreshToken(cloudBaseUrl: string): string {
  return `${base64url(Buffer.from(cloudBaseUrl, 'utf8'))}.${randomBytes(32).toString('base64url')}`
}

function refreshTokenOrigin(token: string): string {
  const encodedOrigin = token.split('.', 1)[0]
  if (encodedOrigin === undefined || encodedOrigin === '') {
    throw new DesktopAuthError('desktop_auth_revoked', 401, '桌面端登录已失效，请重新登录')
  }
  try {
    return canonicalCloudBaseUrl(Buffer.from(encodedOrigin, 'base64url').toString('utf8'))
  } catch {
    throw new DesktopAuthError('desktop_auth_revoked', 401, '桌面端登录已失效，请重新登录')
  }
}

function profileKey(cloudBaseUrl: string, userId: string): string {
  return createHash('sha256').update(`${cloudBaseUrl}\n${userId}`, 'utf8').digest('hex').slice(0, 32)
}

function accessSignature(secret: Buffer, body: string): Buffer {
  return createHmac('sha256', secret).update(`enterprise-desktop-access.${body}`).digest()
}

function encodeAccess(claims: DesktopAccessClaims, secret: Buffer): string {
  const body = base64url(Buffer.from(JSON.stringify(claims), 'utf8'))
  return `${body}.${base64url(accessSignature(secret, body))}`
}

function decodeAccess(token: string, secret: Buffer, now: number): DesktopAccessClaims | undefined {
  if (token.length > 2048) return undefined
  const parts = token.split('.')
  if (parts.length !== 2 || parts[0] === undefined || parts[1] === undefined) return undefined
  const expected = accessSignature(secret, parts[0])
  const actual = Buffer.from(parts[1], 'base64url')
  if (actual.byteLength !== expected.byteLength || !timingSafeEqual(actual, expected)) return undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'))
  } catch {
    return undefined
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined
  const candidate = parsed as Record<string, unknown>
  if (candidate.version !== ACCESS_TOKEN_VERSION
    || typeof candidate.userId !== 'string' || candidate.userId === ''
    || typeof candidate.deviceId !== 'string' || candidate.deviceId === ''
    || typeof candidate.userSessionVersion !== 'number' || !Number.isSafeInteger(candidate.userSessionVersion)
    || typeof candidate.expiresAt !== 'number' || !Number.isSafeInteger(candidate.expiresAt)
    || candidate.expiresAt <= now) return undefined
  return {
    version: ACCESS_TOKEN_VERSION,
    userId: candidate.userId,
    deviceId: candidate.deviceId,
    userSessionVersion: candidate.userSessionVersion,
    expiresAt: candidate.expiresAt,
  }
}

/** Issue and re-authorize desktop sessions against the enterprise catalog. */
export class DesktopAuthService {
  private readonly now: () => number
  private readonly minimumClientVersion: string

  /**
   * @param store - durable enterprise catalog and device records.
   * @param options - optional clock and minimum client version overrides.
   */
  constructor(
    private readonly store: EnterpriseStore,
    options: DesktopAuthServiceOptions = {},
  ) {
    this.now = options.now ?? Date.now
    this.minimumClientVersion = options.minimumClientVersion ?? DESKTOP_MINIMUM_CLIENT_VERSION
  }

  /**
   * Verify an enterprise email/password and create one refreshable desktop device.
   * @param email - enterprise account email.
   * @param password - plaintext password checked against the stored Scrypt record.
   * @param deviceName - operator-visible device label used only in audit text.
   * @param cloudBaseUrl - pinned enterprise cloud origin.
   * @returns the first access grant and matching refresh credential.
   */
  async login(email: string, password: string, deviceName: string, cloudBaseUrl: string): Promise<DesktopAuthGrant> {
    const normalizedEmail = normalizeEmail(email)
    if (!isEmail(normalizedEmail) || password.length === 0 || password.length > 256) {
      throw new DesktopAuthError('invalid_credentials', 401, '企业邮箱或密码不正确')
    }
    const origin = canonicalCloudBaseUrl(cloudBaseUrl)
    const data = this.store.snapshot()
    const user = data.users.find(candidate => candidate.email === normalizedEmail)
    if (user === undefined || user.status !== 'active' || !await verifyPassword(password, user.passwordHash)) {
      throw new DesktopAuthError('invalid_credentials', 401, '企业邮箱或密码不正确')
    }
    const team = this.activeTeam(user)
    const timestamp = this.now()
    const createdAt = new Date(timestamp).toISOString()
    const refreshToken = encodeRefreshToken(origin)
    const device: DesktopDeviceRecord = {
      id: recordId(),
      userId: user.id,
      refreshSecretHash: refreshHash(refreshToken),
      userSessionVersion: user.sessionVersion,
      createdAt,
      lastUsedAt: createdAt,
    }
    const safeDeviceName = deviceName.trim().slice(0, MAX_DEVICE_NAME_LENGTH) || 'Enterprise Desktop'
    await this.store.insertDesktopDevice(device, this.audit(
      user,
      'desktop.auth.login',
      device.id,
      `${user.email} 登录企业桌面端（${safeDeviceName}）`,
      createdAt,
    ))
    return this.grant(user, team, device, origin, refreshToken, timestamp)
  }

  /**
   * Rotate a refresh credential and issue the next short-lived access token.
   * @param refreshToken - current opaque refresh secret.
   * @returns the rotated access grant.
   */
  async refresh(refreshToken: string): Promise<DesktopAuthGrant> {
    const cloudBaseUrl = refreshTokenOrigin(refreshToken)
    const hash = refreshHash(refreshToken)
    const device = this.store.desktopDeviceByRefreshHash(hash)
    if (device === undefined || device.revokedAt !== undefined) {
      throw new DesktopAuthError('desktop_auth_revoked', 401, '桌面端登录已失效，请重新登录')
    }
    const user = this.store.snapshot().users.find(candidate => candidate.id === device.userId)
    if (user === undefined || user.status !== 'active' || user.sessionVersion !== device.userSessionVersion) {
      await this.revokeDevice(device, user, 'desktop.auth.session_version_changed')
      throw new DesktopAuthError('desktop_auth_revoked', 401, '账号登录状态已变更，请重新登录')
    }
    const team = this.activeTeam(user)
    const timestamp = this.now()
    const nextToken = randomBytes(32).toString('base64url')
    const rotated = await this.store.rotateDesktopDevice(device.id, hash, {
      refreshSecretHash: refreshHash(nextToken),
      userSessionVersion: user.sessionVersion,
      lastUsedAt: new Date(timestamp).toISOString(),
      audit: this.audit(
        user,
        'desktop.auth.refresh',
        device.id,
        `${user.email} 续期企业桌面端登录`,
        new Date(timestamp).toISOString(),
      ),
    })
    if (!rotated) throw new DesktopAuthError('desktop_auth_revoked', 401, '桌面端登录已失效，请重新登录')
    return this.grant(user, team, device, cloudBaseUrl, nextToken, timestamp)
  }

  /**
   * Revoke one refresh credential without affecting the user's other devices.
   * @param refreshToken - current opaque refresh secret.
   * @returns completion after the durable revocation.
   */
  async logout(refreshToken: string): Promise<void> {
    const device = this.store.desktopDeviceByRefreshHash(refreshHash(refreshToken))
    if (device === undefined || device.revokedAt !== undefined) return
    const user = this.store.snapshot().users.find(candidate => candidate.id === device.userId)
    await this.revokeDevice(device, user, 'desktop.auth.logout')
  }

  /**
   * Verify a bearer token and re-authorize its user, device, team, and session version.
   * @param token - signed desktop access token.
   * @returns the active enterprise request session.
   */
  authorizeAccess(token: string): EnterpriseRequestSession {
    const claims = decodeAccess(token, this.store.sessionKey, this.now())
    if (claims === undefined) throw new DesktopAuthError('desktop_auth_expired', 401, '桌面端访问令牌已过期')
    const data = this.store.snapshot()
    const user = data.users.find(candidate => candidate.id === claims.userId)
    const device = this.store.desktopDeviceById(claims.deviceId)
    if (user === undefined || user.status !== 'active' || device === undefined || device.revokedAt !== undefined
      || device.userSessionVersion !== user.sessionVersion || claims.userSessionVersion !== user.sessionVersion) {
      throw new DesktopAuthError('desktop_auth_revoked', 401, '桌面端登录已失效，请重新登录')
    }
    this.activeTeam(user)
    return {
      kind: 'member',
      user,
      permissions: permissionsFor(data, user),
      desktopDeviceId: device.id,
      accessExpiresAt: new Date(claims.expiresAt).toISOString(),
    }
  }

  /**
   * Build the cloud identity and policy payload consumed by the local Host.
   * @param session - already re-authorized desktop session.
   * @param cloudBaseUrl - pinned enterprise cloud origin.
   * @returns the bootstrap payload.
   */
  bootstrap(session: EnterpriseRequestSession, cloudBaseUrl: string): DesktopBootstrap {
    const team = this.activeTeam(session.user)
    const expiresAt = session.accessExpiresAt ?? new Date(this.now() + ACCESS_LIFETIME_MS).toISOString()
    return this.bootstrapFor(session.user, team, canonicalCloudBaseUrl(cloudBaseUrl), expiresAt)
  }

  /**
   * Append an audit event for a bootstrap request without exposing credentials.
   * @param session - re-authorized desktop session.
   * @param ip - request source used by the audit ledger.
   */
  async recordBootstrap(session: EnterpriseRequestSession, ip: string): Promise<void> {
    await this.store.mutate((draft) => {
      const actor = draft.users.find(candidate => candidate.id === session.user.id)
      if (actor === undefined) return
      draft.audit.push(this.audit(
        actor,
        'desktop.auth.bootstrap',
        session.desktopDeviceId ?? actor.id,
        `${actor.email} 获取企业桌面端启动配置`,
        new Date(this.now()).toISOString(),
        ip,
      ))
    })
  }

  private activeTeam(user: UserRecord): TeamRecord {
    const team = user.teamId === undefined
      ? undefined
      : this.store.snapshot().teams.find(candidate => candidate.id === user.teamId)
    if (team === undefined) throw new DesktopAuthError('team_unavailable', 403, '当前账号尚未分配团队')
    if (team.status !== 'active') throw new DesktopAuthError('team_unavailable', 403, '当前团队已停用')
    return team
  }

  private grant(
    user: UserRecord,
    team: TeamRecord,
    device: DesktopDeviceRecord,
    cloudBaseUrl: string,
    refreshToken: string,
    timestamp: number,
  ): DesktopAuthGrant {
    const expiresAt = timestamp + ACCESS_LIFETIME_MS
    const accessToken = encodeAccess({
      version: ACCESS_TOKEN_VERSION,
      userId: user.id,
      deviceId: device.id,
      userSessionVersion: user.sessionVersion,
      expiresAt,
    }, this.store.sessionKey)
    const accessExpiresAt = new Date(expiresAt).toISOString()
    return Object.freeze({
      deviceId: device.id,
      accessToken,
      accessExpiresAt,
      refreshToken,
      refreshExpiresAt: new Date(timestamp + REFRESH_LIFETIME_MS).toISOString(),
      bootstrap: this.bootstrapFor(user, team, cloudBaseUrl, accessExpiresAt),
    })
  }

  private bootstrapFor(
    user: UserRecord,
    team: TeamRecord,
    cloudBaseUrl: string,
    accessExpiresAt: string,
  ): DesktopBootstrap {
    const bootstrap: DesktopBootstrap = {
      apiVersion: 1,
      cloudBaseUrl,
      profileKey: profileKey(cloudBaseUrl, user.id),
      accessExpiresAt,
      user: { id: user.id, email: user.email, name: user.name, roleId: user.roleId },
      team: { id: team.id, name: team.name, slug: team.slug },
      minimumClientVersion: this.minimumClientVersion,
      policy: {
        consumerAnalytics: false,
        crashReports: 'enterprise-support',
        supportEmail: this.store.snapshot().settings.supportEmail,
      },
      endpoints: {
        bootstrap: '/enterprise/api/desktop/bootstrap',
        models: '/enterprise/api/desktop/models',
        resources: '/enterprise/api/desktop/resources',
        sessions: '/enterprise/api/desktop/sessions',
        plugins: '/enterprise/api/desktop/plugins',
        billing: '/enterprise/api/desktop/billing',
      },
    }
    return Object.freeze(bootstrap)
  }

  private async revokeDevice(device: DesktopDeviceRecord, user: UserRecord | undefined, action: string): Promise<void> {
    const timestamp = new Date(this.now()).toISOString()
    await this.store.revokeDesktopDevice(device.id, timestamp, user === undefined ? undefined : this.audit(
      user,
      action,
      device.id,
      `${user.email} 的桌面端登录已撤销`,
      timestamp,
    ))
  }

  private audit(
    user: UserRecord,
    action: string,
    targetId: string,
    summary: string,
    createdAt: string,
    ip = 'desktop',
  ): AuditRecord {
    return {
      id: recordId(),
      actorId: user.id,
      actorEmail: user.email,
      action,
      targetType: 'desktop_device',
      targetId,
      summary,
      ip,
      createdAt,
    }
  }
}
