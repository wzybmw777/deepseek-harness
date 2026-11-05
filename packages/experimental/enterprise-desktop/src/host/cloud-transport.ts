/** Same-origin transport for enterprise Desktop control-plane requests. */

const DESKTOP_API_PREFIX = '/enterprise/api/desktop/'
const MAX_RESPONSE_BYTES = 16 * 1024 * 1024
const REFRESH_LEAD_MS = 5_000
const FORWARDED_HEADERS = new Set([
  'accept',
  'content-type',
  'x-dsh-request-id',
  'x-dsh-session-id',
  'anthropic-version',
  'anthropic-beta',
  'openai-beta',
])

/** Short-lived enterprise identity supplied to the local Host. */
export interface EnterpriseAccessBootstrap {
  readonly cloudBaseUrl: string
  readonly accessToken: string
  readonly accessExpiresAt: string
  readonly profileKey: string
  readonly user: { readonly id: string; readonly email: string; readonly name: string; readonly roleId: string }
  readonly team: { readonly id: string; readonly name: string; readonly slug: string }
}

/** Host-owned port that reads and renews the short-lived access grant. */
export interface EnterpriseBootstrapPort {
  /** Current grant, or undefined after sign-out. */
  current(): EnterpriseAccessBootstrap | undefined
  /**
   * Renew the access grant without exposing the refresh credential to the Host.
   * @param current - grant whose access token was rejected or is about to expire.
   * @returns the replacement grant for the same enterprise identity.
   */
  refresh(current: EnterpriseAccessBootstrap): Promise<EnterpriseAccessBootstrap>
}

export type EnterpriseCloudTransportErrorCode =
  | 'invalid_path'
  | 'invalid_request'
  | 'signed_out'
  | 'refresh_failed'
  | 'gateway_unavailable'
  | 'response_too_large'

/** Typed transport failure that must not fall back to a provider or consumer account. */
export class EnterpriseCloudTransportError extends Error {
  constructor(
    message: string,
    readonly code: EnterpriseCloudTransportErrorCode,
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = 'EnterpriseCloudTransportError'
  }
}

export interface EnterpriseCloudTransportOptions {
  readonly bootstrap: EnterpriseBootstrapPort
  readonly fetch?: typeof fetch
  readonly now?: () => number
  readonly maxResponseBytes?: number
}

export interface EnterpriseCloudRequest {
  readonly path: string
  readonly method: 'GET' | 'POST'
  readonly headers: Readonly<Record<string, string>>
  readonly body?: Uint8Array
  readonly signal?: AbortSignal
}

function fail(message: string, code: EnterpriseCloudTransportErrorCode, cause?: unknown): never {
  throw new EnterpriseCloudTransportError(message, code, cause === undefined ? undefined : { cause })
}

function cloudOrigin(value: string): string {
  let url: URL
  try {
    url = new URL(value)
  } catch (error) {
    fail('企业云服务地址无效', 'invalid_path', error)
  }
  if ((url.protocol !== 'https:' && url.protocol !== 'http:') || url.username !== '' || url.password !== ''
    || url.search !== '' || url.hash !== '' || (url.pathname !== '' && url.pathname !== '/')) {
    fail('企业云服务地址无效', 'invalid_path')
  }
  if (url.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
    fail('企业云服务地址必须使用 HTTPS', 'invalid_path')
  }
  return url.origin
}

function desktopPath(value: string): string {
  if (!value.startsWith(DESKTOP_API_PREFIX) || value.includes('\\') || value.includes('#')
    || value.startsWith('//')) fail('仅允许访问企业 Desktop API', 'invalid_path')
  const pathname = value.slice(0, value.includes('?') ? value.indexOf('?') : undefined)
  let decoded: string
  try {
    decoded = decodeURIComponent(pathname)
  } catch (error) {
    fail('企业 Desktop API 路径无效', 'invalid_path', error)
  }
  if (decoded.includes('\\') || decoded.includes('//')) fail('企业 Desktop API 路径无效', 'invalid_path')
  const segments = decoded.split('/')
  if (segments.some(segment => segment === '.' || segment === '..')) {
    fail('企业 Desktop API 路径无效', 'invalid_path')
  }
  let url: URL
  try {
    url = new URL(value, 'https://desktop.invalid/')
  } catch (error) {
    fail('企业 Desktop API 路径无效', 'invalid_path', error)
  }
  if (url.origin !== 'https://desktop.invalid' || !url.pathname.startsWith(DESKTOP_API_PREFIX)) {
    fail('企业 Desktop API 路径无效', 'invalid_path')
  }
  return `${url.pathname}${url.search}`
}

function assertGrant(value: EnterpriseAccessBootstrap): EnterpriseAccessBootstrap {
  const cloudBaseUrl = cloudOrigin(value.cloudBaseUrl)
  if (value.accessToken === '' || value.accessToken.length > 8192) fail('企业访问凭证无效', 'refresh_failed')
  if (!Number.isFinite(Date.parse(value.accessExpiresAt))) fail('企业访问凭证过期时间无效', 'refresh_failed')
  if (!/^[a-f0-9]{64}$/u.test(value.profileKey)) fail('企业桌面配置标识无效', 'refresh_failed')
  return { ...value, cloudBaseUrl }
}

function sameIdentity(left: EnterpriseAccessBootstrap, right: EnterpriseAccessBootstrap): boolean {
  return left.profileKey === right.profileKey && left.user.id === right.user.id && left.team.id === right.team.id
    && left.cloudBaseUrl === right.cloudBaseUrl
}

function expired(value: EnterpriseAccessBootstrap, now: number): boolean {
  return Date.parse(value.accessExpiresAt) <= now + REFRESH_LEAD_MS
}

function requestHeaders(headers: Readonly<Record<string, string>>, accessToken: string): Headers {
  const result = new Headers()
  for (const [rawName, value] of Object.entries(headers)) {
    const name = rawName.toLowerCase()
    if (!FORWARDED_HEADERS.has(name)) continue
    if (/[\r\n]/u.test(value)) fail('企业请求头无效', 'invalid_request')
    result.set(name, value)
  }
  result.set('authorization', `Bearer ${accessToken}`)
  return result
}

function aborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true
}

async function bounded(response: Response, maximum: number): Promise<Response> {
  if (response.body === null || response.headers.get('content-type')?.includes('text/event-stream') === true) {
    return response
  }
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      const read = await reader.read()
      if (read.done) break
      total += read.value.byteLength
      if (total > maximum) {
        await reader.cancel('enterprise response exceeded the size limit')
        fail('企业服务响应超过大小限制', 'response_too_large')
      }
      chunks.push(read.value)
    }
  } finally {
    reader.releaseLock()
  }
  const body = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers })
}

/** Fetch Desktop cloud endpoints without carrying cookies or accepting another origin. */
export class EnterpriseCloudTransport {
  readonly #bootstrap: EnterpriseBootstrapPort
  readonly #fetch: typeof fetch
  readonly #now: () => number
  readonly #maxResponseBytes: number
  #refreshing: Promise<EnterpriseAccessBootstrap> | undefined

  constructor(options: EnterpriseCloudTransportOptions) {
    this.#bootstrap = options.bootstrap
    this.#fetch = options.fetch ?? globalThis.fetch
    this.#now = options.now ?? Date.now
    this.#maxResponseBytes = options.maxResponseBytes ?? MAX_RESPONSE_BYTES
  }

  /**
   * Send one Desktop API request through the pinned enterprise cloud origin.
   * @param input - relative Desktop API path, method, allowlisted headers, body, and cancellation.
   * @returns the cloud response with status and body preserved for typed failures.
   */
  async request(input: EnterpriseCloudRequest): Promise<Response> {
    if (input.method === 'GET' && input.body !== undefined) fail('GET 请求不能携带请求体', 'invalid_request')
    const path = desktopPath(input.path)
    let grant = this.#current()
    let refreshed = false
    if (expired(grant, this.#now())) {
      grant = await this.#refresh(grant, true)
      refreshed = true
    }

    let response = await this.#send(grant, path, input)
    if (response.status === 401 && !refreshed) {
      grant = await this.#refresh(grant, true)
      response = await this.#send(grant, path, input)
    }
    return bounded(response, this.#maxResponseBytes)
  }

  #current(): EnterpriseAccessBootstrap {
    const value = this.#bootstrap.current()
    if (value === undefined) fail('企业登录已失效，请重新登录', 'signed_out')
    return assertGrant(value)
  }

  async #refresh(current: EnterpriseAccessBootstrap, requireNewToken: boolean): Promise<EnterpriseAccessBootstrap> {
    const running = this.#refreshing
    if (running !== undefined) return running
    const refresh = (async () => {
      let next: EnterpriseAccessBootstrap
      try {
        next = assertGrant(await this.#bootstrap.refresh(current))
      } catch (error) {
        if (error instanceof EnterpriseCloudTransportError) throw error
        fail('企业登录续期失败，请重新登录', 'refresh_failed', error)
      }
      if (!sameIdentity(current, next)) fail('企业登录身份在续期时发生变化', 'refresh_failed')
      if (requireNewToken && next.accessToken === current.accessToken) {
        fail('企业登录续期未返回新的访问凭证', 'refresh_failed')
      }
      return next
    })()
    this.#refreshing = refresh
    try {
      return await refresh
    } finally {
      if (this.#refreshing === refresh) this.#refreshing = undefined
    }
  }

  async #send(
    grant: EnterpriseAccessBootstrap,
    path: string,
    input: EnterpriseCloudRequest,
  ): Promise<Response> {
    if (aborted(input.signal)) fail('企业请求已取消', 'gateway_unavailable', input.signal?.reason)
    const url = new URL(path, `${grant.cloudBaseUrl}/`)
    try {
      return await this.#fetch(url, {
        method: input.method,
        headers: requestHeaders(input.headers, grant.accessToken),
        ...input.body === undefined ? {} : { body: new Uint8Array(input.body) },
        redirect: 'error',
        credentials: 'omit',
        cache: 'no-store',
        ...input.signal === undefined ? {} : { signal: input.signal },
      })
    } catch (error) {
      if (aborted(input.signal)) fail('企业请求已取消', 'gateway_unavailable', error)
      fail('企业服务暂时不可用，请稍后重试', 'gateway_unavailable', error)
    }
  }
}
