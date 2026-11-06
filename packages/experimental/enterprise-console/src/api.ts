/** Enterprise session, administration, billing, catalog, usage, and audit API. */

import { createHash } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { RemoteBrowserControl, RemoteBrowserEvent } from '@deepseek-ai/dsh-client-ui-sidebar-browser/types'
import { DesktopAuthError, DesktopAuthService } from './desktop-auth.ts'
import {
  DESKTOP_GATEWAY_PREFIX,
  DesktopModelGateway,
  parseDesktopGatewayPath,
} from './desktop-gateway.ts'
import { DesktopModels } from './desktop-models.ts'
import type { EnterpriseStore } from './store.ts'
import {
  TEAM_FILE_TEXT_BYTES,
  TEAM_FILE_UPLOAD_BYTES,
  TeamResourceError,
  type KnowledgeInput,
  type TeamResources,
  type TeamSkillInput,
} from './team-resources.ts'
import {
  HttpError,
  SECURITY_HEADERS,
  booleanField,
  clientIp,
  integerField,
  optionalTextField,
  pathIdentifier,
  readBody,
  readJson,
  readCookie,
  requestAuthority,
  requestOrigin,
  requestProtocol,
  sameOriginMutation,
  sendEmpty,
  sendError,
  sendJson,
  serializeCookie,
  secretField,
  stringArrayField,
  textField,
} from './http.ts'
import {
  decodeSession,
  encodeSession,
  encryptCredential,
  generateTemporaryPassword,
  hashPassword,
  isEmail,
  isIdentifier,
  isPhone,
  normalizeEmail,
  normalizeIdentifier,
  normalizePhone,
  recordId,
  verifyPassword,
} from './security.ts'
import {
  VerificationService,
  type VerificationChannel,
  type VerificationPurpose,
} from './verification.ts'
import type {
  BillingOverview,
  ChannelRecord,
  EnterpriseData,
  ModelRecord,
  OrderRecord,
  PlanRecord,
  PluginRecord,
  RoleRecord,
  TeamRecord,
  UsageRecord,
  UserRecord,
} from './types.ts'
import {
  BILLING_PURCHASE_PERMISSION,
  BUILTIN_PLUGIN_WRITE_PERMISSION,
  ENTERPRISE_PLUGIN_WRITE_PERMISSION,
  PERMISSIONS,
  RESOURCE_WRITE_PERMISSION,
} from './types.ts'
import { BUILTIN_PLUGINS, builtinPluginId } from './plugin-catalog.ts'
import {
  parseEnterprisePluginSpec,
  type EnterprisePluginInstaller,
  type InstalledEnterprisePlugin,
} from './plugin-installer.ts'
import {
  REMOTE_BROWSER_DEFAULT_VIEWPORT,
  RemoteBrowserError,
  type RemoteBrowserService,
} from './remote-browser.ts'
import {
  channelViews,
  dashboardView,
  modelViews,
  orderViews,
  permissionsFor,
  planViews,
  pluginsView,
  roleViews,
  sessionView,
  teamViews,
  usageView,
  userView,
} from './views.ts'

const API_PREFIX = '/enterprise/api'
const BROWSER_PATH = `${API_PREFIX}/browser`
const SESSION_COOKIE = 'dsh_enterprise_session'
const MAX_PASSWORD_LENGTH = 256
const MIN_PASSWORD_LENGTH = 10
const LOGIN_WINDOW_MILLISECONDS = 15 * 60 * 1000
const LOGIN_ATTEMPT_LIMIT = 8

/** Browser-auth cookie name the Harness owns for one public authority. */
function harnessCookieName(authority: string): string {
  return `dsh-auth-${createHash('sha256').update(authority).digest('base64url')}`
}
function attachmentDisposition(filename: string): string {
  const fallback = filename.replace(/[^\x20-\x7e]/gu, '_').replace(/["\\]/gu, '_')
  const encoded = encodeURIComponent(filename).replace(/['()*]/gu, character =>
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`)
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`
}

interface ApiDependencies {
  readonly store: EnterpriseStore
  readonly resources: TeamResources
  readonly tenantPath: (team: TeamRecord) => string
  readonly prepareTenant: (team: TeamRecord) => Promise<void>
  readonly plugins?: EnterprisePluginInstaller
  readonly pluginsChanged?: () => Promise<void>
  readonly verification?: VerificationService
  readonly remoteBrowser?: RemoteBrowserService
  readonly logger: { warn: (error: Error) => void }
}

/** Signed-in enterprise identity used by the API and tenant gateway. */
export interface EnterpriseRequestSession {
  readonly kind: 'member'
  readonly user: UserRecord
  readonly permissions: string[]
  readonly desktopDeviceId?: string
  readonly accessExpiresAt?: string
}

interface LoginAttempt {
  count: number
  resetAt: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function bodyRecord(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) throw new HttpError(400, '请求体必须是 JSON 对象', 'invalid_body')
  return value
}

function bearerToken(request: IncomingMessage): string {
  const header = request.headers.authorization
  if (typeof header !== 'string' || !header.startsWith('Bearer ')) {
    throw new HttpError(401, '缺少桌面端访问令牌', 'desktop_auth_expired')
  }
  const token = header.slice('Bearer '.length).trim()
  if (token === '') throw new HttpError(401, '桌面端访问令牌无效', 'desktop_auth_invalid')
  return token
}

function optionalHeader(request: IncomingMessage, name: string, code: string): string | undefined {
  const value = request.headers[name]
  if (value === undefined) return undefined
  if (Array.isArray(value)) throw new HttpError(400, '请求头格式无效', code)
  return value
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key)
}

function loginIdentifier(body: Record<string, unknown>): string {
  const identifier = normalizeIdentifier(textField(body.identifier ?? body.email, '邮箱或手机号', 320))
  if (!isIdentifier(identifier)) throw new HttpError(400, '请输入有效的邮箱或手机号', 'invalid_field')
  return identifier
}

function findUserByIdentifier(users: readonly UserRecord[], identifier: string): UserRecord | undefined {
  return users.find(user => user.email === identifier || user.phone === identifier)
}

function verificationChannel(identifier: string): VerificationChannel {
  return identifier.includes('@') ? 'email' : 'phone'
}

function verificationPurpose(value: unknown): VerificationPurpose {
  if (value === undefined || value === 'login') return 'login'
  if (value === 'register') return 'register'
  throw new HttpError(400, '验证码用途无效', 'invalid_field')
}

function actionIdentifier(pathname: string, prefix: string, suffix: string): string | undefined {
  if (!pathname.startsWith(prefix) || !pathname.endsWith(suffix)) return undefined
  const identifier = pathname.slice(prefix.length, -suffix.length)
  if (identifier === '' || identifier.includes('/')) return undefined
  return decodeURIComponent(identifier)
}

function requirePermissionInDraft(draft: EnterpriseData, actorId: string, permission: string): UserRecord {
  const actor = draft.users.find(user => user.id === actorId)
  if (actor === undefined || actor.status !== 'active') throw new HttpError(401, '登录已失效，请重新登录', 'unauthorized')
  if (!permissionsFor(draft, actor).includes(permission)) {
    throw new HttpError(403, '当前角色没有执行此操作的权限', 'forbidden')
  }
  return actor
}

function assertPermissionsWithinActor(
  draft: EnterpriseData,
  actor: UserRecord,
  permissions: readonly string[],
  message: string,
): void {
  const available = new Set(permissionsFor(draft, actor))
  if (permissions.some(permission => !available.has(permission))) {
    throw new HttpError(403, message, 'permission_escalation')
  }
}

function assertOwnerRoleManager(actor: UserRecord): void {
  if (actor.roleId !== 'role-owner') {
    throw new HttpError(403, '仅所有者可以管理角色', 'owner_required')
  }
}

function assertBuiltinPluginManager(actor: UserRecord): void {
  if (actor.roleId !== 'role-owner') {
    throw new HttpError(403, '仅所有者可以添加内置插件', 'owner_required')
  }
}

function assertRoleAssignable(actor: UserRecord, role: RoleRecord): void {
  if (actor.roleId === 'role-owner' || (actor.roleId === 'role-admin' && role.id === 'role-member')) return
  throw new HttpError(403, '管理员只能添加团队成员', 'role_assignment_forbidden')
}

function assertUserWithinActor(actor: UserRecord, target: UserRecord): void {
  if (actor.roleId === 'role-owner'
    || (actor.roleId === 'role-admin' && target.roleId === 'role-member')) return
  throw new HttpError(403, '管理员只能管理团队成员', 'role_hierarchy_forbidden')
}

function appendAudit(
  draft: EnterpriseData,
  actor: { id?: string; email: string },
  action: string,
  targetType: string,
  targetId: string | undefined,
  summary: string,
  ip: string,
  metadata?: Record<string, string | number | boolean | null>,
): void {
  draft.audit.push({
    id: recordId(),
    ...(actor.id === undefined ? {} : { actorId: actor.id }),
    actorEmail: actor.email,
    action,
    targetType,
    ...(targetId === undefined ? {} : { targetId }),
    summary,
    ip,
    createdAt: new Date().toISOString(),
    ...(metadata === undefined ? {} : { metadata }),
  })
}

function validatePassword(value: unknown): string {
  if (typeof value !== 'string' || value.length < MIN_PASSWORD_LENGTH || value.length > MAX_PASSWORD_LENGTH) {
    throw new HttpError(400, `密码长度必须为 ${String(MIN_PASSWORD_LENGTH)} 到 ${String(MAX_PASSWORD_LENGTH)} 个字符`, 'invalid_password')
  }
  return value
}

function optionalStatus<T extends string>(value: unknown, allowed: readonly T[], name: string): T | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    throw new HttpError(400, `${name}取值无效`, 'invalid_field')
  }
  return value as T
}

function parseTimestamp(value: string | null, name: string): number | undefined {
  if (value === null || value === '') return undefined
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed)) throw new HttpError(400, `${name}不是有效时间`, 'invalid_field')
  return parsed
}

function validateHttpUrl(value: string): string {
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    throw new HttpError(400, '渠道地址不是有效 URL', 'invalid_field')
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new HttpError(400, '渠道地址必须使用 http 或 https', 'invalid_field')
  }
  return parsed.href.replace(/\/$/u, '')
}

function countActiveOwners(data: EnterpriseData): number {
  return data.users.filter(user => user.status === 'active' && user.roleId === 'role-owner').length
}

function browserNumber(value: unknown, name: string, minimum: number, maximum: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw new HttpError(400, `${name}超出允许范围`, 'invalid_field')
  }
  return value
}

function remoteBrowserControl(body: Record<string, unknown>): RemoteBrowserControl {
  const action = textField(body.action, '浏览器操作', 32)
  switch (action) {
    case 'navigate':
      return { action, url: textField(body.url, '浏览器地址', 16 * 1024) }
    case 'back':
    case 'forward':
    case 'reload':
      return { action }
    case 'resize':
      return {
        action,
        width: integerField(body.width, '浏览器宽度', 320, 1600),
        height: integerField(body.height, '浏览器高度', 320, 1200),
      }
    case 'pointer': {
      const event = optionalStatus(body.event, ['click', 'move', 'down', 'up'] as const, '鼠标操作')
      if (event === undefined) throw new HttpError(400, '缺少鼠标操作', 'invalid_field')
      const button = optionalStatus(body.button, ['left', 'middle', 'right'] as const, '鼠标按键')
      return {
        action,
        event,
        x: browserNumber(body.x, '鼠标横坐标', 0, 1600),
        y: browserNumber(body.y, '鼠标纵坐标', 0, 1200),
        ...button === undefined ? {} : { button },
      }
    }
    case 'wheel':
      return {
        action,
        deltaX: browserNumber(body.deltaX, '横向滚动量', -100_000, 100_000),
        deltaY: browserNumber(body.deltaY, '纵向滚动量', -100_000, 100_000),
      }
    case 'key': {
      const modifiers = body.modifiers
      if (modifiers !== undefined && (!Array.isArray(modifiers)
        || modifiers.some(value => !['Alt', 'Control', 'Meta', 'Shift'].includes(String(value))))) {
        throw new HttpError(400, '键盘修饰键无效', 'invalid_field')
      }
      return {
        action,
        key: textField(body.key, '键盘按键', 64),
        ...modifiers === undefined ? {} : { modifiers: modifiers as ('Alt' | 'Control' | 'Meta' | 'Shift')[] },
      }
    }
    case 'insertText':
      if (typeof body.text !== 'string' || body.text.length > 10_000) {
        throw new HttpError(400, '输入文本无效', 'invalid_field')
      }
      return { action, text: body.text }
    default:
      throw new HttpError(400, '不支持的浏览器操作', 'invalid_field')
  }
}

/** HTTP API attached to the `/enterprise/api` route. */
export class EnterpriseApi {
  private readonly attempts = new Map<string, LoginAttempt>()
  private readonly verification: VerificationService
  private readonly desktopAuth: DesktopAuthService
  private readonly desktopModels: DesktopModels
  private readonly desktopGateway: DesktopModelGateway

  private constructor(private readonly dependencies: ApiDependencies) {
    this.verification = dependencies.verification ?? new VerificationService()
    this.desktopAuth = new DesktopAuthService(dependencies.store)
    this.desktopModels = new DesktopModels(dependencies.store)
    this.desktopGateway = new DesktopModelGateway(dependencies.store, { models: this.desktopModels })
  }

  /**
   * Construct an API over a durable store.
   * @param dependencies - durable store and Harness launch adapters.
   * @returns initialized API.
   */
  static create(dependencies: ApiDependencies): Promise<EnterpriseApi> {
    return Promise.resolve(new EnterpriseApi(dependencies))
  }

  /**
   * Dispatch one enterprise API request.
   * @param request - incoming HTTP request.
   * @param response - response owned by the API.
   * @param url - parsed request URL.
   * @returns completion after a response is written.
   */
  async handle(request: IncomingMessage, response: ServerResponse, url: URL): Promise<void> {
    try {
      await this.dispatch(request, response, url)
    } catch (error) {
      if (error instanceof HttpError) {
        sendError(response, error.status, error.message, error.code)
        return
      }
      if (error instanceof TeamResourceError) {
        sendError(response, error.status, error.message, error.code)
        return
      }
      if (error instanceof RemoteBrowserError) {
        sendError(response, error.status, error.message, error.code)
        return
      }
      if (error instanceof DesktopAuthError) {
        sendError(response, error.status, error.message, error.code)
        return
      }
      this.dependencies.logger.warn(error instanceof Error ? error : new Error(String(error)))
      if (!response.headersSent) sendError(response, 500, '服务器处理请求失败，请稍后重试', 'internal_error')
      else response.destroy()
    }
  }

  private async dispatch(request: IncomingMessage, response: ServerResponse, url: URL): Promise<void> {
    const pathname = url.pathname
    const method = request.method ?? 'GET'
    if (pathname === `${API_PREFIX}/health` && method === 'GET') {
      sendJson(response, 200, { ok: true })
      return
    }
    if (pathname === `${API_PREFIX}/public-config` && method === 'GET') {
      const data = this.dependencies.store.snapshot()
      const verificationEnabled = this.verification.enabled
      sendJson(response, 200, {
        brandName: data.settings.brandName,
        registrationEnabled: data.settings.registrationEnabled && verificationEnabled,
        supportEmail: data.settings.supportEmail,
        verificationEnabled,
      })
      return
    }
    if (pathname === `${API_PREFIX}/desktop/auth/login` && method === 'POST') {
      const body = bodyRecord(await readJson(request))
      const origin = requestOrigin(request)
      if (origin === undefined) throw new HttpError(400, '无法确定企业云服务地址', 'invalid_origin')
      const grant = await this.desktopAuth.login(
        normalizeEmail(textField(body.email, '企业邮箱', 320)),
        secretField(body.password, '密码', MAX_PASSWORD_LENGTH),
        optionalTextField(body.deviceName, '设备名称', 120) ?? 'Enterprise Desktop',
        origin,
      )
      sendJson(response, 200, grant)
      return
    }
    if (pathname === `${API_PREFIX}/desktop/auth/refresh` && method === 'POST') {
      const body = bodyRecord(await readJson(request))
      sendJson(response, 200, await this.desktopAuth.refresh(textField(body.refreshToken, '刷新令牌', 2048)))
      return
    }
    if (pathname === `${API_PREFIX}/desktop/auth/logout` && method === 'POST') {
      const body = bodyRecord(await readJson(request))
      await this.desktopAuth.logout(textField(body.refreshToken, '刷新令牌', 2048))
      sendEmpty(response, 204)
      return
    }
    if (pathname === `${API_PREFIX}/desktop/bootstrap` && method === 'GET') {
      const origin = requestOrigin(request)
      if (origin === undefined) throw new HttpError(400, '无法确定企业云服务地址', 'invalid_origin')
      const session = this.desktopAuth.authorizeAccess(bearerToken(request))
      const bootstrap = this.desktopAuth.bootstrap(session, origin)
      await this.desktopAuth.recordBootstrap(session, clientIp(request))
      sendJson(response, 200, bootstrap)
      return
    }
    if (pathname === `${API_PREFIX}/desktop/models` && method === 'GET') {
      const session = this.desktopAuth.authorizeAccess(bearerToken(request))
      sendJson(response, 200, this.desktopModels.catalog(session))
      return
    }
    if (pathname === `${API_PREFIX}/desktop/billing` && method === 'GET') {
      const session = this.desktopAuth.authorizeAccess(bearerToken(request))
      sendJson(response, 200, this.desktopModels.billing(session))
      return
    }
    if (pathname.startsWith(DESKTOP_GATEWAY_PREFIX)) {
      if (method !== 'POST') throw new HttpError(405, '模型网关仅接受 POST 请求', 'method_not_allowed')
      const route = parseDesktopGatewayPath(pathname)
      if (route === undefined) throw new HttpError(404, '接口不存在', 'not_found')
      const session = this.desktopAuth.authorizeAccess(bearerToken(request))
      const sessionId = optionalHeader(request, 'x-dsh-session-id', 'invalid_session_id')
      await this.desktopGateway.forward({
        request,
        response,
        session,
        modelId: route.modelId,
        upstreamPath: route.upstreamPath,
        requestId: optionalHeader(request, 'x-dsh-request-id', 'invalid_request_id') ?? '',
        ...(sessionId === undefined ? {} : { sessionId }),
      })
      return
    }
    if (pathname === `${API_PREFIX}/auth/verification-code` && method === 'POST') {
      await this.requestVerificationCode(request, response)
      return
    }
    if (pathname === `${API_PREFIX}/auth/login/code` && method === 'POST') {
      await this.loginWithVerificationCode(request, response)
      return
    }
    if (pathname === `${API_PREFIX}/auth/register` && method === 'POST') {
      await this.register(request, response)
      return
    }
    if (pathname === `${API_PREFIX}/login` && method === 'POST') {
      await this.login(request, response)
      return
    }
    if (pathname === `${API_PREFIX}/logout` && method === 'POST') {
      await this.logout(request, response)
      return
    }
    if (pathname === `${API_PREFIX}/session/authorize` && (method === 'GET' || method === 'HEAD')) {
      this.authorizeSession(request, response)
      return
    }
    if (pathname === `${API_PREFIX}/session` && method === 'GET') {
      const state = this.authenticateRequest(request)
      if (state === undefined) throw new HttpError(401, '请先登录企业工作台', 'unauthorized')
      sendJson(response, 200, this.sessionProjection(state))
      return
    }
    if (pathname === `${API_PREFIX}/session/password` && method === 'POST') {
      await this.changeOwnPassword(request, response)
      return
    }
    if (pathname === `${API_PREFIX}/harness/launch` && method === 'GET') {
      await this.launchWorkspace(request, response)
      return
    }
    const state = this.requireSession(request)
    if (pathname === `${BROWSER_PATH}/sessions` && method === 'POST') {
      this.requirePermission(state, 'workspace.use')
      await this.openRemoteBrowser(request, response, state)
      return
    }
    if (pathname === `${BROWSER_PATH}/control` && method === 'POST') {
      this.requirePermission(state, 'workspace.use')
      await this.controlRemoteBrowser(request, response, state)
      return
    }
    if (pathname === `${BROWSER_PATH}/close` && method === 'POST') {
      this.requirePermission(state, 'workspace.use')
      await this.closeRemoteBrowser(request, response, state)
      return
    }
    if (pathname === `${BROWSER_PATH}/frames` && method === 'GET') {
      this.requirePermission(state, 'workspace.use')
      this.streamRemoteBrowser(response, state, url)
      return
    }
    if (pathname === `${API_PREFIX}/billing` && method === 'GET') {
      this.requirePermission(state, 'workspace.use')
      sendJson(response, 200, this.billingOverview(state))
      return
    }
    if (pathname === `${API_PREFIX}/billing/orders` && method === 'POST') {
      this.requirePermission(state, 'workspace.use')
      this.requirePermission(state, BILLING_PURCHASE_PERMISSION)
      await this.createBillingOrder(request, response, state)
      return
    }
    if (pathname === `${API_PREFIX}/billing/usage` && method === 'POST') {
      this.requirePermission(state, 'workspace.use')
      await this.recordMeteredUsage(request, response, state)
      return
    }
    if (pathname === `${API_PREFIX}/resources/access` && method === 'GET') {
      this.requirePermission(state, 'workspace.use')
      sendJson(response, 200, { canWrite: state.permissions.includes(RESOURCE_WRITE_PERMISSION) })
      return
    }
    if (pathname === `${API_PREFIX}/resources/files`) {
      this.requirePermission(state, 'workspace.use')
      if (method === 'GET') {
        await this.listResourceFiles(response, state, url)
        return
      }
      if (method === 'PATCH') {
        this.requireResourceWrite(state)
        await this.renameResourceFile(request, response, state, url)
        return
      }
      if (method === 'DELETE') {
        this.requireResourceWrite(state)
        await this.deleteResourceFile(request, response, state, url)
        return
      }
    }
    if (pathname === `${API_PREFIX}/resources/files/upload` && method === 'POST') {
      this.requireResourceWrite(state)
      await this.uploadResourceFile(request, response, state, url)
      return
    }
    if (pathname === `${API_PREFIX}/resources/files/content` && method === 'GET') {
      this.requirePermission(state, 'workspace.use')
      await this.readResourceFile(response, state, url)
      return
    }
    if (pathname === `${API_PREFIX}/resources/files/content` && method === 'PATCH') {
      this.requireResourceWrite(state)
      await this.writeResourceFile(request, response, state, url)
      return
    }
    if (pathname === `${API_PREFIX}/resources/files/download` && method === 'GET') {
      this.requirePermission(state, 'workspace.use')
      await this.downloadResourceFile(response, state, url)
      return
    }
    if (pathname === `${API_PREFIX}/resources/files/directory` && method === 'POST') {
      this.requireResourceWrite(state)
      await this.createResourceDirectory(request, response, state, url)
      return
    }
    if (pathname === `${API_PREFIX}/resources/skills`) {
      this.requirePermission(state, 'workspace.use')
      if (method === 'GET') {
        sendJson(response, 200, await this.dependencies.resources.listSkills(this.resourceTeam(state, url).id))
        return
      }
      if (method === 'POST') {
        this.requireResourceWrite(state)
        await this.createResourceSkill(request, response, state, url)
        return
      }
    }
    const skillName = pathIdentifier(pathname, `${API_PREFIX}/resources/skills/`)
    if (skillName !== undefined) {
      this.requirePermission(state, 'workspace.use')
      if (method === 'GET') {
        sendJson(response, 200, await this.dependencies.resources.readSkill(this.resourceTeam(state, url).id, skillName))
        return
      }
      if (method === 'PATCH') {
        this.requireResourceWrite(state)
        await this.updateResourceSkill(request, response, state, skillName, url)
        return
      }
      if (method === 'DELETE') {
        this.requireResourceWrite(state)
        await this.deleteResourceSkill(request, response, state, skillName, url)
        return
      }
    }
    if (pathname === `${API_PREFIX}/resources/knowledge`) {
      this.requirePermission(state, 'workspace.use')
      if (method === 'GET') {
        sendJson(response, 200, await this.dependencies.resources.listKnowledge(this.resourceTeam(state, url).id))
        return
      }
      if (method === 'POST') {
        this.requireResourceWrite(state)
        await this.createKnowledgeArticle(request, response, state, url)
        return
      }
    }
    const knowledgeId = pathIdentifier(pathname, `${API_PREFIX}/resources/knowledge/`)
    if (knowledgeId !== undefined) {
      this.requirePermission(state, 'workspace.use')
      if (method === 'GET') {
        sendJson(response, 200, await this.dependencies.resources.readKnowledge(this.resourceTeam(state, url).id, knowledgeId))
        return
      }
      if (method === 'PATCH') {
        this.requireResourceWrite(state)
        await this.updateKnowledgeArticle(request, response, state, knowledgeId, url)
        return
      }
      if (method === 'DELETE') {
        this.requireResourceWrite(state)
        await this.deleteKnowledgeArticle(request, response, state, knowledgeId, url)
        return
      }
    }
    if (pathname === `${API_PREFIX}/dashboard` && method === 'GET') {
      this.requirePermission(state, 'dashboard.read')
      sendJson(response, 200, dashboardView(
        this.dependencies.store.snapshot(),
        this.dependencies.store.usageAggregate(30),
        this.dependencies.store.auditRecords({ limit: 8 }),
      ))
      return
    }
    if (pathname === `${API_PREFIX}/users`) {
      if (method === 'GET') {
        this.requirePermission(state, 'users.read')
        sendJson(response, 200, this.dependencies.store.snapshot().users.map(user => userView(this.dependencies.store.snapshot(), user)))
        return
      }
      if (method === 'POST') {
        this.requirePermission(state, 'users.write')
        await this.createUser(request, response, state)
        return
      }
    }
    const userId = pathIdentifier(pathname, `${API_PREFIX}/users/`)
    if (userId !== undefined) {
      if (method === 'PATCH') {
        this.requirePermission(state, 'users.write')
        await this.updateUser(request, response, state, userId)
        return
      }
      if (method === 'DELETE') {
        this.requirePermission(state, 'users.write')
        await this.deleteUser(request, response, state, userId)
        return
      }
    }
    if (pathname === `${API_PREFIX}/teams`) {
      if (method === 'GET') {
        this.requirePermission(state, 'teams.read')
        sendJson(response, 200, teamViews(this.dependencies.store.snapshot()))
        return
      }
      if (method === 'POST') {
        this.requirePermission(state, 'teams.write')
        await this.createTeam(request, response, state)
        return
      }
    }
    const teamId = pathIdentifier(pathname, `${API_PREFIX}/teams/`)
    if (teamId !== undefined) {
      if (method === 'PATCH') {
        this.requirePermission(state, 'teams.write')
        await this.updateTeam(request, response, state, teamId)
        return
      }
      if (method === 'DELETE') {
        this.requirePermission(state, 'teams.write')
        await this.deleteTeam(request, response, state, teamId)
        return
      }
    }
    if (pathname === `${API_PREFIX}/roles`) {
      if (method === 'GET') {
        this.requirePermission(state, 'roles.read')
        sendJson(response, 200, roleViews(this.dependencies.store.snapshot()))
        return
      }
      if (method === 'POST') {
        this.requirePermission(state, 'roles.write')
        await this.createRole(request, response, state)
        return
      }
    }
    const roleId = pathIdentifier(pathname, `${API_PREFIX}/roles/`)
    if (roleId !== undefined) {
      if (method === 'PATCH') {
        this.requirePermission(state, 'roles.write')
        await this.updateRole(request, response, state, roleId)
        return
      }
      if (method === 'DELETE') {
        this.requirePermission(state, 'roles.write')
        await this.deleteRole(request, response, state, roleId)
        return
      }
    }
    if (pathname === `${API_PREFIX}/plugins`) {
      this.requireAnyPermission(state, [BUILTIN_PLUGIN_WRITE_PERMISSION, ENTERPRISE_PLUGIN_WRITE_PERMISSION])
      if (method === 'GET') {
        sendJson(response, 200, this.pluginsProjection(state))
        return
      }
      if (method === 'POST') {
        this.requirePermission(state, ENTERPRISE_PLUGIN_WRITE_PERMISSION)
        await this.createEnterprisePlugin(request, response, state)
        return
      }
    }
    if (pathname === `${API_PREFIX}/plugins/builtin` && method === 'POST') {
      await this.createBuiltinPlugin(request, response, state)
      return
    }
    const pluginId = pathIdentifier(pathname, `${API_PREFIX}/plugins/`)
    if (pluginId !== undefined) {
      if (method === 'PATCH') {
        await this.updatePlugin(request, response, state, pluginId)
        return
      }
      if (method === 'DELETE') {
        await this.deletePlugin(request, response, state, pluginId)
        return
      }
    }
    if (pathname === `${API_PREFIX}/plans`) {
      if (method === 'GET') {
        this.requirePermission(state, 'plans.read')
        sendJson(response, 200, planViews(this.dependencies.store.snapshot()))
        return
      }
      if (method === 'POST') {
        this.requirePermission(state, 'plans.write')
        await this.createPlan(request, response, state)
        return
      }
    }
    const planId = pathIdentifier(pathname, `${API_PREFIX}/plans/`)
    if (planId !== undefined) {
      if (method === 'PATCH') {
        this.requirePermission(state, 'plans.write')
        await this.updatePlan(request, response, state, planId)
        return
      }
      if (method === 'DELETE') {
        this.requirePermission(state, 'plans.write')
        await this.deletePlan(request, response, state, planId)
        return
      }
    }
    if (pathname === `${API_PREFIX}/orders`) {
      if (method === 'GET') {
        this.requirePermission(state, 'orders.read')
        sendJson(response, 200, orderViews(this.dependencies.store.snapshot()))
        return
      }
      if (method === 'POST') {
        this.requirePermission(state, 'orders.write')
        await this.createOrder(request, response, state)
        return
      }
    }
    for (const action of ['approve', 'reject'] as const) {
      const orderId = actionIdentifier(pathname, `${API_PREFIX}/orders/`, `/${action}`)
      if (orderId !== undefined && method === 'POST') {
        this.requirePermission(state, 'orders.write')
        await this.reviewOrder(request, response, state, orderId, action)
        return
      }
    }
    if (pathname === `${API_PREFIX}/channels`) {
      if (method === 'GET') {
        this.requirePermission(state, 'channels.read')
        sendJson(response, 200, channelViews(this.dependencies.store.snapshot()))
        return
      }
      if (method === 'POST') {
        this.requirePermission(state, 'channels.write')
        await this.createChannel(request, response, state)
        return
      }
    }
    const channelId = pathIdentifier(pathname, `${API_PREFIX}/channels/`)
    if (channelId !== undefined) {
      if (method === 'PATCH') {
        this.requirePermission(state, 'channels.write')
        await this.updateChannel(request, response, state, channelId)
        return
      }
      if (method === 'DELETE') {
        this.requirePermission(state, 'channels.write')
        await this.deleteChannel(request, response, state, channelId)
        return
      }
    }
    if (pathname === `${API_PREFIX}/models`) {
      if (method === 'GET') {
        this.requirePermission(state, 'models.read')
        sendJson(response, 200, modelViews(this.dependencies.store.snapshot()))
        return
      }
      if (method === 'POST') {
        this.requirePermission(state, 'models.write')
        await this.createModel(request, response, state)
        return
      }
    }
    const modelId = pathIdentifier(pathname, `${API_PREFIX}/models/`)
    if (modelId !== undefined) {
      if (method === 'PATCH') {
        this.requirePermission(state, 'models.write')
        await this.updateModel(request, response, state, modelId)
        return
      }
      if (method === 'DELETE') {
        this.requirePermission(state, 'models.write')
        await this.deleteModel(request, response, state, modelId)
        return
      }
    }
    if (pathname === `${API_PREFIX}/usage` && method === 'GET') {
      this.requirePermission(state, 'usage.read')
      this.listUsage(response, url)
      return
    }
    if (pathname === `${API_PREFIX}/usage/record` && method === 'POST') {
      this.requirePermission(state, 'usage.write')
      await this.recordUsage(request, response, state)
      return
    }
    if (pathname === `${API_PREFIX}/audit` && method === 'GET') {
      this.requirePermission(state, 'audit.read')
      this.listAudit(response, url)
      return
    }
    if (pathname === `${API_PREFIX}/settings`) {
      if (method === 'GET') {
        this.requirePermission(state, 'settings.read')
        sendJson(response, 200, this.dependencies.store.snapshot().settings)
        return
      }
      if (method === 'PATCH') {
        this.requirePermission(state, 'settings.write')
        await this.updateSettings(request, response, state)
        return
      }
    }
    sendError(response, 404, '接口不存在', 'not_found')
  }

  private resourceTeam(state: EnterpriseRequestSession, url?: URL): TeamRecord {
    const data = this.dependencies.store.snapshot()
    const requestedId = url?.searchParams.get('teamId') ?? undefined
    if (requestedId !== undefined && requestedId !== '' && requestedId !== state.user.teamId) {
      if (!state.permissions.includes('teams.read')) {
        throw new HttpError(403, '当前角色无权查看其他团队的资源', 'cross_team_forbidden')
      }
      const requested = data.teams.find(candidate => candidate.id === requestedId)
      if (requested === undefined) throw new HttpError(404, '团队不存在', 'team_not_found')
      return requested
    }
    const team = state.user.teamId === undefined
      ? undefined
      : data.teams.find(candidate => candidate.id === state.user.teamId)
    if (team === undefined) throw new HttpError(403, '当前账号尚未分配团队，请联系管理员', 'tenant_unassigned')
    if (team.status !== 'active') throw new HttpError(403, '当前团队已停用，请联系管理员', 'tenant_suspended')
    return team
  }

  private filePath(url: URL, allowRoot = false): string {
    const path = url.searchParams.get('path')
    if (path === null && allowRoot) return ''
    if (path === null || (!allowRoot && path === '')) {
      throw new HttpError(400, '缺少资源路径', 'invalid_path')
    }
    return path
  }

  private async listResourceFiles(response: ServerResponse, state: EnterpriseRequestSession, url: URL): Promise<void> {
    const team = this.resourceTeam(state, url)
    sendJson(response, 200, await this.dependencies.resources.listFiles(team.id, this.filePath(url, true)))
  }

  private async uploadResourceFile(
    request: IncomingMessage,
    response: ServerResponse,
    state: EnterpriseRequestSession,
    url: URL,
  ): Promise<void> {
    if (!sameOriginMutation(request)) throw new HttpError(403, '请求来源校验失败', 'invalid_origin')
    const team = this.resourceTeam(state, url)
    const directory = this.filePath(url, true)
    const name = url.searchParams.get('name')
    if (name === null) throw new HttpError(400, '缺少文件名', 'invalid_field')
    const contents = await readBody(request, TEAM_FILE_UPLOAD_BYTES, '上传文件超过 20 MiB 限制')
    sendJson(response, 201, await this.dependencies.resources.createFile(team.id, directory, name, contents))
  }

  private async readResourceFile(response: ServerResponse, state: EnterpriseRequestSession, url: URL): Promise<void> {
    const team = this.resourceTeam(state, url)
    sendJson(response, 200, await this.dependencies.resources.readTextFile(team.id, this.filePath(url)))
  }

  private async writeResourceFile(
    request: IncomingMessage,
    response: ServerResponse,
    state: EnterpriseRequestSession,
    url: URL,
  ): Promise<void> {
    if (!sameOriginMutation(request)) throw new HttpError(403, '请求来源校验失败', 'invalid_origin')
    const body = bodyRecord(await readJson(request))
    const team = this.resourceTeam(state, url)
    const path = textField(body.path, '文件路径', 2_000)
    if (typeof body.content !== 'string') throw new HttpError(400, '文件内容必须是文本', 'invalid_field')
    if (Buffer.byteLength(body.content, 'utf8') > TEAM_FILE_TEXT_BYTES) {
      throw new HttpError(413, '文件内容超过 2 MiB 在线编辑限制', 'payload_too_large')
    }
    sendJson(response, 200, await this.dependencies.resources.writeTextFile(team.id, path, body.content))
  }

  private async downloadResourceFile(response: ServerResponse, state: EnterpriseRequestSession, url: URL): Promise<void> {
    const team = this.resourceTeam(state, url)
    const download = await this.dependencies.resources.openDownload(team.id, this.filePath(url))
    response.writeHead(200, {
      ...SECURITY_HEADERS,
      'cache-control': 'private, no-store',
      'content-disposition': attachmentDisposition(download.name),
      'content-length': String(download.size),
      'content-type': 'application/octet-stream',
    })
    response.on('close', () => {
      if (!response.writableEnded) download.stream.destroy()
    })
    download.stream.on('error', (error) => {
      this.dependencies.logger.warn(error)
      response.destroy(error)
    })
    download.stream.pipe(response)
  }

  private async createResourceDirectory(
    request: IncomingMessage,
    response: ServerResponse,
    state: EnterpriseRequestSession,
    url: URL,
  ): Promise<void> {
    if (!sameOriginMutation(request)) throw new HttpError(403, '请求来源校验失败', 'invalid_origin')
    const body = bodyRecord(await readJson(request))
    const team = this.resourceTeam(state, url)
    const path = textField(body.path, '目录路径', 2_000)
    sendJson(response, 201, await this.dependencies.resources.createDirectory(team.id, path))
  }

  private async renameResourceFile(
    request: IncomingMessage,
    response: ServerResponse,
    state: EnterpriseRequestSession,
    url: URL,
  ): Promise<void> {
    if (!sameOriginMutation(request)) throw new HttpError(403, '请求来源校验失败', 'invalid_origin')
    const body = bodyRecord(await readJson(request))
    const team = this.resourceTeam(state, url)
    const path = textField(body.path, '资源路径', 2_000)
    const name = textField(body.name, '新名称', 255)
    sendJson(response, 200, await this.dependencies.resources.renameEntry(team.id, path, name))
  }

  private async deleteResourceFile(
    request: IncomingMessage,
    response: ServerResponse,
    state: EnterpriseRequestSession,
    url: URL,
  ): Promise<void> {
    if (!sameOriginMutation(request)) throw new HttpError(403, '请求来源校验失败', 'invalid_origin')
    const team = this.resourceTeam(state, url)
    await this.dependencies.resources.deleteEntry(team.id, this.filePath(url))
    sendEmpty(response, 204)
  }

  private async createResourceSkill(
    request: IncomingMessage,
    response: ServerResponse,
    state: EnterpriseRequestSession,
    url: URL,
  ): Promise<void> {
    if (!sameOriginMutation(request)) throw new HttpError(403, '请求来源校验失败', 'invalid_origin')
    const body = bodyRecord(await readJson(request))
    const team = this.resourceTeam(state, url)
    const input: TeamSkillInput = {
      name: textField(body.name, '技能名称', 80),
      description: textField(body.description, '技能描述', 500),
      instructions: textField(body.instructions, '技能正文', 300_000),
    }
    sendJson(response, 201, await this.dependencies.resources.createSkill(team.id, input))
  }

  private async updateResourceSkill(
    request: IncomingMessage,
    response: ServerResponse,
    state: EnterpriseRequestSession,
    name: string,
    url: URL,
  ): Promise<void> {
    if (!sameOriginMutation(request)) throw new HttpError(403, '请求来源校验失败', 'invalid_origin')
    const body = bodyRecord(await readJson(request))
    const team = this.resourceTeam(state, url)
    sendJson(response, 200, await this.dependencies.resources.updateSkill(team.id, name, {
      description: textField(body.description, '技能描述', 500),
      instructions: textField(body.instructions, '技能正文', 300_000),
    }))
  }

  private async deleteResourceSkill(
    request: IncomingMessage,
    response: ServerResponse,
    state: EnterpriseRequestSession,
    name: string,
    url: URL,
  ): Promise<void> {
    if (!sameOriginMutation(request)) throw new HttpError(403, '请求来源校验失败', 'invalid_origin')
    const team = this.resourceTeam(state, url)
    await this.dependencies.resources.deleteSkill(team.id, name)
    sendEmpty(response, 204)
  }

  private knowledgeInput(body: Record<string, unknown>): KnowledgeInput {
    return {
      title: textField(body.title, '知识标题', 200),
      summary: textField(body.summary, '知识摘要', 1_000),
      body: textField(body.body, '知识正文', 260_000),
      tags: stringArrayField(body.tags, '标签', 12),
    }
  }

  private async createKnowledgeArticle(
    request: IncomingMessage,
    response: ServerResponse,
    state: EnterpriseRequestSession,
    url: URL,
  ): Promise<void> {
    if (!sameOriginMutation(request)) throw new HttpError(403, '请求来源校验失败', 'invalid_origin')
    const team = this.resourceTeam(state, url)
    const input = this.knowledgeInput(bodyRecord(await readJson(request)))
    sendJson(response, 201, await this.dependencies.resources.createKnowledge(team.id, input))
  }

  private async updateKnowledgeArticle(
    request: IncomingMessage,
    response: ServerResponse,
    state: EnterpriseRequestSession,
    id: string,
    url: URL,
  ): Promise<void> {
    if (!sameOriginMutation(request)) throw new HttpError(403, '请求来源校验失败', 'invalid_origin')
    const team = this.resourceTeam(state, url)
    const input = this.knowledgeInput(bodyRecord(await readJson(request)))
    sendJson(response, 200, await this.dependencies.resources.updateKnowledge(team.id, id, input))
  }

  private async deleteKnowledgeArticle(
    request: IncomingMessage,
    response: ServerResponse,
    state: EnterpriseRequestSession,
    id: string,
    url: URL,
  ): Promise<void> {
    if (!sameOriginMutation(request)) throw new HttpError(403, '请求来源校验失败', 'invalid_origin')
    const team = this.resourceTeam(state, url)
    await this.dependencies.resources.deleteKnowledge(team.id, id)
    sendEmpty(response, 204)
  }

  /**
   * Verify one signed enterprise browser session for an API or tenant route.
   * @param request - incoming request carrying the enterprise cookie.
   * @returns the active user and effective permissions, or undefined when invalid.
   */
  authenticateRequest(request: IncomingMessage): EnterpriseRequestSession | undefined {
    const raw = readCookie(request, SESSION_COOKIE)
    if (raw === undefined) return undefined
    const payload = decodeSession(raw, this.dependencies.store.sessionKey)
    if (payload === undefined) return undefined
    const data = this.dependencies.store.snapshot()
    const user = data.users.find(candidate => candidate.id === payload.userId)
    if (user === undefined || user.status !== 'active' || user.sessionVersion !== payload.sessionVersion) return undefined
    return { kind: 'member', user, permissions: permissionsFor(data, user) }
  }

  private requireSession(request: IncomingMessage): EnterpriseRequestSession {
    const state = this.authenticateRequest(request)
    if (state === undefined) throw new HttpError(401, '请先登录企业工作台', 'unauthorized')
    return state
  }

  private requirePermission(state: EnterpriseRequestSession, permission: string): void {
    if (!state.permissions.includes(permission)) {
      throw new HttpError(403, '当前角色没有执行此操作的权限', 'forbidden')
    }
  }

  private requireAnyPermission(state: EnterpriseRequestSession, permissions: readonly string[]): void {
    if (!permissions.some(permission => state.permissions.includes(permission))) {
      throw new HttpError(403, '当前角色没有执行此操作的权限', 'forbidden')
    }
  }

  private pluginsProjection(state: EnterpriseRequestSession): ReturnType<typeof pluginsView> {
    return pluginsView(
      this.dependencies.store.snapshot(),
      state.permissions.includes(BUILTIN_PLUGIN_WRITE_PERMISSION),
      state.permissions.includes(ENTERPRISE_PLUGIN_WRITE_PERMISSION),
    )
  }

  private requireResourceWrite(state: EnterpriseRequestSession): void {
    this.requirePermission(state, 'workspace.use')
    this.requirePermission(state, RESOURCE_WRITE_PERMISSION)
  }

  private remoteBrowserOwner(state: EnterpriseRequestSession): string {
    return `${state.user.teamId ?? 'unassigned'}:${state.user.id}`
  }

  private remoteBrowser(): RemoteBrowserService {
    const service = this.dependencies.remoteBrowser
    if (service === undefined) {
      throw new HttpError(503, '远程浏览器尚未配置', 'browser_unavailable')
    }
    return service
  }

  private async openRemoteBrowser(
    request: IncomingMessage,
    response: ServerResponse,
    state: EnterpriseRequestSession,
  ): Promise<void> {
    if (!sameOriginMutation(request)) throw new HttpError(403, '请求来源校验失败', 'invalid_origin')
    const body = bodyRecord(await readJson(request))
    const result = await this.remoteBrowser().open(this.remoteBrowserOwner(state), {
      url: textField(body.url, '浏览器地址', 16 * 1024),
      width: body.width === undefined
        ? REMOTE_BROWSER_DEFAULT_VIEWPORT.width
        : integerField(body.width, '浏览器宽度', 320, 1600),
      height: body.height === undefined
        ? REMOTE_BROWSER_DEFAULT_VIEWPORT.height
        : integerField(body.height, '浏览器高度', 320, 1200),
    })
    sendJson(response, 201, result)
  }

  private async controlRemoteBrowser(
    request: IncomingMessage,
    response: ServerResponse,
    state: EnterpriseRequestSession,
  ): Promise<void> {
    if (!sameOriginMutation(request)) throw new HttpError(403, '请求来源校验失败', 'invalid_origin')
    const body = bodyRecord(await readJson(request))
    const sessionId = textField(body.sessionId, '浏览器会话', 200)
    const control = remoteBrowserControl(body)
    sendJson(response, 200, await this.remoteBrowser().control(this.remoteBrowserOwner(state), sessionId, control))
  }

  private async closeRemoteBrowser(
    request: IncomingMessage,
    response: ServerResponse,
    state: EnterpriseRequestSession,
  ): Promise<void> {
    if (!sameOriginMutation(request)) throw new HttpError(403, '请求来源校验失败', 'invalid_origin')
    const body = bodyRecord(await readJson(request))
    await this.remoteBrowser().close(this.remoteBrowserOwner(state), textField(body.sessionId, '浏览器会话', 200))
    sendJson(response, 200, { ok: true })
  }

  private streamRemoteBrowser(
    response: ServerResponse,
    state: EnterpriseRequestSession,
    url: URL,
  ): void {
    const sessionId = url.searchParams.get('session')
    if (sessionId === null || sessionId === '') throw new HttpError(400, '缺少浏览器会话', 'invalid_field')
    const pending: RemoteBrowserEvent[] = []
    let streaming = false
    const write = (event: RemoteBrowserEvent): void => {
      if (streaming) {
        if (!response.destroyed && !response.writableEnded) response.write(`data: ${JSON.stringify(event)}\n\n`)
      } else {
        pending.push(event)
      }
    }
    const unsubscribe = this.remoteBrowser().subscribe(this.remoteBrowserOwner(state), sessionId, write)
    response.writeHead(200, {
      ...SECURITY_HEADERS,
      'cache-control': 'no-store',
      connection: 'keep-alive',
      'content-type': 'text/event-stream; charset=utf-8',
      'x-accel-buffering': 'no',
    })
    streaming = true
    for (const event of pending.splice(0)) write(event)
    const keepalive = setInterval(() => {
      if (!response.destroyed && !response.writableEnded) response.write(': keepalive\n\n')
    }, 15_000)
    keepalive.unref()
    const cleanup = (): void => {
      clearInterval(keepalive)
      unsubscribe()
      response.off('close', cleanup)
    }
    response.once('close', cleanup)
  }

  private async login(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (!sameOriginMutation(request)) throw new HttpError(403, '请求来源校验失败', 'invalid_origin')
    const body = bodyRecord(await readJson(request))
    const identifier = loginIdentifier(body)
    const password = textField(body.password, '密码', MAX_PASSWORD_LENGTH)
    const now = Date.now()
    const key = `${clientIp(request)}|${identifier}`
    const attempt = this.attempts.get(key)
    if (attempt !== undefined && attempt.resetAt > now && attempt.count >= LOGIN_ATTEMPT_LIMIT) {
      throw new HttpError(429, '登录尝试过多，请稍后再试', 'too_many_attempts')
    }
    if (attempt !== undefined && attempt.resetAt <= now) this.attempts.delete(key)
    const data = this.dependencies.store.snapshot()
    const user = findUserByIdentifier(data.users, identifier)
    const passwordValid = user === undefined ? false : await verifyPassword(password, user.passwordHash)
    if (user === undefined || user.status !== 'active' || !passwordValid) {
      const current = this.attempts.get(key) ?? { count: 0, resetAt: now + LOGIN_WINDOW_MILLISECONDS }
      current.count += 1
      current.resetAt = current.resetAt > now ? current.resetAt : now + LOGIN_WINDOW_MILLISECONDS
      this.attempts.set(key, current)
      throw new HttpError(401, '邮箱/手机号或密码错误', 'invalid_credentials')
    }
    this.attempts.delete(key)
    await this.completeLogin(request, response, user, {
      method: 'password',
      channel: verificationChannel(identifier),
    })
  }

  private async requestVerificationCode(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (!sameOriginMutation(request)) throw new HttpError(403, '请求来源校验失败', 'invalid_origin')
    const body = bodyRecord(await readJson(request))
    const identifier = loginIdentifier(body)
    const purpose = verificationPurpose(body.purpose)
    const data = this.dependencies.store.snapshot()
    if (purpose === 'register' && !data.settings.registrationEnabled) {
      throw new HttpError(403, '当前未开放自助注册，请联系管理员', 'registration_disabled')
    }
    const user = findUserByIdentifier(data.users, identifier)
    const result = await this.verification.request({
      identifier,
      channel: verificationChannel(identifier),
      purpose,
      brandName: data.settings.brandName,
      requestIp: clientIp(request),
      send: purpose === 'register' || (user !== undefined && user.status === 'active'),
    })
    sendJson(response, 202, { ok: true, ...result })
  }

  private async loginWithVerificationCode(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (!sameOriginMutation(request)) throw new HttpError(403, '请求来源校验失败', 'invalid_origin')
    const body = bodyRecord(await readJson(request))
    const identifier = loginIdentifier(body)
    const code = textField(body.code, '验证码', 32)
    const verified = this.verification.verify({ identifier, purpose: 'login', code })
    const user = findUserByIdentifier(this.dependencies.store.snapshot().users, identifier)
    if (user === undefined || user.status !== 'active') {
      throw new HttpError(401, '验证码无效或已过期', 'invalid_code')
    }
    await this.completeLogin(request, response, user, {
      method: 'verification_code',
      channel: verified.channel,
    })
  }

  private async register(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (!sameOriginMutation(request)) throw new HttpError(403, '请求来源校验失败', 'invalid_origin')
    if (!this.verification.enabled) throw new HttpError(503, '验证码服务尚未配置', 'verification_unavailable')
    const body = bodyRecord(await readJson(request))
    const identifier = loginIdentifier(body)
    const code = textField(body.code, '验证码', 32)
    const name = textField(body.name, '姓名', 120)
    const password = validatePassword(body.password)
    const data = this.dependencies.store.snapshot()
    if (!data.settings.registrationEnabled) {
      throw new HttpError(403, '当前未开放自助注册，请联系管理员', 'registration_disabled')
    }
    let email: string
    let phone: string | undefined
    if (identifier.includes('@')) {
      email = identifier
      const rawPhone = optionalTextField(body.phone, '手机号', 32)
      phone = rawPhone === undefined ? undefined : normalizePhone(rawPhone)
    } else {
      email = normalizeEmail(textField(body.email, '邮箱', 320))
      phone = identifier
    }
    if (!isEmail(email)) throw new HttpError(400, '邮箱格式不正确', 'invalid_field')
    if (phone !== undefined && !isPhone(phone)) throw new HttpError(400, '手机号格式不正确', 'invalid_field')
    this.verification.verify({ identifier, purpose: 'register', code })
    const passwordHash = await hashPassword(password)
    const created = await this.dependencies.store.mutate((draft) => {
      if (!draft.settings.registrationEnabled) {
        throw new HttpError(403, '当前未开放自助注册，请联系管理员', 'registration_disabled')
      }
      if (draft.users.some(user => user.email === email)) throw new HttpError(409, '该邮箱已注册', 'email_exists')
      if (phone !== undefined && draft.users.some(user => user.phone === phone)) {
        throw new HttpError(409, '该手机号已注册', 'phone_exists')
      }
      const role = draft.roles.find(candidate => candidate.id === draft.settings.defaultRoleId)
      if (role === undefined) throw new HttpError(409, '自助注册暂不可用，请联系管理员', 'registration_unavailable')
      const team = draft.teams.find(candidate => candidate.id === draft.settings.defaultTeamId)
      if (team === undefined || team.status !== 'active') {
        throw new HttpError(409, '自助注册暂不可用，请联系管理员', 'registration_unavailable')
      }
      if (draft.users.filter(user => user.teamId === team.id).length >= team.seatLimit) {
        throw new HttpError(409, '默认团队席位已满，请联系管理员', 'seat_limit_reached')
      }
      const now = new Date().toISOString()
      const user: UserRecord = {
        id: recordId(),
        email,
        ...(phone === undefined ? {} : { phone }),
        name,
        passwordHash,
        roleId: role.id,
        teamId: team.id,
        status: 'active',
        sessionVersion: 1,
        createdAt: now,
        lastLoginAt: now,
      }
      draft.users.push(user)
      appendAudit(draft, { email: 'system@enterprise.local' }, 'user.register', 'user', user.id, `自助注册用户 ${user.email}`, clientIp(request), {
        roleId: role.id,
        teamId: team.id,
      })
      return user
    })
    this.setSessionCookie(request, response, created)
    sendJson(response, 201, this.sessionProjection({
      kind: 'member',
      user: created,
      permissions: permissionsFor(this.dependencies.store.snapshot(), created),
    }))
  }

  private async completeLogin(
    request: IncomingMessage,
    response: ServerResponse,
    user: UserRecord,
    method: { readonly method: 'password' | 'verification_code'; readonly channel: VerificationChannel },
  ): Promise<void> {
    const updated = await this.dependencies.store.mutate((draft) => {
      const target = draft.users.find(candidate => candidate.id === user.id)
      if (target === undefined || target.status !== 'active') throw new HttpError(401, '登录账号已失效', 'invalid_credentials')
      target.lastLoginAt = new Date().toISOString()
      appendAudit(draft, target, 'auth.login', 'user', target.id, `${target.email} 登录企业工作台`, clientIp(request), method)
      return target
    })
    this.setSessionCookie(request, response, updated)
    sendJson(response, 200, this.sessionProjection({
      kind: 'member',
      user: updated,
      permissions: permissionsFor(this.dependencies.store.snapshot(), updated),
    }))
  }

  private async logout(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (!sameOriginMutation(request)) throw new HttpError(403, '请求来源校验失败', 'invalid_origin')
    const state = this.authenticateRequest(request)
    if (state !== undefined) {
      await this.dependencies.store.mutate((draft) => {
        const actor = draft.users.find(user => user.id === state.user.id)
        if (actor === undefined) return
        actor.sessionVersion += 1
        appendAudit(draft, actor, 'auth.logout', 'user', actor.id, `${actor.email} 退出企业工作台`, clientIp(request))
      })
    }
    const secure = requestProtocol(request) === 'https'
    const cookies = [serializeCookie(SESSION_COOKIE, '', {
      maxAgeSeconds: 0,
      expires: new Date(0),
      secure,
    })]
    const authority = requestAuthority(request)
    if (authority !== undefined) {
      cookies.push(serializeCookie(harnessCookieName(authority), '', {
        path: '/harness/',
        maxAgeSeconds: 0,
        expires: new Date(0),
        secure,
      }))
      const data = this.dependencies.store.snapshot()
      const team = state?.user.teamId === undefined ? undefined : data.teams.find(candidate => candidate.id === state.user.teamId)
      if (team !== undefined) {
        cookies.push(serializeCookie(harnessCookieName(authority), '', {
          path: this.dependencies.tenantPath(team),
          maxAgeSeconds: 0,
          expires: new Date(0),
          secure,
        }))
      }
    }
    response.setHeader('set-cookie', cookies)
    sendJson(response, 200, { ok: true })
  }

  private authorizeSession(request: IncomingMessage, response: ServerResponse): void {
    const state = this.authenticateRequest(request)
    if (state === undefined || !state.permissions.includes('workspace.use')) {
      sendEmpty(response, 401)
      return
    }
    sendEmpty(response, 204, { 'x-enterprise-user': state.user.email })
  }

  private async launchWorkspace(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const state = this.authenticateRequest(request)
    if (state === undefined) {
      this.redirectToLogin(response)
      return
    }
    this.requirePermission(state, 'workspace.use')
    const data = this.dependencies.store.snapshot()
    const team = state.user.teamId === undefined ? undefined : data.teams.find(candidate => candidate.id === state.user.teamId)
    if (team === undefined) throw new HttpError(403, '当前账号尚未分配团队，请联系管理员', 'tenant_unassigned')
    if (team.status !== 'active') throw new HttpError(403, '当前团队已停用，请联系管理员', 'tenant_suspended')
    await this.dependencies.store.mutate((draft) => {
      appendAudit(draft, state.user, 'workspace.launch', 'workspace', team.id, `${state.user.email} 打开团队 AI 工作台`, clientIp(request), {
        teamId: team.id,
        tenantSlug: team.slug,
      })
    })
    await this.prepareTenant(team)
    this.redirectToTenant(response, team)
  }

  private async prepareTenant(team: TeamRecord): Promise<void> {
    try {
      await this.dependencies.prepareTenant(team)
    } catch (error) {
      this.dependencies.logger.warn(error instanceof Error ? error : new Error(String(error)))
      throw new HttpError(503, '团队工作台启动失败，请稍后重试', 'tenant_unavailable')
    }
  }

  private redirectToLogin(response: ServerResponse): void {
    response.writeHead(303, {
      ...SECURITY_HEADERS_FOR_REDIRECT,
      'cache-control': 'no-store',
      location: '/enterprise/login?next=%2Fenterprise%2Fworkspace',
      'referrer-policy': 'no-referrer',
    })
    response.end()
  }

  private redirectToTenant(response: ServerResponse, team: TeamRecord): void {
    const location = this.dependencies.tenantPath(team)
    response.writeHead(303, {
      ...SECURITY_HEADERS_FOR_REDIRECT,
      'cache-control': 'no-store',
      location,
      'referrer-policy': 'no-referrer',
    })
    response.end()
  }

  private async changeOwnPassword(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (!sameOriginMutation(request)) throw new HttpError(403, '请求来源校验失败', 'invalid_origin')
    const state = this.requireSession(request)
    const body = bodyRecord(await readJson(request))
    const currentPassword = textField(body.currentPassword, '当前密码', MAX_PASSWORD_LENGTH)
    const newPassword = validatePassword(body.newPassword)
    if (!await verifyPassword(currentPassword, state.user.passwordHash)) {
      throw new HttpError(400, '当前密码不正确', 'invalid_password')
    }
    const passwordHash = await hashPassword(newPassword)
    const updated = await this.dependencies.store.mutate((draft) => {
      const actor = requirePermissionInDraft(draft, state.user.id, 'workspace.use')
      actor.passwordHash = passwordHash
      actor.sessionVersion += 1
      appendAudit(draft, actor, 'auth.password_change', 'user', actor.id, `${actor.email} 修改了登录密码`, clientIp(request))
      return actor
    })
    await this.dependencies.store.removeInitialPasswordFile()
    this.setSessionCookie(request, response, updated)
    sendJson(response, 200, { ok: true })
  }

  private sessionProjection(state: EnterpriseRequestSession): ReturnType<typeof sessionView> {
    const data = this.dependencies.store.snapshot()
    const team = state.user.teamId === undefined ? undefined : data.teams.find(candidate => candidate.id === state.user.teamId)
    return sessionView(data, state.user, team === undefined ? '/enterprise/workspace' : this.dependencies.tenantPath(team))
  }

  private setSessionCookie(request: IncomingMessage, response: ServerResponse, user: UserRecord): void {
    const data = this.dependencies.store.snapshot()
    const maxAgeDays = data.settings.sessionMaxAgeDays
    const issuedAt = Date.now()
    const expiresAt = issuedAt + maxAgeDays * 24 * 60 * 60 * 1000
    const secure = requestProtocol(request) === 'https'
    response.setHeader('set-cookie', serializeCookie(SESSION_COOKIE, encodeSession({
      version: 1,
      userId: user.id,
      sessionVersion: user.sessionVersion,
      issuedAt,
      expiresAt,
    }, this.dependencies.store.sessionKey), {
      maxAgeSeconds: maxAgeDays * 24 * 60 * 60,
      expires: new Date(expiresAt),
      secure,
    }))
  }

  private async createUser(request: IncomingMessage, response: ServerResponse, state: EnterpriseRequestSession): Promise<void> {
    if (!sameOriginMutation(request)) throw new HttpError(403, '请求来源校验失败', 'invalid_origin')
    const body = bodyRecord(await readJson(request))
    const email = normalizeEmail(textField(body.email, '邮箱', 320))
    if (!isEmail(email)) throw new HttpError(400, '邮箱格式不正确', 'invalid_field')
    const rawPhone = optionalTextField(body.phone, '手机号', 32)
    const phone = rawPhone === undefined ? undefined : normalizePhone(rawPhone)
    if (phone !== undefined && !isPhone(phone)) throw new HttpError(400, '手机号格式不正确', 'invalid_field')
    const name = textField(body.name, '姓名', 120)
    const roleId = textField(body.roleId, '角色', 120)
    const teamId = optionalTextField(body.teamId, '团队', 120)
    const status = optionalStatus(body.status, ['active', 'disabled'] as const, '状态') ?? 'active'
    const generatedPassword = body.password === undefined ? generateTemporaryPassword() : undefined
    const password = generatedPassword ?? validatePassword(body.password)
    const passwordHash = await hashPassword(password)
    const created = await this.dependencies.store.mutate((draft) => {
      const actor = requirePermissionInDraft(draft, state.user.id, 'users.write')
      if (draft.users.some(user => user.email === email)) throw new HttpError(409, '该邮箱已存在', 'email_exists')
      if (phone !== undefined && draft.users.some(user => user.phone === phone)) throw new HttpError(409, '该手机号已存在', 'phone_exists')
      const role = draft.roles.find(candidate => candidate.id === roleId)
      if (role === undefined) throw new HttpError(400, '角色不存在', 'invalid_role')
      assertRoleAssignable(actor, role)
      if (teamId !== undefined) {
        const team = draft.teams.find(candidate => candidate.id === teamId)
        if (team === undefined) throw new HttpError(400, '团队不存在', 'invalid_team')
        if (draft.users.filter(user => user.teamId === teamId).length >= team.seatLimit) {
          throw new HttpError(409, '团队席位已满', 'seat_limit_reached')
        }
      }
      const user: UserRecord = {
        id: recordId(),
        email,
        ...(phone === undefined ? {} : { phone }),
        name,
        passwordHash,
        roleId,
        ...(teamId === undefined ? {} : { teamId }),
        status,
        sessionVersion: 1,
        createdAt: new Date().toISOString(),
      }
      draft.users.push(user)
      appendAudit(draft, actor, 'user.create', 'user', user.id, `创建用户 ${user.email}`, clientIp(request), { roleId })
      return userView(draft, user)
    })
    sendJson(response, 201, {
      user: created,
      ...(generatedPassword === undefined ? {} : { temporaryPassword: generatedPassword }),
    })
  }

  private async updateUser(
    request: IncomingMessage,
    response: ServerResponse,
    state: EnterpriseRequestSession,
    userId: string,
  ): Promise<void> {
    if (!sameOriginMutation(request)) throw new HttpError(403, '请求来源校验失败', 'invalid_origin')
    const body = bodyRecord(await readJson(request))
    const password = hasOwn(body, 'password') ? validatePassword(body.password) : undefined
    const passwordHash = password === undefined ? undefined : await hashPassword(password)
    const updated = await this.dependencies.store.mutate((draft) => {
      const actor = requirePermissionInDraft(draft, state.user.id, 'users.write')
      const target = draft.users.find(user => user.id === userId)
      if (target === undefined) throw new HttpError(404, '用户不存在', 'not_found')
      assertUserWithinActor(actor, target)
      if (target.id === actor.id && body.status === 'disabled') throw new HttpError(409, '不能停用当前登录账号', 'cannot_disable_self')
      if (hasOwn(body, 'email')) {
        const email = normalizeEmail(textField(body.email, '邮箱', 320))
        if (!isEmail(email)) throw new HttpError(400, '邮箱格式不正确', 'invalid_field')
        if (draft.users.some(user => user.id !== target.id && user.email === email)) throw new HttpError(409, '该邮箱已存在', 'email_exists')
        target.email = email
      }
      if (hasOwn(body, 'phone')) {
        const rawPhone = optionalTextField(body.phone, '手机号', 32)
        if (rawPhone === undefined) delete target.phone
        else {
          const phone = normalizePhone(rawPhone)
          if (!isPhone(phone)) throw new HttpError(400, '手机号格式不正确', 'invalid_field')
          if (draft.users.some(user => user.id !== target.id && user.phone === phone)) throw new HttpError(409, '该手机号已存在', 'phone_exists')
          target.phone = phone
        }
      }
      if (hasOwn(body, 'name')) target.name = textField(body.name, '姓名', 120)
      if (hasOwn(body, 'roleId')) {
        const roleId = textField(body.roleId, '角色', 120)
        const role = draft.roles.find(candidate => candidate.id === roleId)
        if (role === undefined) throw new HttpError(400, '角色不存在', 'invalid_role')
        assertRoleAssignable(actor, role)
        target.roleId = roleId
      }
      if (hasOwn(body, 'teamId')) {
        const teamId = optionalTextField(body.teamId, '团队', 120)
        if (teamId === undefined) delete target.teamId
        else {
          const team = draft.teams.find(candidate => candidate.id === teamId)
          if (team === undefined) throw new HttpError(400, '团队不存在', 'invalid_team')
          if (target.teamId !== teamId && draft.users.filter(user => user.teamId === teamId).length >= team.seatLimit) {
            throw new HttpError(409, '团队席位已满', 'seat_limit_reached')
          }
          target.teamId = teamId
        }
      }
      if (hasOwn(body, 'status')) target.status = optionalStatus(body.status, ['active', 'disabled'] as const, '状态') ?? target.status
      if (passwordHash !== undefined) {
        target.passwordHash = passwordHash
        target.sessionVersion += 1
      }
      if (countActiveOwners(draft) === 0) throw new HttpError(409, '必须至少保留一名启用状态的所有者', 'last_owner')
      appendAudit(draft, actor, 'user.update', 'user', target.id, `更新用户 ${target.email}`, clientIp(request))
      return userView(draft, target)
    })
    sendJson(response, 200, updated)
  }

  private async deleteUser(
    request: IncomingMessage,
    response: ServerResponse,
    state: EnterpriseRequestSession,
    userId: string,
  ): Promise<void> {
    if (!sameOriginMutation(request)) throw new HttpError(403, '请求来源校验失败', 'invalid_origin')
    await this.dependencies.store.mutate((draft) => {
      const actor = requirePermissionInDraft(draft, state.user.id, 'users.write')
      if (actor.id === userId) throw new HttpError(409, '不能删除当前登录账号', 'cannot_delete_self')
      const index = draft.users.findIndex(user => user.id === userId)
      const target = draft.users[index]
      if (target === undefined) throw new HttpError(404, '用户不存在', 'not_found')
      assertUserWithinActor(actor, target)
      draft.users.splice(index, 1)
      if (countActiveOwners(draft) === 0) throw new HttpError(409, '必须至少保留一名启用状态的所有者', 'last_owner')
      appendAudit(draft, actor, 'user.delete', 'user', target.id, `删除用户 ${target.email}`, clientIp(request))
    })
    sendJson(response, 200, { ok: true })
  }

  private async createTeam(request: IncomingMessage, response: ServerResponse, state: EnterpriseRequestSession): Promise<void> {
    if (!sameOriginMutation(request)) throw new HttpError(403, '请求来源校验失败', 'invalid_origin')
    const body = bodyRecord(await readJson(request))
    const name = textField(body.name, '团队名称', 120)
    const slug = textField(body.slug, '团队标识', 80).toLowerCase()
    if (!/^[a-z0-9][a-z0-9-]*$/u.test(slug)) throw new HttpError(400, '团队标识只能包含小写字母、数字和连字符', 'invalid_field')
    const planId = textField(body.planId, '套餐', 120)
    const seatLimit = integerField(body.seatLimit ?? 10, '席位数', 1, 100_000)
    const notes = optionalTextField(body.notes, '备注', 1000) ?? ''
    const created = await this.dependencies.store.mutate((draft) => {
      const actor = requirePermissionInDraft(draft, state.user.id, 'teams.write')
      if (draft.teams.some(team => team.slug === slug)) throw new HttpError(409, '团队标识已存在', 'slug_exists')
      if (!draft.plans.some(plan => plan.id === planId)) throw new HttpError(400, '套餐不存在', 'invalid_plan')
      const team: TeamRecord = {
        id: recordId(), name, slug, planId, status: 'active', seatLimit, notes, createdAt: new Date().toISOString(),
      }
      draft.teams.push(team)
      appendAudit(draft, actor, 'team.create', 'team', team.id, `创建团队 ${team.name}`, clientIp(request))
      return teamViews(draft).find(view => view.id === team.id)
    })
    sendJson(response, 201, created)
  }

  private async updateTeam(
    request: IncomingMessage,
    response: ServerResponse,
    state: EnterpriseRequestSession,
    teamId: string,
  ): Promise<void> {
    if (!sameOriginMutation(request)) throw new HttpError(403, '请求来源校验失败', 'invalid_origin')
    const body = bodyRecord(await readJson(request))
    const updated = await this.dependencies.store.mutate((draft) => {
      const actor = requirePermissionInDraft(draft, state.user.id, 'teams.write')
      const team = draft.teams.find(candidate => candidate.id === teamId)
      if (team === undefined) throw new HttpError(404, '团队不存在', 'not_found')
      const memberCount = draft.users.filter(user => user.teamId === team.id).length
      if (hasOwn(body, 'name')) team.name = textField(body.name, '团队名称', 120)
      if (hasOwn(body, 'slug')) {
        const slug = textField(body.slug, '团队标识', 80).toLowerCase()
        if (!/^[a-z0-9][a-z0-9-]*$/u.test(slug)) throw new HttpError(400, '团队标识格式不正确', 'invalid_field')
        if (draft.teams.some(candidate => candidate.id !== team.id && candidate.slug === slug)) throw new HttpError(409, '团队标识已存在', 'slug_exists')
        team.slug = slug
      }
      if (hasOwn(body, 'planId')) {
        const planId = textField(body.planId, '套餐', 120)
        if (!draft.plans.some(plan => plan.id === planId)) throw new HttpError(400, '套餐不存在', 'invalid_plan')
        team.planId = planId
      }
      if (hasOwn(body, 'seatLimit')) {
        const seatLimit = integerField(body.seatLimit, '席位数', 1, 100_000)
        if (seatLimit < memberCount) throw new HttpError(409, `席位数不能低于当前成员数 ${String(memberCount)}`, 'seat_limit_too_low')
        team.seatLimit = seatLimit
      }
      if (hasOwn(body, 'status')) team.status = optionalStatus(body.status, ['active', 'suspended'] as const, '状态') ?? team.status
      if (hasOwn(body, 'notes')) team.notes = optionalTextField(body.notes, '备注', 1000) ?? ''
      appendAudit(draft, actor, 'team.update', 'team', team.id, `更新团队 ${team.name}`, clientIp(request))
      return teamViews(draft).find(view => view.id === team.id)
    })
    sendJson(response, 200, updated)
  }

  private async deleteTeam(
    request: IncomingMessage,
    response: ServerResponse,
    state: EnterpriseRequestSession,
    teamId: string,
  ): Promise<void> {
    if (!sameOriginMutation(request)) throw new HttpError(403, '请求来源校验失败', 'invalid_origin')
    await this.dependencies.store.mutate((draft) => {
      const actor = requirePermissionInDraft(draft, state.user.id, 'teams.write')
      const team = draft.teams.find(candidate => candidate.id === teamId)
      if (team === undefined) throw new HttpError(404, '团队不存在', 'not_found')
      if (draft.settings.defaultTeamId === team.id) throw new HttpError(409, '默认注册团队不能删除', 'default_team')
      if (draft.users.some(user => user.teamId === team.id)) throw new HttpError(409, '请先移除团队内的用户', 'team_not_empty')
      if (draft.orders.some(order => order.teamId === team.id)) throw new HttpError(409, '团队存在关联订单，不能删除', 'team_has_orders')
      draft.teams = draft.teams.filter(candidate => candidate.id !== team.id)
      appendAudit(draft, actor, 'team.delete', 'team', team.id, `删除团队 ${team.name}`, clientIp(request))
    })
    sendJson(response, 200, { ok: true })
  }

  private async createRole(request: IncomingMessage, response: ServerResponse, state: EnterpriseRequestSession): Promise<void> {
    if (!sameOriginMutation(request)) throw new HttpError(403, '请求来源校验失败', 'invalid_origin')
    const body = bodyRecord(await readJson(request))
    const name = textField(body.name, '角色名称', 120)
    const description = optionalTextField(body.description, '角色说明', 500) ?? ''
    const permissions = this.validatedPermissions(body.permissions)
    const created = await this.dependencies.store.mutate((draft) => {
      const actor = requirePermissionInDraft(draft, state.user.id, 'roles.write')
      assertOwnerRoleManager(actor)
      if (draft.roles.some(role => role.name === name)) throw new HttpError(409, '角色名称已存在', 'role_exists')
      assertPermissionsWithinActor(draft, actor, permissions, '不能创建超出自身权限的角色')
      const role: RoleRecord = {
        id: recordId(), name, description, permissions, system: false, createdAt: new Date().toISOString(),
      }
      draft.roles.push(role)
      appendAudit(draft, actor, 'role.create', 'role', role.id, `创建角色 ${role.name}`, clientIp(request))
      return roleViews(draft).find(view => view.id === role.id)
    })
    sendJson(response, 201, created)
  }

  private async updateRole(
    request: IncomingMessage,
    response: ServerResponse,
    state: EnterpriseRequestSession,
    roleId: string,
  ): Promise<void> {
    if (!sameOriginMutation(request)) throw new HttpError(403, '请求来源校验失败', 'invalid_origin')
    const body = bodyRecord(await readJson(request))
    const requestedPermissions = hasOwn(body, 'permissions') ? this.validatedPermissions(body.permissions) : undefined
    const updated = await this.dependencies.store.mutate((draft) => {
      const actor = requirePermissionInDraft(draft, state.user.id, 'roles.write')
      assertOwnerRoleManager(actor)
      const role = draft.roles.find(candidate => candidate.id === roleId)
      if (role === undefined) throw new HttpError(404, '角色不存在', 'not_found')
      assertPermissionsWithinActor(draft, actor, role.permissions, '不能修改权限高于当前账号的角色')
      if (role.id === 'role-owner') {
        throw new HttpError(409, '所有者角色由系统内置，不能修改', 'owner_role_locked')
      }
      if (requestedPermissions !== undefined) {
        assertPermissionsWithinActor(draft, actor, requestedPermissions, '不能授予超出自身权限的角色权限')
      }
      if (hasOwn(body, 'name')) {
        const name = textField(body.name, '角色名称', 120)
        if (draft.roles.some(candidate => candidate.id !== role.id && candidate.name === name)) throw new HttpError(409, '角色名称已存在', 'role_exists')
        role.name = name
      }
      if (hasOwn(body, 'description')) role.description = optionalTextField(body.description, '角色说明', 500) ?? ''
      if (requestedPermissions !== undefined) role.permissions = requestedPermissions
      appendAudit(draft, actor, 'role.update', 'role', role.id, `更新角色 ${role.name}`, clientIp(request))
      return roleViews(draft).find(view => view.id === role.id)
    })
    sendJson(response, 200, updated)
  }

  private async deleteRole(
    request: IncomingMessage,
    response: ServerResponse,
    state: EnterpriseRequestSession,
    roleId: string,
  ): Promise<void> {
    if (!sameOriginMutation(request)) throw new HttpError(403, '请求来源校验失败', 'invalid_origin')
    await this.dependencies.store.mutate((draft) => {
      const actor = requirePermissionInDraft(draft, state.user.id, 'roles.write')
      assertOwnerRoleManager(actor)
      const role = draft.roles.find(candidate => candidate.id === roleId)
      if (role === undefined) throw new HttpError(404, '角色不存在', 'not_found')
      assertPermissionsWithinActor(draft, actor, role.permissions, '不能删除权限高于当前账号的角色')
      if (role.system) throw new HttpError(409, '系统角色不能删除', 'system_role')
      if (draft.users.some(user => user.roleId === role.id)) throw new HttpError(409, '角色仍有用户使用', 'role_in_use')
      draft.roles = draft.roles.filter(candidate => candidate.id !== role.id)
      appendAudit(draft, actor, 'role.delete', 'role', role.id, `删除角色 ${role.name}`, clientIp(request))
    })
    sendJson(response, 200, { ok: true })
  }

  private pluginInstaller(): EnterprisePluginInstaller {
    if (this.dependencies.plugins === undefined) {
      throw new HttpError(503, '企业插件安装服务尚未配置', 'plugin_service_unavailable')
    }
    return this.dependencies.plugins
  }

  private async tenantsPluginPolicyChanged(): Promise<void> {
    if (this.dependencies.pluginsChanged === undefined) return
    try {
      await this.dependencies.pluginsChanged()
    } catch (error) {
      this.dependencies.logger.warn(error instanceof Error ? error : new Error(String(error)))
    }
  }

  private async createEnterprisePlugin(
    request: IncomingMessage,
    response: ServerResponse,
    state: EnterpriseRequestSession,
  ): Promise<void> {
    if (!sameOriginMutation(request)) throw new HttpError(403, '请求来源校验失败', 'invalid_origin')
    const body = bodyRecord(await readJson(request))
    const requested = parseEnterprisePluginSpec(textField(body.spec, '插件包', 300))
    const installer = this.pluginInstaller()
    if (BUILTIN_PLUGINS.some(plugin => plugin.packageName === requested.name)) {
      throw new HttpError(409, '内置插件由企业所有者统一管理', 'builtin_plugin')
    }
    if (this.dependencies.store.snapshot().plugins.some(plugin => plugin.scope === 'enterprise' && plugin.packageName === requested.name)) {
      throw new HttpError(409, '该插件已添加到企业', 'plugin_exists')
    }
    let installed: InstalledEnterprisePlugin
    try {
      installed = await installer.install(requested.spec)
    } catch (error) {
      throw new HttpError(502, error instanceof Error ? error.message : '插件安装失败', 'plugin_install_failed')
    }
    try {
      const created = await this.dependencies.store.mutate((draft) => {
        const actor = requirePermissionInDraft(draft, state.user.id, ENTERPRISE_PLUGIN_WRITE_PERMISSION)
        if (draft.plugins.some(plugin => plugin.scope === 'enterprise' && plugin.packageName === installed.packageName)) {
          throw new HttpError(409, '该插件已添加到企业', 'plugin_exists')
        }
        const now = new Date().toISOString()
        const plugin: PluginRecord = {
          id: recordId(),
          scope: 'enterprise',
          packageName: installed.packageName,
          spec: installed.spec,
          ...(installed.version === undefined ? {} : { version: installed.version }),
          description: installed.description,
          enabled: true,
          createdAt: now,
          updatedAt: now,
        }
        draft.plugins.push(plugin)
        appendAudit(draft, actor, 'plugin.enterprise.create', 'plugin', plugin.id, `添加企业插件 ${plugin.packageName}`, clientIp(request))
        return pluginsView(draft, state.permissions.includes(BUILTIN_PLUGIN_WRITE_PERMISSION), true)
      })
      await this.tenantsPluginPolicyChanged()
      sendJson(response, 201, created)
    } catch (error) {
      try { await installer.remove(installed.packageName) } catch (cleanupError) {
        this.dependencies.logger.warn(cleanupError instanceof Error ? cleanupError : new Error(String(cleanupError)))
      }
      throw error
    }
  }

  private async createBuiltinPlugin(
    request: IncomingMessage,
    response: ServerResponse,
    state: EnterpriseRequestSession,
  ): Promise<void> {
    if (!sameOriginMutation(request)) throw new HttpError(403, '请求来源校验失败', 'invalid_origin')
    assertBuiltinPluginManager(state.user)
    const body = bodyRecord(await readJson(request))
    const packageName = textField(body.packageName, '内置插件', 300)
    const definition = BUILTIN_PLUGINS.find(plugin => plugin.packageName === packageName)
    if (definition === undefined) throw new HttpError(400, '该插件不是内置插件', 'invalid_builtin_plugin')
    const updated = await this.dependencies.store.mutate((draft) => {
      const actor = requirePermissionInDraft(draft, state.user.id, BUILTIN_PLUGIN_WRITE_PERMISSION)
      assertBuiltinPluginManager(actor)
      const existing = draft.plugins.find(plugin => plugin.scope === 'builtin' && plugin.packageName === packageName)
      if (existing?.enabled === true) throw new HttpError(409, '该内置插件已添加', 'plugin_exists')
      const now = new Date().toISOString()
      if (existing === undefined) {
        draft.plugins.push({
          id: builtinPluginId(packageName),
          scope: 'builtin',
          packageName,
          spec: packageName,
          description: definition.description,
          enabled: true,
          createdAt: now,
          updatedAt: now,
        })
      } else {
        existing.enabled = true
        existing.updatedAt = now
      }
      appendAudit(draft, actor, 'plugin.builtin.create', 'plugin', builtinPluginId(packageName), `添加内置插件 ${packageName}`, clientIp(request))
      return pluginsView(
        draft,
        state.permissions.includes(BUILTIN_PLUGIN_WRITE_PERMISSION),
        state.permissions.includes(ENTERPRISE_PLUGIN_WRITE_PERMISSION),
      )
    })
    await this.tenantsPluginPolicyChanged()
    sendJson(response, 201, updated)
  }

  private async updatePlugin(
    request: IncomingMessage,
    response: ServerResponse,
    state: EnterpriseRequestSession,
    pluginId: string,
  ): Promise<void> {
    if (!sameOriginMutation(request)) throw new HttpError(403, '请求来源校验失败', 'invalid_origin')
    const body = bodyRecord(await readJson(request))
    const enabled = booleanField(body.enabled, '启用状态')
    const updated = await this.dependencies.store.mutate((draft) => {
      let plugin = draft.plugins.find(candidate => candidate.id === pluginId)
      let permission = ENTERPRISE_PLUGIN_WRITE_PERMISSION
      if (plugin?.scope === 'builtin') permission = BUILTIN_PLUGIN_WRITE_PERMISSION
      if (plugin === undefined && pluginId.startsWith('builtin:')) {
        const definition = BUILTIN_PLUGINS.find(candidate => builtinPluginId(candidate.packageName) === pluginId)
        if (definition === undefined) throw new HttpError(404, '插件不存在', 'not_found')
        const now = new Date().toISOString()
        plugin = {
          id: pluginId,
          scope: 'builtin',
          packageName: definition.packageName,
          spec: definition.packageName,
          description: definition.description,
          enabled: false,
          createdAt: now,
          updatedAt: now,
        }
        draft.plugins.push(plugin)
        permission = BUILTIN_PLUGIN_WRITE_PERMISSION
      }
      if (plugin === undefined) throw new HttpError(404, '插件不存在', 'not_found')
      const actor = requirePermissionInDraft(draft, state.user.id, permission)
      plugin.enabled = enabled
      plugin.updatedAt = new Date().toISOString()
      appendAudit(draft, actor, 'plugin.update', 'plugin', plugin.id, `${enabled ? '启用' : '停用'}插件 ${plugin.packageName}`, clientIp(request))
      return pluginsView(
        draft,
        state.permissions.includes(BUILTIN_PLUGIN_WRITE_PERMISSION),
        state.permissions.includes(ENTERPRISE_PLUGIN_WRITE_PERMISSION),
      )
    })
    await this.tenantsPluginPolicyChanged()
    sendJson(response, 200, updated)
  }

  private async deletePlugin(
    request: IncomingMessage,
    response: ServerResponse,
    state: EnterpriseRequestSession,
    pluginId: string,
  ): Promise<void> {
    if (!sameOriginMutation(request)) throw new HttpError(403, '请求来源校验失败', 'invalid_origin')
    const plugin = this.dependencies.store.snapshot().plugins.find(candidate => candidate.id === pluginId)
    if (plugin === undefined) throw new HttpError(404, '插件不存在', 'not_found')
    if (plugin.scope !== 'enterprise') throw new HttpError(409, '内置插件不能删除', 'builtin_plugin')
    if (!state.permissions.includes(ENTERPRISE_PLUGIN_WRITE_PERMISSION)) {
      throw new HttpError(403, '当前角色没有执行此操作的权限', 'forbidden')
    }
    try {
      await this.pluginInstaller().remove(plugin.packageName)
    } catch (error) {
      throw new HttpError(502, error instanceof Error ? error.message : '插件移除失败', 'plugin_remove_failed')
    }
    const updated = await this.dependencies.store.mutate((draft) => {
      const actor = requirePermissionInDraft(draft, state.user.id, ENTERPRISE_PLUGIN_WRITE_PERMISSION)
      const index = draft.plugins.findIndex(candidate => candidate.id === pluginId)
      if (index === -1) throw new HttpError(404, '插件不存在', 'not_found')
      const [removed] = draft.plugins.splice(index, 1)
      if (removed === undefined) throw new HttpError(404, '插件不存在', 'not_found')
      appendAudit(draft, actor, 'plugin.enterprise.delete', 'plugin', removed.id, `移除企业插件 ${removed.packageName}`, clientIp(request))
      return pluginsView(draft, state.permissions.includes(BUILTIN_PLUGIN_WRITE_PERMISSION), true)
    })
    await this.tenantsPluginPolicyChanged()
    sendJson(response, 200, updated)
  }

  private validatedPermissions(value: unknown): string[] {
    const permissions = stringArrayField(value, '权限', PERMISSIONS.length)
    const known = new Set<string>(PERMISSIONS)
    const invalid = permissions.find(permission => !known.has(permission))
    if (invalid !== undefined) throw new HttpError(400, `未知权限 ${invalid}`, 'invalid_permission')
    return permissions
  }

  private async createPlan(request: IncomingMessage, response: ServerResponse, state: EnterpriseRequestSession): Promise<void> {
    if (!sameOriginMutation(request)) throw new HttpError(403, '请求来源校验失败', 'invalid_origin')
    const body = bodyRecord(await readJson(request))
    const name = textField(body.name, '套餐名称', 120)
    const code = textField(body.code, '套餐编码', 80).toLowerCase()
    const created = await this.dependencies.store.mutate((draft) => {
      const actor = requirePermissionInDraft(draft, state.user.id, 'plans.write')
      if (draft.plans.some(plan => plan.code === code || plan.name === name)) throw new HttpError(409, '套餐名称或编码已存在', 'plan_exists')
      const plan: PlanRecord = {
        id: recordId(),
        name,
        code,
        monthlyPriceCents: integerField(body.monthlyPriceCents, '月付价格', 0, 100_000_000),
        annualPriceCents: integerField(body.annualPriceCents, '年付价格', 0, 1_000_000_000),
        seatLimit: integerField(body.seatLimit, '席位数', 1, 100_000),
        monthlyCredits: integerField(body.monthlyCredits, '月度额度', 0, Number.MAX_SAFE_INTEGER),
        features: stringArrayField(body.features, '套餐特性', 30),
        status: 'active',
        createdAt: new Date().toISOString(),
      }
      draft.plans.push(plan)
      appendAudit(draft, actor, 'plan.create', 'plan', plan.id, `创建套餐 ${plan.name}`, clientIp(request))
      return planViews(draft).find(view => view.id === plan.id)
    })
    sendJson(response, 201, created)
  }

  private async updatePlan(
    request: IncomingMessage,
    response: ServerResponse,
    state: EnterpriseRequestSession,
    planId: string,
  ): Promise<void> {
    if (!sameOriginMutation(request)) throw new HttpError(403, '请求来源校验失败', 'invalid_origin')
    const body = bodyRecord(await readJson(request))
    const updated = await this.dependencies.store.mutate((draft) => {
      const actor = requirePermissionInDraft(draft, state.user.id, 'plans.write')
      const plan = draft.plans.find(candidate => candidate.id === planId)
      if (plan === undefined) throw new HttpError(404, '套餐不存在', 'not_found')
      if (hasOwn(body, 'name')) {
        const name = textField(body.name, '套餐名称', 120)
        if (draft.plans.some(candidate => candidate.id !== plan.id && candidate.name === name)) throw new HttpError(409, '套餐名称已存在', 'plan_exists')
        plan.name = name
      }
      if (hasOwn(body, 'code')) {
        const code = textField(body.code, '套餐编码', 80).toLowerCase()
        if (draft.plans.some(candidate => candidate.id !== plan.id && candidate.code === code)) throw new HttpError(409, '套餐编码已存在', 'plan_exists')
        plan.code = code
      }
      if (hasOwn(body, 'monthlyPriceCents')) plan.monthlyPriceCents = integerField(body.monthlyPriceCents, '月付价格', 0, 100_000_000)
      if (hasOwn(body, 'annualPriceCents')) plan.annualPriceCents = integerField(body.annualPriceCents, '年付价格', 0, 1_000_000_000)
      if (hasOwn(body, 'seatLimit')) plan.seatLimit = integerField(body.seatLimit, '席位数', 1, 100_000)
      if (hasOwn(body, 'monthlyCredits')) plan.monthlyCredits = integerField(body.monthlyCredits, '月度额度', 0, Number.MAX_SAFE_INTEGER)
      if (hasOwn(body, 'features')) plan.features = stringArrayField(body.features, '套餐特性', 30)
      if (hasOwn(body, 'status')) plan.status = optionalStatus(body.status, ['active', 'archived'] as const, '状态') ?? plan.status
      appendAudit(draft, actor, 'plan.update', 'plan', plan.id, `更新套餐 ${plan.name}`, clientIp(request))
      return planViews(draft).find(view => view.id === plan.id)
    })
    sendJson(response, 200, updated)
  }

  private async deletePlan(
    request: IncomingMessage,
    response: ServerResponse,
    state: EnterpriseRequestSession,
    planId: string,
  ): Promise<void> {
    if (!sameOriginMutation(request)) throw new HttpError(403, '请求来源校验失败', 'invalid_origin')
    await this.dependencies.store.mutate((draft) => {
      const actor = requirePermissionInDraft(draft, state.user.id, 'plans.write')
      const plan = draft.plans.find(candidate => candidate.id === planId)
      if (plan === undefined) throw new HttpError(404, '套餐不存在', 'not_found')
      if (draft.teams.some(team => team.planId === plan.id)) throw new HttpError(409, '套餐仍有团队使用', 'plan_in_use')
      if (draft.settings.defaultPlanId === plan.id) throw new HttpError(409, '默认套餐不能删除', 'default_plan')
      draft.plans = draft.plans.filter(candidate => candidate.id !== plan.id)
      appendAudit(draft, actor, 'plan.delete', 'plan', plan.id, `删除套餐 ${plan.name}`, clientIp(request))
    })
    sendJson(response, 200, { ok: true })
  }

  private async createOrder(request: IncomingMessage, response: ServerResponse, state: EnterpriseRequestSession): Promise<void> {
    if (!sameOriginMutation(request)) throw new HttpError(403, '请求来源校验失败', 'invalid_origin')
    const body = bodyRecord(await readJson(request))
    const teamId = textField(body.teamId, '团队', 120)
    const planId = textField(body.planId, '套餐', 120)
    const billingCycle = optionalStatus(body.billingCycle, ['monthly', 'annual'] as const, '计费周期') ?? 'monthly'
    const reference = optionalTextField(body.reference, '支付参考号', 200) ?? ''
    const created = await this.dependencies.store.mutate((draft) => {
      const actor = requirePermissionInDraft(draft, state.user.id, 'orders.write')
      if (!draft.teams.some(team => team.id === teamId)) throw new HttpError(400, '团队不存在', 'invalid_team')
      const plan = draft.plans.find(candidate => candidate.id === planId)
      if (plan === undefined) throw new HttpError(400, '套餐不存在', 'invalid_plan')
      const now = new Date()
      const order: OrderRecord = {
        id: recordId(),
        number: `ORD-${now.toISOString().slice(0, 10).replaceAll('-', '')}-${recordId().slice(0, 6).toUpperCase()}`,
        teamId,
        planId,
        amountCents: billingCycle === 'annual' ? plan.annualPriceCents : plan.monthlyPriceCents,
        billingCycle,
        status: 'pending',
        reference,
        createdAt: now.toISOString(),
      }
      draft.orders.push(order)
      appendAudit(draft, actor, 'order.create', 'order', order.id, `创建订单 ${order.number}`, clientIp(request))
      return orderViews(draft).find(view => view.id === order.id)
    })
    sendJson(response, 201, created)
  }

  private billingOverview(state: EnterpriseRequestSession): BillingOverview {
    const data = this.dependencies.store.snapshot()
    const team = state.user.teamId === undefined
      ? undefined
      : data.teams.find(candidate => candidate.id === state.user.teamId)
    if (team === undefined) throw new HttpError(403, '当前账号尚未分配团队，请联系管理员', 'tenant_unassigned')
    const plan = planViews(data).find(candidate => candidate.id === team.planId)
    const now = new Date()
    const startsAt = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
    const endsAt = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1))
    const report = this.dependencies.store.usageReport({
      teamId: team.id,
      from: startsAt.getTime(),
      to: endsAt.getTime() - 1,
      limit: 1,
    })
    const userReport = this.dependencies.store.usageReport({
      teamId: team.id,
      userId: state.user.id,
      from: startsAt.getTime(),
      to: endsAt.getTime() - 1,
      limit: 1,
    })
    const totalTokens = plan?.monthlyCredits ?? 0
    const usedTokens = report.summary.inputTokens + report.summary.outputTokens
    return {
      team: {
        id: team.id,
        name: team.name,
        slug: team.slug,
        status: team.status,
        seatLimit: team.seatLimit,
        memberCount: data.users.filter(user => user.teamId === team.id && user.status === 'active').length,
      },
      ...(plan === undefined ? {} : { plan }),
      cycle: { startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString() },
      quota: {
        totalTokens,
        usedTokens,
        remainingTokens: Math.max(0, totalTokens - usedTokens),
        userTokens: userReport.summary.inputTokens + userReport.summary.outputTokens,
        requests: report.summary.requests,
        userRequests: userReport.summary.requests,
        costCents: report.summary.costCents,
        percentUsed: totalTokens === 0 ? 0 : Math.min(100, Math.round((usedTokens / totalTokens) * 1000) / 10),
      },
      plans: planViews(data).filter(candidate => candidate.status === 'active'),
      orders: orderViews(data).filter(order => order.teamId === team.id).slice(0, 6),
      canPurchase: state.permissions.includes(BILLING_PURCHASE_PERMISSION),
    }
  }

  private async createBillingOrder(
    request: IncomingMessage,
    response: ServerResponse,
    state: EnterpriseRequestSession,
  ): Promise<void> {
    if (!sameOriginMutation(request)) throw new HttpError(403, '请求来源校验失败', 'invalid_origin')
    const body = bodyRecord(await readJson(request))
    const planId = textField(body.planId, '套餐', 120)
    const billingCycle = optionalStatus(body.billingCycle, ['monthly', 'annual'] as const, '计费周期') ?? 'monthly'
    const reference = optionalTextField(body.reference, '支付参考号', 200) ?? ''
    const created = await this.dependencies.store.mutate((draft) => {
      const actor = requirePermissionInDraft(draft, state.user.id, BILLING_PURCHASE_PERMISSION)
      if (actor.teamId === undefined) throw new HttpError(403, '当前账号尚未分配团队，请联系管理员', 'tenant_unassigned')
      const team = draft.teams.find(candidate => candidate.id === actor.teamId)
      if (team === undefined) throw new HttpError(403, '当前团队不存在', 'tenant_unassigned')
      if (team.status !== 'active') throw new HttpError(409, '当前团队已停用', 'tenant_suspended')
      const plan = draft.plans.find(candidate => candidate.id === planId && candidate.status === 'active')
      if (plan === undefined) throw new HttpError(400, '套餐不存在或已下架', 'invalid_plan')
      if (draft.orders.some(order => order.teamId === team.id && order.status === 'pending')) {
        throw new HttpError(409, '当前团队已有待确认订单', 'order_pending')
      }
      const now = new Date()
      const order: OrderRecord = {
        id: recordId(),
        number: `ORD-${now.toISOString().slice(0, 10).replaceAll('-', '')}-${recordId().slice(0, 6).toUpperCase()}`,
        teamId: team.id,
        planId: plan.id,
        amountCents: billingCycle === 'annual' ? plan.annualPriceCents : plan.monthlyPriceCents,
        billingCycle,
        status: 'pending',
        reference,
        createdAt: now.toISOString(),
      }
      draft.orders.push(order)
      appendAudit(draft, actor, 'order.request', 'order', order.id, `提交套餐订单 ${order.number}`, clientIp(request), {
        teamId: team.id,
        planId: plan.id,
        billingCycle,
      })
      return orderViews(draft).find(view => view.id === order.id)
    })
    sendJson(response, 201, created)
  }

  private async recordMeteredUsage(
    request: IncomingMessage,
    response: ServerResponse,
    state: EnterpriseRequestSession,
  ): Promise<void> {
    if (!sameOriginMutation(request)) throw new HttpError(403, '请求来源校验失败', 'invalid_origin')
    const body = bodyRecord(await readJson(request))
    const sessionId = textField(body.sessionId, '会话标识', 200)
    const turn = integerField(body.turn, '轮次', 0, Number.MAX_SAFE_INTEGER)
    const inputTokens = integerField(body.inputTokens ?? 0, '输入 Token', 0, Number.MAX_SAFE_INTEGER)
    const outputTokens = integerField(body.outputTokens ?? 0, '输出 Token', 0, Number.MAX_SAFE_INTEGER)
    if (inputTokens + outputTokens === 0) {
      sendJson(response, 200, { recorded: false })
      return
    }
    const data = this.dependencies.store.snapshot()
    const team = state.user.teamId === undefined
      ? undefined
      : data.teams.find(candidate => candidate.id === state.user.teamId)
    if (team === undefined || team.status !== 'active') {
      throw new HttpError(403, '当前团队不可用', 'tenant_unavailable')
    }
    const modelName = optionalTextField(body.model, '模型', 200)
    const model = modelName === undefined
      ? undefined
      : data.models.find(candidate => candidate.name === modelName || candidate.displayName === modelName)
    const modelId = model?.id ?? 'model-unattributed'
    const costCents = model === undefined
      ? 0
      : Math.ceil((inputTokens * model.inputPricePerMillionCents + outputTokens * model.outputPricePerMillionCents) / 1_000_000)
    const recorded = await this.dependencies.store.recordMeteredUsage({
      id: recordId(),
      externalId: `turn:${sessionId}:${String(turn)}`,
      teamId: team.id,
      userId: state.user.id,
      modelId,
      ...(model === undefined ? {} : { channelId: model.channelId }),
      requests: 1,
      inputTokens,
      outputTokens,
      costCents,
      recordedAt: new Date().toISOString(),
    })
    sendJson(response, recorded ? 201 : 200, { recorded })
  }

  private async reviewOrder(
    request: IncomingMessage,
    response: ServerResponse,
    state: EnterpriseRequestSession,
    orderId: string,
    action: 'approve' | 'reject',
  ): Promise<void> {
    if (!sameOriginMutation(request)) throw new HttpError(403, '请求来源校验失败', 'invalid_origin')
    const updated = await this.dependencies.store.mutate((draft) => {
      const actor = requirePermissionInDraft(draft, state.user.id, 'orders.write')
      const order = draft.orders.find(candidate => candidate.id === orderId)
      if (order === undefined) throw new HttpError(404, '订单不存在', 'not_found')
      if (order.status !== 'pending') throw new HttpError(409, '订单已经处理', 'order_reviewed')
      const plan = draft.plans.find(candidate => candidate.id === order.planId)
      if (plan === undefined) throw new HttpError(409, '订单关联套餐已不存在', 'invalid_plan')
      order.status = action === 'approve' ? 'paid' : 'rejected'
      order.reviewedAt = new Date().toISOString()
      order.reviewedBy = actor.email
      if (action === 'approve') {
        const team = draft.teams.find(candidate => candidate.id === order.teamId)
        if (team === undefined) throw new HttpError(409, '订单关联团队已不存在', 'invalid_team')
        team.planId = plan.id
        team.status = 'active'
        team.seatLimit = Math.max(team.seatLimit, plan.seatLimit)
      }
      appendAudit(draft, actor, `order.${action}`, 'order', order.id, `${action === 'approve' ? '确认收款' : '拒绝'}订单 ${order.number}`, clientIp(request))
      return orderViews(draft).find(view => view.id === order.id)
    })
    sendJson(response, 200, updated)
  }

  private async createChannel(request: IncomingMessage, response: ServerResponse, state: EnterpriseRequestSession): Promise<void> {
    if (!sameOriginMutation(request)) throw new HttpError(403, '请求来源校验失败', 'invalid_origin')
    const body = bodyRecord(await readJson(request))
    const name = textField(body.name, '渠道名称', 120)
    const provider = textField(body.provider, '供应商', 80)
    const baseUrl = validateHttpUrl(textField(body.baseUrl, '渠道地址', 500))
    const wireProtocol = optionalStatus(body.wireProtocol,
      ['openai-chat', 'openai-responses', 'anthropic-messages'] as const, '线路协议') ?? 'openai-chat'
    const apiKey = optionalTextField(body.apiKey, 'API 密钥', 2000)
    const priority = integerField(body.priority ?? 10, '优先级', 0, 1000)
    const encryptedApiKey = apiKey === undefined ? '' : encryptCredential(apiKey, this.dependencies.store.credentialKey)
    const created = await this.dependencies.store.mutate((draft) => {
      const actor = requirePermissionInDraft(draft, state.user.id, 'channels.write')
      if (draft.channels.some(channel => channel.name === name)) throw new HttpError(409, '渠道名称已存在', 'channel_exists')
      const now = new Date().toISOString()
      const channel: ChannelRecord = {
        id: recordId(), name, provider, baseUrl, encryptedApiKey, wireProtocol, priority, status: 'active',
        createdAt: now, updatedAt: now,
      }
      draft.channels.push(channel)
      appendAudit(draft, actor, 'channel.create', 'channel', channel.id, `创建模型渠道 ${channel.name}`, clientIp(request))
      return channelViews(draft).find(view => view.id === channel.id)
    })
    sendJson(response, 201, created)
  }

  private async updateChannel(
    request: IncomingMessage,
    response: ServerResponse,
    state: EnterpriseRequestSession,
    channelId: string,
  ): Promise<void> {
    if (!sameOriginMutation(request)) throw new HttpError(403, '请求来源校验失败', 'invalid_origin')
    const body = bodyRecord(await readJson(request))
    const updated = await this.dependencies.store.mutate((draft) => {
      const actor = requirePermissionInDraft(draft, state.user.id, 'channels.write')
      const channel = draft.channels.find(candidate => candidate.id === channelId)
      if (channel === undefined) throw new HttpError(404, '渠道不存在', 'not_found')
      if (hasOwn(body, 'name')) {
        const name = textField(body.name, '渠道名称', 120)
        if (draft.channels.some(candidate => candidate.id !== channel.id && candidate.name === name)) throw new HttpError(409, '渠道名称已存在', 'channel_exists')
        channel.name = name
      }
      if (hasOwn(body, 'provider')) channel.provider = textField(body.provider, '供应商', 80)
      if (hasOwn(body, 'baseUrl')) channel.baseUrl = validateHttpUrl(textField(body.baseUrl, '渠道地址', 500))
      if (hasOwn(body, 'apiKey')) {
        const apiKey = optionalTextField(body.apiKey, 'API 密钥', 2000)
        channel.encryptedApiKey = apiKey === undefined ? '' : encryptCredential(apiKey, this.dependencies.store.credentialKey)
      }
      if (hasOwn(body, 'wireProtocol')) {
        channel.wireProtocol = optionalStatus(body.wireProtocol,
          ['openai-chat', 'openai-responses', 'anthropic-messages'] as const, '线路协议') ?? channel.wireProtocol
      }
      if (hasOwn(body, 'priority')) channel.priority = integerField(body.priority, '优先级', 0, 1000)
      if (hasOwn(body, 'status')) channel.status = optionalStatus(body.status, ['active', 'disabled'] as const, '状态') ?? channel.status
      channel.updatedAt = new Date().toISOString()
      appendAudit(draft, actor, 'channel.update', 'channel', channel.id, `更新模型渠道 ${channel.name}`, clientIp(request))
      return channelViews(draft).find(view => view.id === channel.id)
    })
    sendJson(response, 200, updated)
  }

  private async deleteChannel(
    request: IncomingMessage,
    response: ServerResponse,
    state: EnterpriseRequestSession,
    channelId: string,
  ): Promise<void> {
    if (!sameOriginMutation(request)) throw new HttpError(403, '请求来源校验失败', 'invalid_origin')
    await this.dependencies.store.mutate((draft) => {
      const actor = requirePermissionInDraft(draft, state.user.id, 'channels.write')
      const channel = draft.channels.find(candidate => candidate.id === channelId)
      if (channel === undefined) throw new HttpError(404, '渠道不存在', 'not_found')
      if (draft.models.some(model => model.channelId === channel.id)) throw new HttpError(409, '渠道仍有关联模型', 'channel_in_use')
      draft.channels = draft.channels.filter(candidate => candidate.id !== channel.id)
      appendAudit(draft, actor, 'channel.delete', 'channel', channel.id, `删除模型渠道 ${channel.name}`, clientIp(request))
    })
    sendJson(response, 200, { ok: true })
  }

  private async createModel(request: IncomingMessage, response: ServerResponse, state: EnterpriseRequestSession): Promise<void> {
    if (!sameOriginMutation(request)) throw new HttpError(403, '请求来源校验失败', 'invalid_origin')
    const body = bodyRecord(await readJson(request))
    const name = textField(body.name, '模型标识', 120)
    const displayName = textField(body.displayName, '展示名称', 120)
    const channelId = textField(body.channelId, '渠道', 120)
    const created = await this.dependencies.store.mutate((draft) => {
      const actor = requirePermissionInDraft(draft, state.user.id, 'models.write')
      if (!draft.channels.some(channel => channel.id === channelId)) throw new HttpError(400, '渠道不存在', 'invalid_channel')
      if (draft.models.some(model => model.name === name)) throw new HttpError(409, '模型标识已存在', 'model_exists')
      const model: ModelRecord = {
        id: recordId(),
        name,
        displayName,
        channelId,
        inputPricePerMillionCents: integerField(body.inputPricePerMillionCents ?? 0, '输入价格', 0, 100_000_000),
        outputPricePerMillionCents: integerField(body.outputPricePerMillionCents ?? 0, '输出价格', 0, 100_000_000),
        contextWindow: integerField(body.contextWindow ?? 128_000, '上下文窗口', 1, 100_000_000),
        capabilities: stringArrayField(body.capabilities, '能力标签', 30),
        status: 'active',
        createdAt: new Date().toISOString(),
      }
      draft.models.push(model)
      appendAudit(draft, actor, 'model.create', 'model', model.id, `创建模型 ${model.displayName}`, clientIp(request))
      return modelViews(draft).find(view => view.id === model.id)
    })
    sendJson(response, 201, created)
  }

  private async updateModel(
    request: IncomingMessage,
    response: ServerResponse,
    state: EnterpriseRequestSession,
    modelId: string,
  ): Promise<void> {
    if (!sameOriginMutation(request)) throw new HttpError(403, '请求来源校验失败', 'invalid_origin')
    const body = bodyRecord(await readJson(request))
    const updated = await this.dependencies.store.mutate((draft) => {
      const actor = requirePermissionInDraft(draft, state.user.id, 'models.write')
      const model = draft.models.find(candidate => candidate.id === modelId)
      if (model === undefined) throw new HttpError(404, '模型不存在', 'not_found')
      if (hasOwn(body, 'name')) {
        const name = textField(body.name, '模型标识', 120)
        if (draft.models.some(candidate => candidate.id !== model.id && candidate.name === name)) throw new HttpError(409, '模型标识已存在', 'model_exists')
        model.name = name
      }
      if (hasOwn(body, 'displayName')) model.displayName = textField(body.displayName, '展示名称', 120)
      if (hasOwn(body, 'channelId')) {
        const channelId = textField(body.channelId, '渠道', 120)
        if (!draft.channels.some(channel => channel.id === channelId)) throw new HttpError(400, '渠道不存在', 'invalid_channel')
        model.channelId = channelId
      }
      if (hasOwn(body, 'inputPricePerMillionCents')) model.inputPricePerMillionCents = integerField(body.inputPricePerMillionCents, '输入价格', 0, 100_000_000)
      if (hasOwn(body, 'outputPricePerMillionCents')) model.outputPricePerMillionCents = integerField(body.outputPricePerMillionCents, '输出价格', 0, 100_000_000)
      if (hasOwn(body, 'contextWindow')) model.contextWindow = integerField(body.contextWindow, '上下文窗口', 1, 100_000_000)
      if (hasOwn(body, 'capabilities')) model.capabilities = stringArrayField(body.capabilities, '能力标签', 30)
      if (hasOwn(body, 'status')) model.status = optionalStatus(body.status, ['active', 'disabled'] as const, '状态') ?? model.status
      appendAudit(draft, actor, 'model.update', 'model', model.id, `更新模型 ${model.displayName}`, clientIp(request))
      return modelViews(draft).find(view => view.id === model.id)
    })
    sendJson(response, 200, updated)
  }

  private async deleteModel(
    request: IncomingMessage,
    response: ServerResponse,
    state: EnterpriseRequestSession,
    modelId: string,
  ): Promise<void> {
    if (!sameOriginMutation(request)) throw new HttpError(403, '请求来源校验失败', 'invalid_origin')
    await this.dependencies.store.mutate((draft) => {
      const actor = requirePermissionInDraft(draft, state.user.id, 'models.write')
      const model = draft.models.find(candidate => candidate.id === modelId)
      if (model === undefined) throw new HttpError(404, '模型不存在', 'not_found')
      if (this.dependencies.store.hasUsageForModel(model.id)) throw new HttpError(409, '模型已有用量记录，建议停用而非删除', 'model_in_use')
      draft.models = draft.models.filter(candidate => candidate.id !== model.id)
      appendAudit(draft, actor, 'model.delete', 'model', model.id, `删除模型 ${model.displayName}`, clientIp(request))
    })
    sendJson(response, 200, { ok: true })
  }

  private listUsage(response: ServerResponse, url: URL): void {
    const from = parseTimestamp(url.searchParams.get('from'), '开始时间')
    const to = parseTimestamp(url.searchParams.get('to'), '结束时间')
    const teamId = url.searchParams.get('teamId') || undefined
    const modelId = url.searchParams.get('modelId') || undefined
    const requestedLimit = Number(url.searchParams.get('limit') ?? '200')
    const limit = Number.isSafeInteger(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 500) : 200
    const report = this.dependencies.store.usageReport({
      ...(from === undefined ? {} : { from }),
      ...(to === undefined ? {} : { to }),
      ...(teamId === undefined ? {} : { teamId }),
      ...(modelId === undefined ? {} : { modelId }),
      limit,
    })
    const catalog = this.dependencies.store.snapshot()
    sendJson(response, 200, {
      summary: report.summary,
      records: report.records.map(usage => usageView(catalog, usage)),
    })
  }

  private async recordUsage(request: IncomingMessage, response: ServerResponse, state: EnterpriseRequestSession): Promise<void> {
    if (!sameOriginMutation(request)) throw new HttpError(403, '请求来源校验失败', 'invalid_origin')
    const body = bodyRecord(await readJson(request))
    const teamId = textField(body.teamId, '团队', 120)
    const modelId = textField(body.modelId, '模型', 120)
    const userId = optionalTextField(body.userId, '用户', 120)
    const channelId = optionalTextField(body.channelId, '渠道', 120)
    const requests = integerField(body.requests ?? 1, '请求数', 0, Number.MAX_SAFE_INTEGER)
    const inputTokens = integerField(body.inputTokens ?? 0, '输入 Token', 0, Number.MAX_SAFE_INTEGER)
    const outputTokens = integerField(body.outputTokens ?? 0, '输出 Token', 0, Number.MAX_SAFE_INTEGER)
    const recordedAt = optionalTextField(body.recordedAt, '记录时间', 80) ?? new Date().toISOString()
    if (!Number.isFinite(Date.parse(recordedAt))) throw new HttpError(400, '记录时间格式不正确', 'invalid_field')
    const created = await this.dependencies.store.mutate((draft) => {
      const actor = requirePermissionInDraft(draft, state.user.id, 'usage.write')
      if (!draft.teams.some(team => team.id === teamId)) throw new HttpError(400, '团队不存在', 'invalid_team')
      const model = draft.models.find(candidate => candidate.id === modelId)
      if (model === undefined) throw new HttpError(400, '模型不存在', 'invalid_model')
      if (userId !== undefined && !draft.users.some(user => user.id === userId && user.teamId === teamId)) {
        throw new HttpError(400, '用户不属于该团队', 'invalid_user')
      }
      const resolvedChannelId = channelId ?? model.channelId
      if (!draft.channels.some(channel => channel.id === resolvedChannelId)) throw new HttpError(400, '渠道不存在', 'invalid_channel')
      const costCents = Math.ceil((
        inputTokens * model.inputPricePerMillionCents
        + outputTokens * model.outputPricePerMillionCents
      ) / 1_000_000)
      const usage: UsageRecord = {
        id: recordId(),
        teamId,
        ...(userId === undefined ? {} : { userId }),
        modelId,
        channelId: resolvedChannelId,
        requests,
        inputTokens,
        outputTokens,
        costCents,
        recordedAt: new Date(recordedAt).toISOString(),
      }
      draft.usage.push(usage)
      appendAudit(draft, actor, 'usage.record', 'usage', usage.id, `记录 ${model.displayName} 用量`, clientIp(request), { requests, inputTokens, outputTokens })
      return usageView(draft, usage)
    })
    sendJson(response, 201, created)
  }

  private listAudit(response: ServerResponse, url: URL): void {
    const from = parseTimestamp(url.searchParams.get('from'), '开始时间')
    const to = parseTimestamp(url.searchParams.get('to'), '结束时间')
    const action = url.searchParams.get('action') || undefined
    const actor = url.searchParams.get('actor') || undefined
    const requestedLimit = Number(url.searchParams.get('limit') ?? '200')
    const limit = Number.isSafeInteger(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 1000) : 200
    sendJson(response, 200, this.dependencies.store.auditRecords({
      ...(from === undefined ? {} : { from }),
      ...(to === undefined ? {} : { to }),
      ...(action === undefined ? {} : { action }),
      ...(actor === undefined ? {} : { actor }),
      limit,
    }))
  }

  private async updateSettings(request: IncomingMessage, response: ServerResponse, state: EnterpriseRequestSession): Promise<void> {
    if (!sameOriginMutation(request)) throw new HttpError(403, '请求来源校验失败', 'invalid_origin')
    const body = bodyRecord(await readJson(request))
    const updated = await this.dependencies.store.mutate((draft) => {
      const actor = requirePermissionInDraft(draft, state.user.id, 'settings.write')
      if (hasOwn(body, 'registrationEnabled')) {
        const registrationEnabled = booleanField(body.registrationEnabled, '开放注册')
        if (registrationEnabled && !this.verification.enabled) {
          throw new HttpError(409, '验证码服务尚未配置，无法开放自助注册', 'verification_unavailable')
        }
        draft.settings.registrationEnabled = registrationEnabled
      }
      if (hasOwn(body, 'defaultRoleId')) {
        const roleId = textField(body.defaultRoleId, '默认角色', 120)
        if (!draft.roles.some(role => role.id === roleId)) throw new HttpError(400, '默认角色不存在', 'invalid_role')
        draft.settings.defaultRoleId = roleId
      }
      if (hasOwn(body, 'defaultTeamId')) {
        const teamId = textField(body.defaultTeamId, '默认团队', 120)
        const team = draft.teams.find(candidate => candidate.id === teamId)
        if (team === undefined || team.status !== 'active') throw new HttpError(400, '默认团队不存在或已停用', 'invalid_team')
        draft.settings.defaultTeamId = teamId
      }
      if (hasOwn(body, 'defaultPlanId')) {
        const planId = textField(body.defaultPlanId, '默认套餐', 120)
        if (!draft.plans.some(plan => plan.id === planId)) throw new HttpError(400, '默认套餐不存在', 'invalid_plan')
        draft.settings.defaultPlanId = planId
      }
      if (hasOwn(body, 'sessionMaxAgeDays')) draft.settings.sessionMaxAgeDays = integerField(body.sessionMaxAgeDays, '会话有效期', 1, 90)
      if (hasOwn(body, 'supportEmail')) {
        const supportEmail = normalizeEmail(textField(body.supportEmail, '支持邮箱', 320))
        if (!isEmail(supportEmail)) throw new HttpError(400, '支持邮箱格式不正确', 'invalid_field')
        draft.settings.supportEmail = supportEmail
      }
      if (hasOwn(body, 'brandName')) draft.settings.brandName = textField(body.brandName, '品牌名称', 120)
      appendAudit(draft, actor, 'settings.update', 'settings', undefined, '更新企业工作台设置', clientIp(request))
      return { ...draft.settings }
    })
    sendJson(response, 200, updated)
  }
}

const SECURITY_HEADERS_FOR_REDIRECT = {
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
}
