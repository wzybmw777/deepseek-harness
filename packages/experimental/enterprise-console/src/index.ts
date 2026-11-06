/**
 * Enterprise SaaS shell for a DSH Web deployment: login, administration,
 * billing ledger, model-channel catalog, usage, audit, and an authenticated
 * gateway to one isolated DSH Web process per enterprise team.
 * @module @deepseek-ai/dsh-enterprise-console
 */

import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { extname, join, normalize, resolve, sep } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-web-app'
import z from '@deepseek-ai/schemastery'
import { EnterpriseApi } from './api.ts'
import { SharedEnterprisePluginInstaller } from './plugin-installer.ts'
import { tenantPluginPolicy } from './plugin-policy.ts'
import { isEmail, normalizeEmail } from './security.ts'
import { HARNESS_SESSION_GUARD_PATH, HARNESS_SESSION_GUARD_SCRIPT } from './session-guard.ts'
import { EnterpriseStore } from './store.ts'
import { TeamResources } from './team-resources.ts'
import { SECURITY_HEADERS, sendEmpty, sendError } from './http.ts'
import { createPlaywrightRuntimeFactory, RemoteBrowserPool } from './remote-browser.ts'
import { TENANT_ROOT } from './tenant-paths.ts'
import { TenantGateway } from './tenant-router.ts'
import { TenantRuntimeManager, type TenantRuntimeConfig } from './tenant-runtime.ts'
import { VerificationService, createWebhookVerificationDelivery } from './verification.ts'

/** Stable Cordis plugin name. */
export const name = 'enterprise-console'

/** Services required before the console can register its routes. */
export const inject = ['webServer', 'webApp', 'connection']

/** Enterprise console deployment settings. */
export interface Config {
  /** Built `apps/enterprise/dist` directory. */
  readonly distRoot: string
  /** Private directory holding users, teams, billing, usage, audit, and keys. */
  readonly dataDir: string
  /** First owner address; used only when the catalog is empty. */
  readonly bootstrapAdminEmail: string
  /** Initial product name; later changes live in the settings API. */
  readonly brandName: string
  /** Private directory containing one Harness home and workspace per team. */
  readonly tenantRoot: string
  /** Built `apps/cli/lib/bin.js` entry used for tenant processes. */
  readonly tenantDshEntry: string
  /** Repository build tree mounted read-only into each tenant container. */
  readonly tenantSourceRoot: string
  /** Harness home whose profile and credentials seed each new tenant. */
  readonly tenantTemplateHome: string
  /** Web profile every tenant process loads. */
  readonly tenantProfile: string
  /** Browser-facing origin for tenant links, for example `https://app.example.com`. */
  readonly tenantPublicOrigin?: string
  /** HTTPS gateway that delivers verification codes to email or SMS providers. */
  readonly verificationWebhookUrl?: string
  /** Bearer token sent to the verification delivery gateway. */
  readonly verificationWebhookToken?: string
  /** Rootless container image containing the tenant shell and network relay. */
  readonly tenantContainerImage: string
  /** Podman executable used to supervise tenant containers. */
  readonly tenantContainerPodman: string
  /** Hard memory ceiling for each tenant container in MiB. */
  readonly tenantContainerMemoryMb: number
  /** Hard PID ceiling for each tenant container. */
  readonly tenantContainerPids: number
  /** First loopback port available to a tenant process. */
  readonly tenantPortStart: number
  /** Last loopback port available to a tenant process. */
  readonly tenantPortEnd: number
  /** Maximum number of simultaneously running tenant processes. */
  readonly maxTenantProcesses: number
  /** Stop a tenant process after this many idle minutes. */
  readonly tenantIdleTimeoutMinutes: number
  /** Maximum time from tenant spawn to ready. */
  readonly tenantStartTimeoutMs: number
  /** Headful Chromium executable used by the remote Sidebar Browser. */
  readonly browserChromePath: string
  /** Xvfb executable that supplies the remote browser's private display. */
  readonly browserXvfbPath: string
  /** HTTP proxy used by every remote Chromium request, or direct networking. */
  readonly browserProxyUrl?: string
  /** Comma-separated proxy bypass list understood by Chromium. */
  readonly browserProxyBypass?: string
  /** Maximum Chromium pages across every team. */
  readonly browserMaxSessions: number
  /** Maximum Chromium pages owned by one team member. */
  readonly browserMaxSessionsPerUser: number
  /** Close an unattended Chromium page after this many idle minutes. */
  readonly browserIdleTimeoutMinutes: number
  /** Maximum document navigation wait for one Chromium page. */
  readonly browserNavigationTimeoutMs: number
}

export const Config: z<Config> = z.object({
  distRoot: z.string().required(),
  dataDir: z.string().required(),
  bootstrapAdminEmail: z.string().required(),
  brandName: z.string().required(),
  tenantRoot: z.string().required(),
  tenantDshEntry: z.string().required(),
  tenantSourceRoot: z.string().required(),
  tenantTemplateHome: z.string().required(),
  tenantProfile: z.string().required(),
  tenantPublicOrigin: z.string(),
  verificationWebhookUrl: z.string(),
  verificationWebhookToken: z.string(),
  tenantContainerImage: z.string().default('localhost/dsh-enterprise-tenant:local'),
  tenantContainerPodman: z.string().default('podman'),
  tenantContainerMemoryMb: z.natural().default(1024),
  tenantContainerPids: z.natural().default(512),
  tenantPortStart: z.natural().required(),
  tenantPortEnd: z.natural().required(),
  maxTenantProcesses: z.natural().required(),
  tenantIdleTimeoutMinutes: z.natural().required(),
  tenantStartTimeoutMs: z.natural().required(),
  browserChromePath: z.string().default('/opt/google/chrome/chrome'),
  browserXvfbPath: z.string().default('/usr/bin/Xvfb'),
  browserProxyUrl: z.string(),
  browserProxyBypass: z.string(),
  browserMaxSessions: z.natural().default(6),
  browserMaxSessionsPerUser: z.natural().default(2),
  browserIdleTimeoutMinutes: z.natural().default(10),
  browserNavigationTimeoutMs: z.natural().default(45_000),
})

const CONSOLE_ROOT = '/enterprise'
const API_ROOT = '/enterprise/api'
const HTML_MIME = 'text/html; charset=utf-8'

const MIME: Readonly<Record<string, string>> = {
  '.css': 'text/css; charset=utf-8',
  '.html': HTML_MIME,
  '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json',
  '.woff2': 'font/woff2',
}

function assertConfig(config: Config): void {
  if (config.distRoot.trim() === '') throw new Error('enterprise-console: distRoot must not be empty')
  if (config.dataDir.trim() === '') throw new Error('enterprise-console: dataDir must not be empty')
  if (!isEmail(normalizeEmail(config.bootstrapAdminEmail))) {
    throw new Error('enterprise-console: bootstrapAdminEmail must be a valid email address')
  }
  if (config.brandName.trim() === '') throw new Error('enterprise-console: brandName must not be empty')
  if (config.tenantRoot.trim() === '') throw new Error('enterprise-console: tenantRoot must not be empty')
  if (config.tenantDshEntry.trim() === '') throw new Error('enterprise-console: tenantDshEntry must not be empty')
  if (config.tenantSourceRoot.trim() === '') throw new Error('enterprise-console: tenantSourceRoot must not be empty')
  const sourceRoot = resolve(config.tenantSourceRoot)
  const entry = resolve(config.tenantDshEntry)
  if (entry !== sourceRoot && !entry.startsWith(sourceRoot + sep)) {
    throw new Error('enterprise-console: tenantDshEntry must be inside tenantSourceRoot')
  }
  if (config.tenantTemplateHome.trim() === '') throw new Error('enterprise-console: tenantTemplateHome must not be empty')
  if (!/^[A-Za-z0-9_-]+$/u.test(config.tenantProfile)) {
    throw new Error('enterprise-console: tenantProfile must be a single profile directory name')
  }
  if (!(config.tenantPortStart > 0 && config.tenantPortStart <= config.tenantPortEnd && config.tenantPortEnd <= 65_535)) {
    throw new Error('enterprise-console: tenantPortStart and tenantPortEnd must form a valid port range')
  }
  if (config.maxTenantProcesses < 1) throw new Error('enterprise-console: maxTenantProcesses must be positive')
  if (config.tenantIdleTimeoutMinutes < 1) throw new Error('enterprise-console: tenantIdleTimeoutMinutes must be positive')
  if (config.tenantStartTimeoutMs < 1) throw new Error('enterprise-console: tenantStartTimeoutMs must be positive')
  if (config.tenantContainerImage.trim() === '') throw new Error('enterprise-console: tenantContainerImage must not be empty')
  if (config.tenantContainerPodman.trim() === '') throw new Error('enterprise-console: tenantContainerPodman must not be empty')
  if (config.tenantContainerMemoryMb < 1) throw new Error('enterprise-console: tenantContainerMemoryMb must be positive')
  if (config.tenantContainerPids < 1) throw new Error('enterprise-console: tenantContainerPids must be positive')
  if (config.tenantPublicOrigin !== undefined) resolvePublicOrigin(config.tenantPublicOrigin)
}

function resolvePublicOrigin(value: string): string {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error('enterprise-console: tenantPublicOrigin must be an absolute HTTP(S) origin')
  }
  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username !== '' || url.password !== ''
    || url.search !== '' || url.hash !== '' || (url.pathname !== '' && url.pathname !== '/')) {
    throw new Error('enterprise-console: tenantPublicOrigin must contain only scheme, host, and port')
  }
  return url.origin
}

function tenantRuntimeConfig(ctx: Context, config: Config, pluginRoot: string): TenantRuntimeConfig {
  return {
    root: config.tenantRoot,
    publicOrigin: config.tenantPublicOrigin === undefined
      ? new URL(ctx.webApp.getAdvertisedUrl()).origin
      : resolvePublicOrigin(config.tenantPublicOrigin),
    dshEntry: config.tenantDshEntry,
    sourceRoot: config.tenantSourceRoot,
    templateHome: config.tenantTemplateHome,
    profile: config.tenantProfile,
    pluginRoot,
    portStart: config.tenantPortStart,
    portEnd: config.tenantPortEnd,
    maxProcesses: config.maxTenantProcesses,
    idleTimeoutMinutes: config.tenantIdleTimeoutMinutes,
    startTimeoutMs: config.tenantStartTimeoutMs,
    containerImage: config.tenantContainerImage,
    podman: config.tenantContainerPodman,
    containerMemoryMb: config.tenantContainerMemoryMb,
    containerPids: config.tenantContainerPids,
  }
}

function redirect(response: ServerResponse, location: string): void {
  response.writeHead(308, {
    ...SECURITY_HEADERS,
    'cache-control': 'no-store',
    location,
  })
  response.end()
}

function writeBytes(
  response: ServerResponse,
  method: string | undefined,
  status: number,
  body: Buffer,
  headers: Readonly<Record<string, string>>,
): void {
  response.writeHead(status, {
    ...SECURITY_HEADERS,
    'content-length': String(body.byteLength),
    ...headers,
  })
  if (method === 'HEAD') response.end()
  else response.end(body)
}

function unavailablePage(): Buffer {
  return Buffer.from(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>企业工作台尚未构建</title>
<style>body{font:14px/1.6 system-ui,sans-serif;max-width:640px;margin:12vh auto;padding:24px;color:#111}h1{font-size:24px}code{background:#f2f4f7;padding:2px 6px;border-radius:4px}</style>
<h1>企业工作台前端尚未构建</h1><p>请在部署目录运行 <code>pnpm --filter @deepseek-ai/dsh-enterprise-web build</code>，然后刷新此页面。</p></html>`, 'utf8')
}

function etagOf(body: Buffer): string {
  return `W/\"${createHash('sha1').update(body).digest('base64url')}\"`
}

/** Static and SPA route owner for `/enterprise`. */
class ConsoleAssets {
  private readonly distRoot: string
  private readonly indexFile: string

  constructor(distRoot: string) {
    this.distRoot = resolve(distRoot)
    this.indexFile = join(this.distRoot, 'index.html')
  }

  async serve(request: IncomingMessage, response: ServerResponse, url: URL): Promise<void> {
    const method = request.method ?? 'GET'
    if (method !== 'GET' && method !== 'HEAD') {
      sendError(response, 405, '只支持 GET 和 HEAD 请求', 'method_not_allowed')
      return
    }
    if (url.pathname === CONSOLE_ROOT) {
      redirect(response, `${CONSOLE_ROOT}/${url.search}`)
      return
    }
    const relativeUrl = url.pathname.slice(CONSOLE_ROOT.length)
    if (relativeUrl === '' || relativeUrl === '/') {
      await this.serveIndex(request, response)
      return
    }
    let decoded: string
    try {
      decoded = decodeURIComponent(relativeUrl)
    } catch {
      sendError(response, 400, '请求路径格式不正确', 'invalid_path')
      return
    }
    const target = resolve(normalize(join(this.distRoot, decoded.replace(/^\/+/u, ''))))
    if (target !== this.distRoot && !target.startsWith(this.distRoot + sep)) {
      sendError(response, 403, '禁止访问构建目录之外的文件', 'forbidden_path')
      return
    }
    const extension = extname(target).toLowerCase()
    if (extension === '') {
      await this.serveIndex(request, response)
      return
    }
    let body: Buffer
    try {
      body = await readFile(target)
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'ENOENT' || code === 'EISDIR' || code === 'ENOTDIR') {
        sendError(response, 404, '静态资源不存在', 'not_found')
        return
      }
      throw error
    }
    const etag = etagOf(body)
    if (request.headers['if-none-match'] === etag) {
      sendEmpty(response, 304, { etag, 'cache-control': 'public, max-age=31536000, immutable' })
      return
    }
    writeBytes(response, method, 200, body, {
      'cache-control': 'public, max-age=31536000, immutable',
      'content-type': MIME[extension] ?? 'application/octet-stream',
      etag,
    })
  }

  private async serveIndex(request: IncomingMessage, response: ServerResponse): Promise<void> {
    let html: Buffer
    try {
      html = await readFile(this.indexFile)
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'ENOENT' || code === 'EISDIR' || code === 'ENOTDIR') {
        writeBytes(response, request.method, 503, unavailablePage(), {
          'cache-control': 'no-store',
          'content-type': HTML_MIME,
        })
        return
      }
      throw error
    }
    writeBytes(response, request.method, 200, html, {
      'cache-control': 'no-store',
      'content-type': HTML_MIME,
    })
  }
}

/**
 * Mount the enterprise console and isolated tenant Harness gateway.
 * @param ctx - plugin context carrying WebServer, WebApp, and Connection.
 * @param config - validated deployment settings.
 */
export async function apply(ctx: Context, config: Config): Promise<void> {
  assertConfig(config)
  const opened = await EnterpriseStore.open(config.dataDir, normalizeEmail(config.bootstrapAdminEmail), config.brandName)
  const pluginRoot = join(config.dataDir, 'plugins')
  const publicOrigin = config.tenantPublicOrigin === undefined
    ? new URL(ctx.webApp.getAdvertisedUrl()).origin
    : resolvePublicOrigin(config.tenantPublicOrigin)
  const remoteBrowser = new RemoteBrowserPool({
    maxSessions: config.browserMaxSessions,
    maxSessionsPerUser: config.browserMaxSessionsPerUser,
    idleTimeoutMs: config.browserIdleTimeoutMinutes * 60_000,
    blockedOrigins: [publicOrigin],
  }, createPlaywrightRuntimeFactory({
    chromePath: config.browserChromePath,
    xvfbPath: config.browserXvfbPath,
    ...config.browserProxyUrl === undefined ? {} : { proxyUrl: config.browserProxyUrl },
    ...config.browserProxyBypass === undefined ? {} : { proxyBypass: config.browserProxyBypass },
    maxSessions: config.browserMaxSessions,
    maxSessionsPerUser: config.browserMaxSessionsPerUser,
    idleTimeoutMs: config.browserIdleTimeoutMinutes * 60_000,
    navigationTimeoutMs: config.browserNavigationTimeoutMs,
    blockedOrigins: [publicOrigin],
  }))
  const runtime = new TenantRuntimeManager({
    config: tenantRuntimeConfig(ctx, config, pluginRoot),
    pluginPolicy: () => tenantPluginPolicy(opened.store.snapshot(), pluginRoot),
    logger: {
      info: (message) => { ctx.logger.info(message) },
      warn: (error) => { ctx.logger.warn(error) },
    },
  })
  const gateway = new TenantGateway({
    store: opened.store,
    runtime,
    authenticate: request => api.authenticateRequest(request),
    webServer: ctx.webServer,
    logger: { warn: (error) => { ctx.logger.warn(error) } },
  })
  const api = await EnterpriseApi.create({
    store: opened.store,
    resources: new TeamResources(config.tenantRoot),
    tenantPath: team => `${TENANT_ROOT}/${team.slug}/harness/`,
    prepareTenant: team => gateway.prepare(team),
    plugins: new SharedEnterprisePluginInstaller(pluginRoot, config.tenantSourceRoot),
    pluginsChanged: () => runtime.refresh(),
    verification: new VerificationService(config.verificationWebhookUrl === undefined ? {} : {
      delivery: createWebhookVerificationDelivery({
        url: config.verificationWebhookUrl,
        ...(config.verificationWebhookToken === undefined ? {} : { token: config.verificationWebhookToken }),
      }),
    }),
    remoteBrowser,
    logger: { warn: (error) => { ctx.logger.warn(error) } },
  })
  const assets = new ConsoleAssets(config.distRoot)
  const handler = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    const url = new URL(request.url ?? '/', 'http://enterprise.local')
    if (url.pathname === HARNESS_SESSION_GUARD_PATH) {
      writeBytes(response, request.method, 200, Buffer.from(HARNESS_SESSION_GUARD_SCRIPT, 'utf8'), {
        'cache-control': 'no-store',
        'content-type': 'text/javascript; charset=utf-8',
      })
      return
    }
    if (url.pathname === API_ROOT || url.pathname.startsWith(`${API_ROOT}/`)) {
      await api.handle(request, response, url)
      return
    }
    await assets.serve(request, response, url)
  }
  ctx.effect(() => () => opened.store.close(), 'enterprise-console: database')
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: CONSOLE_ROOT,
    handler: (request, response) => {
      redirect(response, `${CONSOLE_ROOT}/${new URL(request.url ?? '/', 'http://enterprise.local').search}`)
    },
  }), 'enterprise-console: root redirect')
  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: CONSOLE_ROOT,
    handler,
  }), 'enterprise-console: application and API routes')
  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: TENANT_ROOT,
    handler: (request, response) => {
      const url = new URL(request.url ?? '/', 'http://enterprise.local')
      return gateway.handleHttp(request, response, url)
    },
  }), 'enterprise-console: isolated tenant routes')
  ctx.effect(() => () => {
    gateway.close()
    return Promise.all([runtime.close(), remoteBrowser.dispose()]).then(() => {})
  }, 'enterprise-console: tenant processes and remote browsers')
  ctx.on('webserver/index-inject', (table) => {
    table.push({ kind: 'script', placement: 'head', text: "document.documentElement.setAttribute('data-dsh-enterprise','')" })
    table.push({ kind: 'script-src', placement: 'body', src: HARNESS_SESSION_GUARD_PATH })
  })
  if (opened.seeded) {
    ctx.logger.info(`enterprise-console: initialized ${config.bootstrapAdminEmail}; initial password written to ${opened.initialPasswordFile}`)
  } else {
    ctx.logger.info(`enterprise-console: loaded catalog from ${opened.store.directory}`)
  }
}
