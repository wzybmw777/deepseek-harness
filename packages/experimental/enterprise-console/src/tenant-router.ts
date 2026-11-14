/** Authenticated reverse proxy from one team URL to that team's DSH process. */

import { request as httpRequest, type IncomingMessage, type OutgoingHttpHeaders, type ServerResponse } from 'node:http'
import { connect as netConnect } from 'node:net'
import type { Duplex } from 'node:stream'
import type { WebServer } from '@deepseek-ai/dsh-host-webserver'
import type { EnterpriseRequestSession } from './api.ts'
import { requestAuthority, requestProtocol, sendError, sendEmpty, sendJson } from './http.ts'
import { resolvePublicPathPrefix } from './public-path.ts'
import { ENTERPRISE_BRAND_NAME } from './session-guard.ts'
import { parseTenantRoute, tenantHarnessPath, type TenantRoute } from './tenant-paths.ts'
import type { TenantRuntimeLease, TenantRuntimeStatus } from './tenant-runtime.ts'
import { redactTenantRuntimeText } from './tenant-runtime.ts'
import type { EnterpriseStore } from './store.ts'
import type { TeamRecord } from './types.ts'

const HOP_BY_HOP = new Set([
  'connection', 'keep-alive', 'proxy-connection', 'transfer-encoding', 'upgrade', 'te', 'trailer',
])
const MAX_INJECTED_HTML_BYTES = 8 * 1024 * 1024
const PLUGIN_READS = new Set([
  'listBundles', 'listPlugins', 'listVersionExemptions', 'readBundleDetail',
])
const MAX_REJECTED_RPC_BYTES = 64 * 1024

interface TenantGatewayDependencies {
  /** Public proxy prefix; omitted preserves origin-root URLs. */
  readonly publicPathPrefix?: string
  readonly store: Pick<EnterpriseStore, 'snapshot'>
  readonly runtime: {
    ensureTenant(team: TeamRecord): Promise<TenantRuntimeLease>
    status(team: TeamRecord): TenantRuntimeStatus
  }
  readonly authenticate: (request: IncomingMessage) => EnterpriseRequestSession | undefined
  readonly webServer: Pick<WebServer, 'registerUpgrade'>
  readonly logger: { warn: (error: Error) => void }
}

interface Access {
  readonly team: TeamRecord
  readonly lease: TenantRuntimeLease
}

interface AccessError {
  readonly error: number
  readonly message: string
  readonly code: string
}

function firstHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

function internalOrigin(port: number): string {
  return `http://127.0.0.1:${String(port)}`
}

function forwardingHeaders(
  request: IncomingMessage, url: URL, route: TenantRoute, port: number, cookie: string, publicPathPrefix: string,
): OutgoingHttpHeaders {
  const headers: OutgoingHttpHeaders = {}
  for (const [name, value] of Object.entries(request.headers)) {
    if (value === undefined || HOP_BY_HOP.has(name) || name === 'host' || name === 'cookie' || name === 'origin'
      || name === 'x-forwarded-host' || name === 'x-forwarded-proto' || name === 'x-forwarded-prefix') continue
    headers[name] = value
  }
  headers.host = `127.0.0.1:${String(port)}`
  headers.cookie = cookie
  if (request.headers.origin !== undefined) headers.origin = internalOrigin(port)
  headers['x-forwarded-host'] = request.headers.host ?? requestAuthority(request) ?? ''
  headers['x-forwarded-proto'] = requestProtocol(request)
  headers['x-forwarded-prefix'] = `${publicPathPrefix}${route.mount.slice(0, -1)}`
  headers['x-forwarded-uri'] = `${publicPathPrefix}${url.pathname}${url.search}`
  return headers
}

function responseHeaders(source: IncomingMessage['headers'], route: TenantRoute, publicPathPrefix: string): OutgoingHttpHeaders {
  const headers: OutgoingHttpHeaders = {}
  for (const [name, value] of Object.entries(source)) {
    if (value === undefined || HOP_BY_HOP.has(name) || name === 'set-cookie') continue
    headers[name] = value
  }
  const location = headers.location
  if (typeof location === 'string' && location.startsWith('/') && !location.startsWith('//')
    && !location.startsWith('/t/') && !location.startsWith('/enterprise/')) {
    headers.location = `${route.mount.slice(0, -1)}${location}`
  }
  if (typeof headers.location === 'string' && headers.location.startsWith('/') && !headers.location.startsWith('//')) {
    headers.location = `${publicPathPrefix}${headers.location}`
  }
  headers['x-content-type-options'] = 'nosniff'
  headers['referrer-policy'] = 'no-referrer'
  return headers
}

function injectSessionGuard(html: string, publicPathPrefix: string): string {
  const tag = `<script src="${publicPathPrefix}/enterprise/session-guard.js" data-dsh-tenant-guard=""></script>`
  let guarded = html.replace(/<title\b[^>]*>[\s\S]*?<\/title>/iu, `<title>${ENTERPRISE_BRAND_NAME}</title>`)
  if (!/<html\b[^>]*\bdata-dsh-enterprise(?:\s*=|\s|>)/iu.test(guarded)) {
    guarded = guarded.replace(/<html(?=[\s>])/iu, match => `${match} data-dsh-enterprise=""`)
  }
  if (guarded.includes('/enterprise/session-guard.js')) return guarded
  const body = guarded.lastIndexOf('</body>')
  return body === -1 ? `${guarded}${tag}` : `${guarded.slice(0, body)}${tag}${guarded.slice(body)}`
}

function loginRedirect(response: ServerResponse, url: URL, publicPathPrefix: string): void {
  const next = `${publicPathPrefix}${url.pathname}${url.search}`
  response.writeHead(302, {
    'cache-control': 'no-store',
    location: `${publicPathPrefix}/enterprise/login?next=${encodeURIComponent(next)}`,
    'referrer-policy': 'no-referrer',
  })
  response.end()
}

function rejectUpgrade(socket: Duplex, status: number, message: string): void {
  const body = `${message}\n`
  socket.end(`HTTP/1.1 ${String(status)} ${status === 401 ? 'Unauthorized' : status === 403 ? 'Forbidden' : 'Service Unavailable'}\r\ncontent-type: text/plain; charset=utf-8\r\ncontent-length: ${String(Buffer.byteLength(body))}\r\nconnection: close\r\n\r\n${body}`)
}

function rejectedPluginCall(route: TenantRoute): boolean {
  const prefix = '/api/pluginManager/'
  if (!route.upstreamPath.startsWith(prefix)) return false
  let method: string
  try {
    method = decodeURIComponent(route.upstreamPath.slice(prefix.length))
  } catch {
    return true
  }
  return !PLUGIN_READS.has(method)
}

async function rejectPluginChange(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const chunks: Buffer[] = []
  let bytes = 0
  try {
    for await (const chunk of request) {
      const buffer = chunk as Buffer
      if (bytes + buffer.byteLength > MAX_REJECTED_RPC_BYTES) break
      bytes += buffer.byteLength
      chunks.push(buffer)
    }
  } catch {
    // A disconnected client has no response to receive.
  }
  let rpcId = 'enterprise-plugin-policy'
  try {
    const envelope: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    if (typeof envelope === 'object' && envelope !== null && 'rpcId' in envelope && typeof envelope.rpcId === 'string') {
      rpcId = envelope.rpcId
    }
  } catch {
    // The rejection still names a stable RPC id when the request body is unavailable.
  }
  sendJson(response, 200, {
    type: 'server-response',
    rpcId,
    result: {
      ok: false,
      error: {
        code: 'enterprise/plugin-admin-only',
        message: '插件由企业控制台统一管理，请让企业所有者或管理员调整。',
        details: {},
      },
    },
  })
}

function sanitizedHeader(value: string): string {
  return value.replace(/[\r\n]/gu, '')
}

/** Owns tenant URL authorization, HTTP proxying, and WebSocket bridge routes. */
export class TenantGateway {
  private readonly upgradeRoutes = new Map<string, { slug: string; dispose: () => void }>()
  private closed = false

  private readonly publicPathPrefix: string

  constructor(private readonly dependencies: TenantGatewayDependencies) {
    this.publicPathPrefix = resolvePublicPathPrefix(dependencies.publicPathPrefix ?? '')
  }

  /**
   * Start the team process and register its WebSocket route.
   * @param team - active team that owns the public mount.
   * @returns after the process is ready.
   */
  async prepare(team: TeamRecord): Promise<void> {
    if (this.closed) throw new Error('tenant gateway: gateway is closed')
    this.ensureUpgradeRoute(team)
    await this.dependencies.runtime.ensureTenant(team)
  }

  /**
   * Report a team's container readiness without starting it.
   * @param team - active team that owns the public mount.
   * @returns the runtime readiness snapshot.
   */
  status(team: TeamRecord): TenantRuntimeStatus {
    return this.dependencies.runtime.status(team)
  }

  /**
   * Dispatch one browser-facing request below `/t`.
   * @param request - incoming HTTP request.
   * @param response - response owned by this gateway.
   * @param url - parsed request URL.
   */
  async handleHttp(request: IncomingMessage, response: ServerResponse, url: URL): Promise<void> {
    const route = parseTenantRoute(url.pathname)
    if (route === undefined) {
      sendError(response, 404, '工作台入口不存在', 'tenant_not_found')
      return
    }
    if (url.pathname === route.mount.slice(0, -1)) {
      response.writeHead(308, { location: `${this.publicPathPrefix}${route.mount}${url.search}`, 'cache-control': 'no-store' })
      response.end()
      return
    }
    const access = await this.resolveAccess(request, route)
    if (access === null) {
      if (request.method === 'GET' || request.method === 'HEAD') loginRedirect(response, url, this.publicPathPrefix)
      else sendEmpty(response, 401, { 'cache-control': 'no-store' })
      return
    }
    if ('error' in access) {
      sendError(response, access.error, access.message, access.code)
      return
    }
    const release = access.lease.begin()
    response.once('close', release)
    response.once('finish', release)
    if (rejectedPluginCall(route)) {
      await rejectPluginChange(request, response)
      return
    }
    this.proxyHttp(request, response, url, route, access.lease)
  }

  /**
   * Dispatch one authenticated WebSocket upgrade below a team mount.
   * @param request - incoming upgrade request.
   * @param socket - raw client socket.
   * @param head - already-read bytes following the request headers.
   */
  async handleUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer): Promise<void> {
    const url = new URL(request.url ?? '/', 'http://tenant.invalid')
    const route = parseTenantRoute(url.pathname)
    if (route === undefined) {
      rejectUpgrade(socket, 404, 'tenant not found')
      return
    }
    const access = await this.resolveAccess(request, route)
    if (access === null) {
      rejectUpgrade(socket, 401, 'enterprise authentication required')
      return
    }
    if ('error' in access) {
      rejectUpgrade(socket, access.error, access.message)
      return
    }
    const release = access.lease.begin()
    const upstream = netConnect(access.lease.port, '127.0.0.1')
    const revalidate = setInterval(() => {
      const session = this.dependencies.authenticate(request)
      if (session === undefined || this.accessError(session, route) !== undefined) close()
    }, 15_000)
    revalidate.unref()
    const close = (): void => {
      clearInterval(revalidate)
      release()
      socket.destroy()
      upstream.destroy()
    }
    socket.once('close', close)
    upstream.once('close', close)
    socket.once('error', close)
    upstream.once('error', close)
    upstream.once('connect', () => {
      const headers = forwardingHeaders(request, url, route, access.lease.port, access.lease.cookie, this.publicPathPrefix)
      upstream.write(`GET ${route.upstreamPath}${url.search} HTTP/1.1\r\n`)
      for (const [name, value] of Object.entries(headers)) {
        for (const item of Array.isArray(value) ? value : value === undefined ? [] : [String(value)]) {
          upstream.write(`${sanitizedHeader(name)}: ${sanitizedHeader(item)}\r\n`)
        }
      }
      upstream.write('connection: Upgrade\r\nupgrade: websocket\r\n\r\n')
      if (head.byteLength > 0) upstream.write(head)
      socket.pipe(upstream).pipe(socket)
    })
  }

  /** Dispose every registered upgrade route. */
  close(): void {
    if (this.closed) return
    this.closed = true
    for (const route of this.upgradeRoutes.values()) route.dispose()
    this.upgradeRoutes.clear()
  }

  private ensureUpgradeRoute(team: TeamRecord): void {
    const existing = this.upgradeRoutes.get(team.id)
    if (existing?.slug === team.slug) return
    existing?.dispose()
    const mount = tenantHarnessPath(team.slug)
    const path = `${mount.slice(0, -1)}/api/remote.mux`
    const dispose = this.dependencies.webServer.registerUpgrade({
      path,
      handler: (request, socket, head) => this.handleUpgrade(request, socket, head),
    })
    this.upgradeRoutes.set(team.id, { slug: team.slug, dispose })
  }

  private async resolveAccess(
    request: IncomingMessage,
    route: TenantRoute,
  ): Promise<Access | null | AccessError> {
    const session = this.dependencies.authenticate(request)
    if (session === undefined) return null
    const denied = this.accessError(session, route)
    if (denied !== undefined) return denied
    const team = this.teamFor(session, route)
    if (team === undefined) return { error: 404, message: '工作台入口不存在', code: 'tenant_not_found' }
    try {
      this.ensureUpgradeRoute(team)
      const lease = await this.dependencies.runtime.ensureTenant(team)
      return { team, lease }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.dependencies.logger.warn(new Error(`enterprise tenant ${team.id}: ${redactTenantRuntimeText(message)}`))
      return { error: 503, message: '团队工作台暂时不可用，请稍后重试', code: 'tenant_unavailable' }
    }
  }

  private accessError(session: EnterpriseRequestSession, route: TenantRoute): AccessError | undefined {
    if (!session.permissions.includes('workspace.use')) {
      return { error: 403, message: '当前角色无权使用 AI 工作台', code: 'forbidden' }
    }
    const team = this.dependencies.store.snapshot().teams.find(candidate => candidate.slug === route.slug)
    if (team === undefined) return { error: 404, message: '工作台入口不存在', code: 'tenant_not_found' }
    if (session.user.teamId !== team.id) {
      return { error: 403, message: '无权访问其他团队的工作台', code: 'tenant_forbidden' }
    }
    if (team.status !== 'active') return { error: 403, message: '团队已停用', code: 'tenant_suspended' }
    return undefined
  }

  private teamFor(session: EnterpriseRequestSession, route: TenantRoute): TeamRecord | undefined {
    const team = this.dependencies.store.snapshot().teams.find(candidate => candidate.slug === route.slug)
    return team !== undefined && session.user.teamId === team.id ? team : undefined
  }

  private proxyHttp(
    request: IncomingMessage,
    response: ServerResponse,
    url: URL,
    route: TenantRoute,
    lease: TenantRuntimeLease,
  ): void {
    const indexRequest = route.upstreamPath === '/' || route.upstreamPath === '/index.html'
    const headers = forwardingHeaders(request, url, route, lease.port, lease.cookie, this.publicPathPrefix)
    if (indexRequest) headers['accept-encoding'] = 'identity'
    const upstream = httpRequest({
      host: '127.0.0.1',
      port: lease.port,
      method: request.method,
      path: `${route.upstreamPath}${url.search}`,
      headers,
      agent: false,
    }, (result) => {
      const outgoing = responseHeaders(result.headers, route, this.publicPathPrefix)
      const contentType = firstHeader(result.headers['content-type'])?.toLowerCase() ?? ''
      const contentEncoding = firstHeader(result.headers['content-encoding'])?.toLowerCase()
      const html = contentType.startsWith('text/html') && (contentEncoding === undefined || contentEncoding === 'identity')
      if (!html || request.method === 'HEAD') {
        response.writeHead(result.statusCode ?? 502, outgoing)
        result.pipe(response)
        return
      }
      const chunks: Buffer[] = []
      let bytes = 0
      let overflow = false
      result.on('data', (chunk: Buffer) => {
        if (overflow) return
        bytes += chunk.byteLength
        if (bytes > MAX_INJECTED_HTML_BYTES) {
          overflow = true
          result.destroy()
          return
        }
        chunks.push(chunk)
      })
      result.once('end', () => {
        if (overflow) {
          if (!response.headersSent) sendError(response, 502, '工作台页面超过网关处理上限', 'tenant_page_too_large')
          else response.destroy()
          return
        }
        const body = Buffer.from(injectSessionGuard(Buffer.concat(chunks).toString('utf8'), this.publicPathPrefix), 'utf8')
        response.writeHead(result.statusCode ?? 200, {
          ...outgoing,
          'content-length': String(body.byteLength),
        })
        response.end(body)
      })
      result.once('error', (error) => {
        if (!response.headersSent) sendError(response, 502, '工作台响应失败', 'tenant_upstream_failed')
        else response.destroy()
        this.dependencies.logger.warn(new Error(`enterprise tenant ${route.slug}: ${redactTenantRuntimeText(error.message)}`))
      })
    })
    upstream.once('error', (error) => {
      if (!response.headersSent) sendError(response, 502, '工作台暂时不可用', 'tenant_upstream_failed')
      else response.destroy()
      this.dependencies.logger.warn(new Error(`enterprise tenant ${route.slug}: ${redactTenantRuntimeText(error.message)}`))
    })
    response.once('close', () => { upstream.destroy() })
    request.pipe(upstream)
  }
}
