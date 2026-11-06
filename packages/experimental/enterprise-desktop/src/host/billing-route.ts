/** Local billing projection for the Desktop quota surface. */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type { EnterpriseBootstrapPort, EnterpriseCloudTransport } from './cloud-transport.ts'
import type { EnterpriseDesktopQuota } from './model-route.ts'

/** Local path read by the workbench quota surface. */
export const ENTERPRISE_BILLING_LOCAL_PATH = '/enterprise/api/desktop/billing'

/** Cloud console page that sells and renews enterprise plans. */
export const ENTERPRISE_PURCHASE_PATH = '/enterprise/billing'

/** Billing data safe to display after the cloud authorizes the member. */
export interface EnterpriseBillingProjection {
  readonly quota: EnterpriseDesktopQuota
  readonly planName: string
  readonly updatedAt: string
  readonly purchaseUrl: string
}

/** Invalid billing data from the pinned cloud service. */
export class EnterpriseBillingError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'EnterpriseBillingError'
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function integer(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function timestamp(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
}

function quota(value: unknown): EnterpriseDesktopQuota {
  if (!isRecord(value)) throw new EnterpriseBillingError('billing quota is missing')
  const { planName, totalTokens, usedTokens, remainingTokens, userTokens, cycleStartsAt, cycleEndsAt } = value
  if (typeof planName !== 'string' || planName.trim() === '' || planName.length > 120
    || !integer(totalTokens) || !integer(usedTokens) || !integer(remainingTokens) || !integer(userTokens)
    || !timestamp(cycleStartsAt) || !timestamp(cycleEndsAt)) {
    throw new EnterpriseBillingError('billing quota is invalid')
  }
  return { planName, totalTokens, usedTokens, remainingTokens, userTokens, cycleStartsAt, cycleEndsAt }
}

function projection(value: unknown, purchaseUrl: string): EnterpriseBillingProjection {
  if (!isRecord(value) || typeof value.planName !== 'string' || value.planName.trim() === ''
    || value.planName.length > 120 || !timestamp(value.updatedAt)) {
    throw new EnterpriseBillingError('billing response is invalid')
  }
  return { quota: quota(value.quota), planName: value.planName, updatedAt: value.updatedAt, purchaseUrl }
}

function writeJson(response: ServerResponse, status: number, body: object): void {
  if (response.headersSent) {
    response.destroy()
    return
  }
  const payload = Buffer.from(JSON.stringify(body), 'utf8')
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': String(payload.byteLength),
    'cache-control': 'no-store',
  })
  response.end(payload)
}

async function json(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch (error) {
    throw new EnterpriseBillingError('billing response is not JSON', { cause: error })
  }
}

/**
 * Register a same-origin billing read that forwards through the pinned cloud transport.
 * @param ctx - Host context owning the Web server.
 * @param transport - transport that attaches the short-lived enterprise token.
 * @param bootstrap - Host-owned access grant used to build the console purchase URL.
 * @returns disposer that unregisters the local route.
 */
export function installEnterpriseBillingRoute(
  ctx: Context,
  transport: EnterpriseCloudTransport,
  bootstrap: EnterpriseBootstrapPort,
): () => void {
  const dispose = ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: ENTERPRISE_BILLING_LOCAL_PATH,
    handler: async (request: IncomingMessage, response: ServerResponse) => {
      if (request.method !== 'GET') {
        writeJson(response, 405, { error: { code: 'method_not_allowed', message: '额度接口仅接受 GET 请求' } })
        return
      }
      const current = bootstrap.current()
      if (current === undefined) {
        writeJson(response, 401, { error: { code: 'signed_out', message: '企业登录已失效，请重新登录' } })
        return
      }
      try {
        const remote = await transport.request({
          path: ENTERPRISE_BILLING_LOCAL_PATH,
          method: 'GET',
          headers: { accept: 'application/json' },
        })
        if (!remote.ok) {
          const payload = await remote.text()
          response.writeHead(remote.status, {
            'content-type': remote.headers.get('content-type') ?? 'application/json; charset=utf-8',
            'cache-control': 'no-store',
          })
          response.end(payload)
          return
        }
        const purchaseUrl = new URL(ENTERPRISE_PURCHASE_PATH, current.cloudBaseUrl).href
        writeJson(response, 200, projection(await json(remote), purchaseUrl))
      } catch (error) {
        ctx.logger.warn(error instanceof Error ? error : new Error(String(error)))
        writeJson(response, 502, { error: { code: 'quota_unavailable', message: '额度暂时不可用，请稍后重试' } })
      }
    },
  }), 'enterprise-desktop: billing route')
  return () => { void dispose() }
}
