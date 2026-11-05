/** Host-side model route that sends every enterprise model request through the metered gateway. */

import { randomUUID } from 'node:crypto'
import { once } from 'node:events'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { CredentialStore, AuthContext } from '@earendil-works/pi-ai'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import {
  LlmAdapter,
  LlmError,
  LlmRequestId,
} from '@deepseek-ai/dsh-llm'
import type {
  GenerateOptions,
  LlmModelInfo,
  LlmResolvedModelInfo,
  StreamChunk,
} from '@deepseek-ai/dsh-llm'
import { PiAiAdapter, resolveProfiles, type PiAiProviderProfile } from '@deepseek-ai/dsh-llm-pi-ai'
import type { EnterpriseCloudTransport } from './cloud-transport.ts'

/** Provider route visible to the local Harness LLM registry. */
export const ENTERPRISE_MODEL_PROVIDER = 'enterprise-gateway'

/** Local path shared by every model's gateway URL. */
export const ENTERPRISE_GATEWAY_LOCAL_PREFIX = '/enterprise/api/desktop/gateway'

const ENTERPRISE_SESSION_HEADER = 'enterprise-session'
const MAX_REQUEST_BODY_BYTES = 16 * 1024 * 1024
const MAX_REQUEST_ID_LENGTH = 128
const MAX_SESSION_ID_BYTES = 200
const DEFAULT_MAX_TOKENS = 128_000
const RESPONSE_HEADERS = ['content-type', 'cache-control', 'retry-after', 'x-request-id'] as const
const PROTOCOLS = {
  'openai-chat': 'openai-completions',
  'openai-responses': 'openai-responses',
  'anthropic-messages': 'anthropic-messages',
} as const

/** Team allowance and the member's usage for the current monthly cycle. */
export interface EnterpriseDesktopQuota {
  readonly planName: string
  readonly totalTokens: number
  readonly usedTokens: number
  readonly remainingTokens: number
  readonly userTokens: number
  readonly cycleStartsAt: string
  readonly cycleEndsAt: string
}

/** One model route returned by the enterprise control plane. */
export interface EnterpriseDesktopModel {
  readonly id: string
  readonly name: string
  readonly protocol: string
  readonly gatewayBasePath: string
  readonly upstreamModelId: string
  readonly contextWindow: number
  readonly capabilities: readonly string[]
}

/** Model catalog and quota returned by the bearer-authenticated Desktop endpoint. */
export interface EnterpriseDesktopCatalog {
  readonly quota: EnterpriseDesktopQuota
  readonly models: readonly EnterpriseDesktopModel[]
  readonly refreshedAt: string
}

/** Invalid or unsupported enterprise model catalog. */
export class EnterpriseModelRouteError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'EnterpriseModelRouteError'
  }
}

function modelRoute(model: EnterpriseDesktopModel): PiAiProviderProfile {
  const api = piProtocol(model.protocol)
  if (api === undefined) throw new EnterpriseModelRouteError(`unsupported protocol "${model.protocol}" for model "${model.id}"`)
  return {
    displayName: model.name,
    api,
    baseURL: '',
    models: [{
      id: model.id,
      name: model.name,
      contextWindow: model.contextWindow,
      maxTokens: Math.min(DEFAULT_MAX_TOKENS, model.contextWindow),
      input: model.capabilities.some(capability => ['image', 'vision', 'image-input'].includes(capability))
        ? ['text', 'image']
        : ['text'],
    }],
  }
}

function piProtocol(protocol: string): (typeof PROTOCOLS)[keyof typeof PROTOCOLS] | undefined {
  switch (protocol) {
    case 'openai-chat': return PROTOCOLS['openai-chat']
    case 'openai-responses': return PROTOCOLS['openai-responses']
    case 'anthropic-messages': return PROTOCOLS['anthropic-messages']
    default: return undefined
  }
}

function innerProvider(modelId: string): string {
  return `${ENTERPRISE_MODEL_PROVIDER}:${modelId}`
}

function localOrigin(value: string): string {
  let url: URL
  try {
    url = new URL(value)
  } catch (error) {
    throw new EnterpriseModelRouteError('localGatewayOrigin must be an absolute HTTP origin', { cause: error })
  }
  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username !== '' || url.password !== ''
    || url.search !== '' || url.hash !== '' || (url.pathname !== '' && url.pathname !== '/')) {
    throw new EnterpriseModelRouteError('localGatewayOrigin must be an absolute HTTP origin')
  }
  if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
    throw new EnterpriseModelRouteError('localGatewayOrigin must name the loopback interface')
  }
  return url.origin
}

function validateCatalog(catalog: EnterpriseDesktopCatalog, origin: string): Map<string, EnterpriseDesktopModel> {
  const models = new Map<string, EnterpriseDesktopModel>()
  if (!Number.isSafeInteger(catalog.quota.remainingTokens)) {
    throw new EnterpriseModelRouteError('enterprise quota remainingTokens must be a safe integer')
  }
  for (const model of catalog.models) {
    if (!/^[A-Za-z0-9._~-]{1,200}$/u.test(model.id)) {
      throw new EnterpriseModelRouteError('enterprise model id must be a single URL path segment')
    }
    if (models.has(model.id)) throw new EnterpriseModelRouteError(`duplicate enterprise model "${model.id}"`)
    if (model.name.trim() === '' || model.name.length > 200) {
      throw new EnterpriseModelRouteError(`enterprise model "${model.id}" has an invalid name`)
    }
    if (!Number.isSafeInteger(model.contextWindow) || model.contextWindow <= 0) {
      throw new EnterpriseModelRouteError(`enterprise model "${model.id}" has an invalid context window`)
    }
    if (model.gatewayBasePath !== `${ENTERPRISE_GATEWAY_LOCAL_PREFIX}/${model.id}`) {
      throw new EnterpriseModelRouteError(`enterprise model "${model.id}" has an invalid gateway path`)
    }
    if (piProtocol(model.protocol) === undefined) {
      throw new EnterpriseModelRouteError(`unsupported protocol "${model.protocol}" for model "${model.id}"`)
    }
    models.set(model.id, model)
  }
  if (models.size === 0) throw new EnterpriseModelRouteError('enterprise model catalog is empty')
  return new Map([...models].map(([id, model]) => [id, {
    ...model,
    gatewayBasePath: new URL(model.gatewayBasePath, origin).href,
  }]))
}

function inputModalities(model: EnterpriseDesktopModel): readonly ('text' | 'image')[] {
  return model.capabilities.some(capability => ['image', 'vision', 'image-input'].includes(capability))
    ? ['text', 'image']
    : ['text']
}

const noCredentials: CredentialStore = {
  read: () => Promise.resolve(undefined),
  list: () => Promise.resolve([]),
  modify: async (_providerId, mutate) => mutate(undefined),
  delete: () => Promise.resolve(),
}

const noAuthContext: AuthContext = {
  env: () => Promise.resolve(undefined),
  fileExists: () => Promise.resolve(false),
}

class EnterpriseGatewayAdapter extends LlmAdapter {
  constructor(
    private readonly catalog: EnterpriseDesktopCatalog,
    private readonly models: ReadonlyMap<string, EnterpriseDesktopModel>,
    private readonly inner: PiAiAdapter,
  ) {
    super()
  }

  override providerInfo(): { readonly id: string; readonly name: string } {
    return { id: ENTERPRISE_MODEL_PROVIDER, name: '企业模型网关' }
  }

  override listModels(provider: string): Promise<readonly LlmModelInfo[]> {
    if (provider !== ENTERPRISE_MODEL_PROVIDER) return Promise.resolve([])
    return Promise.resolve([...this.models.values()].map(model => ({
      provider: ENTERPRISE_MODEL_PROVIDER,
      id: model.id,
      name: model.name,
      inputModalities: inputModalities(model),
    })))
  }

  override resolveModel(provider: string, modelId: string): Promise<LlmResolvedModelInfo> {
    if (provider !== ENTERPRISE_MODEL_PROVIDER) {
      return Promise.reject(new LlmError(`unknown enterprise provider "${provider}"`, 'MODEL_NOT_FOUND'))
    }
    const model = this.models.get(modelId)
    if (model === undefined) {
      return Promise.reject(new LlmError(`unknown enterprise model "${modelId}"`, 'MODEL_NOT_FOUND'))
    }
    return Promise.resolve({
      provider: ENTERPRISE_MODEL_PROVIDER,
      id: model.id,
      name: model.name,
      inputModalities: inputModalities(model),
      context: { contextWindow: model.contextWindow },
    })
  }

  override stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    return this.dispatch(options)
  }

  private async *dispatch(options: GenerateOptions): AsyncGenerator<StreamChunk> {
    if (options.provider !== ENTERPRISE_MODEL_PROVIDER) {
      throw new LlmError(`unknown enterprise provider "${options.provider}"`, 'MODEL_NOT_FOUND')
    }
    if (this.catalog.quota.remainingTokens <= 0) {
      throw new LlmError('本月团队 Token 额度已用完', 'quota_exhausted')
    }
    const model = this.models.get(options.model)
    if (model === undefined) throw new LlmError(`unknown enterprise model "${options.model}"`, 'MODEL_NOT_FOUND')
    const requestId = options.requestId ?? LlmRequestId(randomUUID())
    for await (const chunk of this.inner.stream({ ...options, provider: innerProvider(model.id), requestId })) {
      if (chunk.type === 'finish' && chunk.reason.kind === 'error' && chunk.reason.failure.status === 402) {
        yield {
          ...chunk,
          reason: {
            kind: 'error',
            failure: { ...chunk.reason.failure, code: 'quota_exhausted', message: '本月团队 Token 额度已用完' },
          },
        }
      } else {
        yield chunk
      }
    }
  }
}

interface LocalRequestError {
  readonly status: number
  readonly code: string
  readonly message: string
}

class LocalGatewayError extends Error implements LocalRequestError {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'LocalGatewayError'
  }
}

function singleHeader(request: IncomingMessage, name: string): string | undefined {
  const value = request.headers[name]
  return typeof value === 'string' ? value : undefined
}

function requestId(request: IncomingMessage): string {
  const value = singleHeader(request, 'x-dsh-request-id')
  if (value === undefined || value.length < 1 || value.length > MAX_REQUEST_ID_LENGTH || !/^[\x20-\x7e]+$/u.test(value)) {
    throw new LocalGatewayError(400, 'invalid_request_id', '模型请求标识无效')
  }
  return value
}

function sessionId(request: IncomingMessage): string | undefined {
  const value = singleHeader(request, 'x-dsh-session-id')
  if (value === undefined) return undefined
  if (value === '' || Buffer.byteLength(value, 'utf8') > MAX_SESSION_ID_BYTES) {
    throw new LocalGatewayError(400, 'invalid_session_id', '会话标识无效')
  }
  return value
}

function localAuthorization(request: IncomingMessage): void {
  const value = singleHeader(request, 'authorization')
  if (value !== ENTERPRISE_SESSION_HEADER && value !== `Bearer ${ENTERPRISE_SESSION_HEADER}`) {
    throw new LocalGatewayError(401, 'unauthorized', '企业模型路由认证失败')
  }
}

function requestPath(request: IncomingMessage): string {
  let url: URL
  try {
    url = new URL(request.url ?? '/', 'http://desktop.local')
  } catch (_error) {
    throw new LocalGatewayError(400, 'invalid_path', '企业模型路由路径无效')
  }
  if (url.origin !== 'http://desktop.local' || !url.pathname.startsWith(`${ENTERPRISE_GATEWAY_LOCAL_PREFIX}/`)) {
    throw new LocalGatewayError(404, 'not_found', '接口不存在')
  }
  return url.pathname
}

async function readBody(request: IncomingMessage): Promise<Uint8Array> {
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array)
    total += bytes.byteLength
    if (total > MAX_REQUEST_BODY_BYTES) {
      throw new LocalGatewayError(413, 'body_too_large', '模型请求体超过 16 MiB 限制')
    }
    chunks.push(bytes)
  }
  return new Uint8Array(Buffer.concat(chunks))
}

function forwardedHeaders(request: IncomingMessage): Record<string, string> {
  const headers: Record<string, string> = { authorization: ENTERPRISE_SESSION_HEADER }
  for (const name of ['accept', 'content-type', 'x-dsh-request-id', 'x-dsh-session-id', 'anthropic-version', 'anthropic-beta', 'openai-beta']) {
    const value = singleHeader(request, name)
    if (value !== undefined) headers[name] = value
  }
  return headers
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

async function relay(body: ReadableStream<Uint8Array>, response: ServerResponse, signal: AbortSignal): Promise<void> {
  const reader = body.getReader()
  try {
    for (;;) {
      const read = await reader.read()
      if (read.done) break
      if (signal.aborted || response.destroyed) break
      if (!response.write(read.value)) await once(response, 'drain')
    }
  } finally {
    reader.releaseLock()
  }
  if (!response.writableEnded) response.end()
}

function handler(transport: EnterpriseCloudTransport): (request: IncomingMessage, response: ServerResponse) => Promise<void> {
  return async (request, response) => {
    const controller = new AbortController()
    const abort = (): void => { controller.abort('local gateway request closed') }
    request.once('aborted', abort)
    response.once('close', () => { if (!response.writableEnded) abort() })
    try {
      if (request.method !== 'POST') throw new LocalGatewayError(405, 'method_not_allowed', '模型网关仅接受 POST 请求')
      localAuthorization(request)
      const path = requestPath(request)
      void requestId(request)
      sessionId(request)
      const remote = await transport.request({
        path,
        method: 'POST',
        headers: forwardedHeaders(request),
        body: await readBody(request),
        signal: controller.signal,
      })
      response.statusCode = remote.status
      for (const name of RESPONSE_HEADERS) {
        const value = remote.headers.get(name)
        if (value !== null) response.setHeader(name, value)
      }
      if (remote.body === null) response.end()
      else await relay(remote.body, response, controller.signal)
    } catch (error) {
      if (response.destroyed || controller.signal.aborted) return
      if (error instanceof LocalGatewayError) {
        writeJson(response, error.status, { error: { code: error.code, message: error.message } })
        return
      }
      writeJson(response, 502, { error: { code: 'gateway_unavailable', message: '企业模型服务暂时不可用，请稍后重试' } })
    } finally {
      request.off('aborted', abort)
    }
  }
}

/**
 * Register the local enterprise gateway route and its single LLM provider.
 * @param ctx - Host context owning the Web server and LLM registry.
 * @param transport - same-origin transport to the enterprise control plane.
 * @param catalog - current model catalog and team allowance.
 * @param localGatewayOrigin - loopback origin of the local Host Web server.
 * @returns disposer that unregisters the local route and LLM provider.
 */
export function installEnterpriseModelRoute(
  ctx: Context,
  transport: EnterpriseCloudTransport,
  catalog: EnterpriseDesktopCatalog,
  localGatewayOrigin: string,
): () => void {
  const origin = localOrigin(localGatewayOrigin)
  const models = validateCatalog(catalog, origin)
  const profiles: Record<string, PiAiProviderProfile> = {}
  for (const model of models.values()) {
    profiles[innerProvider(model.id)] = {
      ...modelRoute(model),
      baseURL: model.gatewayBasePath,
    }
  }
  const resolved = resolveProfiles(profiles)
  const inner = new PiAiAdapter({
    profiles: () => resolved,
    resolveApiKey: () => Promise.resolve(ENTERPRISE_SESSION_HEADER),
    auth: { credentials: noCredentials, authContext: noAuthContext },
    prepareHeaders: (request, headers) => {
      headers.set('authorization', ENTERPRISE_SESSION_HEADER)
      if (request.requestId !== undefined) headers.set('x-dsh-request-id', request.requestId)
      if (request.sessionId !== undefined) headers.set('x-dsh-session-id', request.sessionId)
      return headers
    },
  })
  const adapter = new EnterpriseGatewayAdapter(catalog, models, inner)
  const dispose = ctx.effect(() => {
    const disposeRoute = ctx.webServer.register({
      kind: 'prefix',
      path: ENTERPRISE_GATEWAY_LOCAL_PREFIX,
      handler: handler(transport),
    })
    try {
      const registration = ctx.llm.registerAdapter([ENTERPRISE_MODEL_PROVIDER], adapter)
      return () => {
        registration()
        disposeRoute()
      }
    } catch (error) {
      disposeRoute()
      throw error
    }
  }, 'enterprise-desktop: model route')
  return () => { void dispose() }
}
