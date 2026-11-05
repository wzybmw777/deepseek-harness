/** Authenticated, metered model gateway for enterprise Desktop clients. */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { EnterpriseRequestSession } from './api.ts'
import { DesktopModels } from './desktop-models.ts'
import { HttpError, clientIp, readBody } from './http.ts'
import { decryptCredential, recordId } from './security.ts'
import type { EnterpriseStore } from './store.ts'
import type {
  AuditRecord,
  ChannelRecord,
  ChannelWireProtocol,
  DesktopGatewayStatus,
  ModelRecord,
  UsageRecord,
} from './types.ts'

/** Route prefix shared by the console API and the Desktop Host transport. */
export const DESKTOP_GATEWAY_PREFIX = '/enterprise/api/desktop/gateway/'

const MAX_REQUEST_ID_LENGTH = 128
const MAX_SESSION_ID_BYTES = 200
const MAX_REQUEST_BODY_BYTES = 16 * 1024 * 1024
const MAX_USAGE_BUFFER_BYTES = 4 * 1024 * 1024
const UPSTREAM_PATHS: Readonly<Record<ChannelWireProtocol, string>> = {
  'openai-chat': 'chat/completions',
  'openai-responses': 'responses',
  'anthropic-messages': 'messages',
}
const SAFE_RESPONSE_HEADERS = [
  'content-type',
  'cache-control',
  'retry-after',
  'x-request-id',
  'content-disposition',
] as const

/** Provider-reported tokens for one completed model response. */
export interface ParsedUsage {
  readonly inputTokens: number
  readonly outputTokens: number
}

export interface DesktopModelGatewayOptions {
  readonly models?: DesktopModels
  readonly now?: () => Date
}

interface UpstreamRoute {
  readonly model: ModelRecord
  readonly channel: ChannelRecord
}

interface PartialUsage {
  readonly inputTokens: number | undefined
  readonly outputTokens: number | undefined
}

interface ConnectionState {
  readonly aborted: boolean
  dispose(): void
}

class ClientDisconnectedError extends Error {
  constructor() {
    super('Desktop client disconnected')
    this.name = 'ClientDisconnectedError'
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function tokenCount(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined
}

function firstToken(record: Record<string, unknown>, names: readonly string[]): number | undefined {
  for (const name of names) {
    const value = tokenCount(record[name])
    if (value !== undefined) return value
  }
  return undefined
}

function usageObject(value: Record<string, unknown>): Record<string, unknown> | undefined {
  if (isRecord(value.usage)) return value.usage
  if (isRecord(value.message) && isRecord(value.message.usage)) return value.message.usage
  if (isRecord(value.response) && isRecord(value.response.usage)) return value.response.usage
  return undefined
}

function partialUsage(protocol: ChannelWireProtocol, value: unknown): PartialUsage {
  if (!isRecord(value)) return { inputTokens: undefined, outputTokens: undefined }
  const usage = usageObject(value)
  if (usage === undefined) return { inputTokens: undefined, outputTokens: undefined }
  if (protocol === 'openai-chat') {
    return {
      inputTokens: firstToken(usage, ['prompt_tokens', 'input_tokens']),
      outputTokens: firstToken(usage, ['completion_tokens', 'output_tokens']),
    }
  }
  return {
    inputTokens: firstToken(usage, ['input_tokens', 'prompt_tokens']),
    outputTokens: firstToken(usage, ['output_tokens', 'completion_tokens']),
  }
}

function mergePartial(
  current: PartialUsage,
  next: PartialUsage,
): PartialUsage {
  return {
    inputTokens: next.inputTokens === undefined
      ? current.inputTokens
      : Math.max(current.inputTokens ?? 0, next.inputTokens),
    outputTokens: next.outputTokens === undefined
      ? current.outputTokens
      : Math.max(current.outputTokens ?? 0, next.outputTokens),
  }
}

function completeUsage(partial: PartialUsage): ParsedUsage | undefined {
  return partial.inputTokens === undefined || partial.outputTokens === undefined
    ? undefined
    : { inputTokens: partial.inputTokens, outputTokens: partial.outputTokens }
}

function parseJsonUsage(protocol: ChannelWireProtocol, body: string): ParsedUsage | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch {
    return undefined
  }
  return completeUsage(partialUsage(protocol, parsed))
}

class ProviderUsageTee {
  private partial: PartialUsage = { inputTokens: undefined, outputTokens: undefined }
  private readonly decoder = new TextDecoder()
  private pending = ''
  private buffer = ''
  private bufferedBytes = 0
  private discardingLine = false
  private oversizedBody = false

  constructor(
    private readonly protocol: ChannelWireProtocol,
    private readonly streaming: boolean,
  ) {}

  push(chunk: Uint8Array): void {
    if (!this.streaming) {
      if (this.oversizedBody) return
      if (this.bufferedBytes + chunk.byteLength > MAX_USAGE_BUFFER_BYTES) {
        this.oversizedBody = true
        this.buffer = ''
        this.bufferedBytes = 0
        return
      }
      this.bufferedBytes += chunk.byteLength
      this.buffer += this.decoder.decode(chunk, { stream: true })
      return
    }
    this.pushStreaming(this.decoder.decode(chunk, { stream: true }))
  }

  end(): ParsedUsage | undefined {
    if (!this.streaming) {
      this.buffer += this.decoder.decode()
      if (this.oversizedBody) return undefined
      return parseJsonUsage(this.protocol, this.buffer)
    }
    this.pushStreaming(this.decoder.decode())
    if (!this.discardingLine && this.pending !== '') this.processLine(this.pending)
    this.pending = ''
    return completeUsage(this.partial)
  }

  private pushStreaming(text: string): void {
    let remaining = text
    if (this.discardingLine) {
      const newline = remaining.indexOf('\n')
      if (newline === -1) return
      this.discardingLine = false
      remaining = remaining.slice(newline + 1)
    }
    this.pending += remaining
    for (;;) {
      const newline = this.pending.indexOf('\n')
      if (newline === -1) break
      const line = this.pending.slice(0, newline).replace(/\r$/u, '')
      this.pending = this.pending.slice(newline + 1)
      this.processLine(line)
    }
    if (this.pending.length > MAX_USAGE_BUFFER_BYTES) {
      this.pending = ''
      this.discardingLine = true
    }
  }

  private processLine(line: string): void {
    const trimmed = line.trim()
    if (!trimmed.startsWith('data:')) return
    const payload = trimmed.slice('data:'.length).trim()
    if (payload === '' || payload === '[DONE]' || !payload.includes('usage')) return
    let parsed: unknown
    try {
      parsed = JSON.parse(payload)
    } catch {
      return
    }
    this.partial = mergePartial(this.partial, partialUsage(this.protocol, parsed))
  }
}

/**
 * Read exact provider usage from a complete JSON or server-sent-event body.
 * @param protocol - channel wire protocol that defines token field names.
 * @param body - complete provider response body.
 * @returns both token counts only when the provider reported both.
 */
export function parseProviderUsage(protocol: ChannelWireProtocol, body: string): ParsedUsage | undefined {
  if (body.trimStart().startsWith('{')) return parseJsonUsage(protocol, body)
  const tee = new ProviderUsageTee(protocol, true)
  tee.push(Buffer.from(body, 'utf8'))
  return tee.end()
}

/**
 * Split a Desktop gateway pathname into its model and allowlisted upstream suffix.
 * @param pathname - request pathname.
 * @returns route identifiers, or undefined when the path is outside the gateway prefix.
 */
export function parseDesktopGatewayPath(pathname: string): {
  readonly modelId: string
  readonly upstreamPath: string
} | undefined {
  if (!pathname.startsWith(DESKTOP_GATEWAY_PREFIX)) return undefined
  const suffix = pathname.slice(DESKTOP_GATEWAY_PREFIX.length)
  const separator = suffix.indexOf('/')
  if (separator <= 0 || separator === suffix.length - 1) {
    throw new HttpError(400, '模型网关路径无效', 'invalid_gateway_path')
  }
  return {
    modelId: suffix.slice(0, separator),
    upstreamPath: suffix.slice(separator + 1),
  }
}

function validateRequestId(value: string): string {
  if (value.length < 1 || value.length > MAX_REQUEST_ID_LENGTH || !/^[\x20-\x7e]+$/u.test(value)) {
    throw new HttpError(400, '模型请求标识无效', 'invalid_request_id')
  }
  return value
}

function validateSessionId(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  if (value === '' || Buffer.byteLength(value, 'utf8') > MAX_SESSION_ID_BYTES) {
    throw new HttpError(400, '会话标识无效', 'invalid_session_id')
  }
  return value
}

function upstreamPath(protocol: ChannelWireProtocol, path: string): string {
  if (protocol === 'anthropic-messages' && path === 'v1/messages') return UPSTREAM_PATHS[protocol]
  if (path !== UPSTREAM_PATHS[protocol]) {
    throw new HttpError(400, '当前模型不支持该上游路径', 'invalid_upstream_path')
  }
  return path
}

function upstreamUrl(channel: ChannelRecord, path: string): URL {
  let base: URL
  try {
    base = new URL(channel.baseUrl)
  } catch {
    throw new HttpError(502, '模型渠道地址无效，请联系管理员', 'channel_unavailable')
  }
  if ((base.protocol !== 'http:' && base.protocol !== 'https:')
    || base.username !== '' || base.password !== '' || base.search !== '' || base.hash !== '') {
    throw new HttpError(502, '模型渠道地址无效，请联系管理员', 'channel_unavailable')
  }
  base.pathname = `${base.pathname.replace(/\/+$/u, '')}/`
  const target = new URL(path, base)
  if (target.origin !== base.origin) {
    throw new HttpError(502, '模型渠道地址无效，请联系管理员', 'channel_unavailable')
  }
  return target
}

function channelCredential(channel: ChannelRecord, store: EnterpriseStore): string | undefined {
  if (channel.encryptedApiKey === '') return undefined
  try {
    return decryptCredential(channel.encryptedApiKey, store.credentialKey)
  } catch {
    throw new HttpError(502, '模型渠道凭证不可用，请联系管理员', 'channel_unavailable')
  }
}

function rewriteRequestModel(body: Buffer, upstreamModelId: string): Buffer {
  if (body.byteLength === 0) throw new HttpError(400, '模型请求体不能为空', 'invalid_body')
  let parsed: unknown
  try {
    parsed = JSON.parse(body.toString('utf8'))
  } catch {
    throw new HttpError(400, '模型请求体不是有效 JSON', 'invalid_body')
  }
  if (!isRecord(parsed)) throw new HttpError(400, '模型请求体必须是 JSON 对象', 'invalid_body')
  return Buffer.from(JSON.stringify({ ...parsed, model: upstreamModelId }), 'utf8')
}

function trackConnection(
  request: IncomingMessage,
  response: ServerResponse,
  controller: AbortController,
): ConnectionState {
  let aborted = false
  const abort = (): void => {
    if (aborted) return
    aborted = true
    controller.abort()
  }
  const onRequestAborted = (): void => { abort() }
  const onResponseClose = (): void => {
    if (!response.writableEnded) abort()
  }
  request.once('aborted', onRequestAborted)
  response.once('close', onResponseClose)
  return {
    get aborted() { return aborted },
    dispose() {
      request.off('aborted', onRequestAborted)
      response.off('close', onResponseClose)
    },
  }
}

async function writeChunk(response: ServerResponse, chunk: Uint8Array): Promise<void> {
  if (response.destroyed) throw new ClientDisconnectedError()
  if (response.write(chunk)) return
  await new Promise<void>((resolve, reject) => {
    const cleanup = (): void => {
      response.off('drain', onDrain)
      response.off('close', onClose)
    }
    const onDrain = (): void => {
      cleanup()
      resolve()
    }
    const onClose = (): void => {
      cleanup()
      reject(new ClientDisconnectedError())
    }
    response.once('drain', onDrain)
    response.once('close', onClose)
  })
}

function usageCostCents(model: ModelRecord, usage: ParsedUsage): number {
  const numerator = usage.inputTokens * model.inputPricePerMillionCents
    + usage.outputTokens * model.outputPricePerMillionCents
  return Math.ceil(numerator / 1_000_000)
}

/** Pass-through model gateway that meters exact provider usage and enforces quota admission. */
export class DesktopModelGateway {
  private readonly models: DesktopModels
  private readonly now: () => Date

  constructor(
    private readonly store: EnterpriseStore,
    options: DesktopModelGatewayOptions = {},
  ) {
    this.now = options.now ?? (() => new Date())
    this.models = options.models ?? new DesktopModels(store, { now: this.now })
  }

  /**
   * Authorize, meter, and forward one Desktop model request.
   * @param input - authenticated session, selected model, upstream suffix, and client identities.
   * @returns completion after the upstream response has ended or the client disconnected.
   */
  async forward(input: {
    readonly request: IncomingMessage
    readonly response: ServerResponse
    readonly session: EnterpriseRequestSession
    readonly modelId: string
    readonly upstreamPath: string
    readonly requestId: string
    readonly sessionId?: string
  }): Promise<void> {
    const requestId = validateRequestId(input.requestId)
    const requestSessionId = validateSessionId(input.sessionId)
    const teamId = input.session.user.teamId
    if (teamId === undefined) throw new HttpError(403, '当前账号尚未分配团队，请联系管理员', 'team_unavailable')
    const route: UpstreamRoute = this.models.resolve(input.session, input.modelId)
    const path = upstreamPath(route.channel.wireProtocol, input.upstreamPath)
    const target = upstreamUrl(route.channel, path)
    const startedAt = this.now().toISOString()
    const attemptId = recordId()
    const started = await this.store.beginDesktopGatewayAttempt({
      id: attemptId,
      requestId,
      teamId,
      userId: input.session.user.id,
      modelId: route.model.id,
      channelId: route.channel.id,
      ...(requestSessionId === undefined ? {} : { sessionId: requestSessionId }),
      startedAt,
    })
    if (!started.created) {
      throw new HttpError(409, '请求已处理，请勿重复提交', 'request_replayed')
    }

    let finishPromise: Promise<void> | undefined
    const finish = (status: DesktopGatewayStatus, usage?: ParsedUsage): Promise<void> => {
      finishPromise ??= this.finishAttempt({
        attemptId,
        status,
        requestId,
        teamId,
        userId: input.session.user.id,
        userEmail: input.session.user.email,
        model: route.model,
        channel: route.channel,
        request: input.request,
        ...(requestSessionId === undefined ? {} : { sessionId: requestSessionId }),
        ...(usage === undefined ? {} : { usage }),
      })
      return finishPromise
    }

    const controller = new AbortController()
    const connection = trackConnection(input.request, input.response, controller)
    let relayed = false
    let upstream: Response | undefined
    try {
      const requestBody = rewriteRequestModel(
        await readBody(input.request, MAX_REQUEST_BODY_BYTES, '模型请求体超过 16 MiB 限制'),
        route.model.name,
      )
      const headers: Record<string, string> = {
        'content-type': 'application/json',
      }
      const accept = input.request.headers.accept
      if (typeof accept === 'string' && accept !== '') headers.accept = accept
      const credential = channelCredential(route.channel, this.store)
      if (credential !== undefined) headers.authorization = `Bearer ${credential}`

      try {
        upstream = await fetch(target, {
          method: 'POST',
          headers,
          body: new Uint8Array(requestBody),
          redirect: 'error',
          signal: controller.signal,
        })
      } catch {
        if (connection.aborted) {
          await finish('failed')
          return
        }
        throw new HttpError(502, '模型服务暂时不可用，请稍后重试', 'upstream_unavailable')
      }

      input.response.statusCode = upstream.status
      for (const name of SAFE_RESPONSE_HEADERS) {
        const value = upstream.headers.get(name)
        if (value !== null) input.response.setHeader(name, value)
      }
      const tee = new ProviderUsageTee(
        route.channel.wireProtocol,
        upstream.headers.get('content-type')?.includes('text/event-stream') ?? false,
      )
      await this.relay(upstream, input.response, tee)
      relayed = true
      if (connection.aborted) {
        await finish('failed')
        return
      }
      if (!upstream.ok) {
        await finish('failed')
        return
      }
      const usage = tee.end()
      await finish(usage === undefined ? 'usage_missing' : 'completed', usage)
    } catch (error) {
      controller.abort()
      const disconnected = connection.aborted || error instanceof ClientDisconnectedError
      if (disconnected) {
        await finish('failed')
        return
      }
      await finish('failed')
      if (error instanceof HttpError) throw error
      if (!relayed && !input.response.headersSent) {
        throw new HttpError(502, '模型服务暂时不可用，请稍后重试', 'upstream_unavailable')
      }
      input.response.destroy()
    } finally {
      connection.dispose()
      if (upstream?.body !== null && connection.aborted) controller.abort()
    }
  }

  private async relay(
    upstream: Response,
    response: ServerResponse,
    tee: ProviderUsageTee,
  ): Promise<void> {
    if (upstream.body === null) {
      response.end()
      return
    }
    const reader = upstream.body.getReader()
    try {
      for (;;) {
        const read = await reader.read()
        if (read.done) break
        tee.push(read.value)
        await writeChunk(response, read.value)
      }
    } finally {
      reader.releaseLock()
    }
    if (!response.writableEnded) response.end()
  }

  private async finishAttempt(input: {
    readonly attemptId: string
    readonly status: DesktopGatewayStatus
    readonly requestId: string
    readonly teamId: string
    readonly userId: string
    readonly userEmail: string
    readonly model: ModelRecord
    readonly channel: ChannelRecord
    readonly request: IncomingMessage
    readonly sessionId?: string
    readonly usage?: ParsedUsage
  }): Promise<void> {
    if (input.status === 'started') throw new Error('Desktop gateway attempts must finish before commit')
    const finishedAt = this.now().toISOString()
    const usageRecord: UsageRecord | undefined = input.status === 'completed' && input.usage !== undefined
      ? {
        id: recordId(),
        externalId: `desktop:${input.teamId}:${input.requestId}`,
        teamId: input.teamId,
        userId: input.userId,
        modelId: input.model.id,
        channelId: input.channel.id,
        requests: 1,
        inputTokens: input.usage.inputTokens,
        outputTokens: input.usage.outputTokens,
        costCents: usageCostCents(input.model, input.usage),
        recordedAt: finishedAt,
      }
      : undefined
    const audit: AuditRecord = {
      id: recordId(),
      actorId: input.userId,
      actorEmail: input.userEmail,
      action: `desktop.gateway.${input.status}`,
      targetType: 'desktop_gateway_attempt',
      targetId: input.attemptId,
      summary: `调用企业模型 ${input.model.displayName}（${input.status}）`,
      ip: clientIp(input.request),
      createdAt: finishedAt,
      metadata: {
        requestId: input.requestId,
        modelId: input.model.id,
        channelId: input.channel.id,
        inputTokens: input.usage?.inputTokens ?? 0,
        outputTokens: input.usage?.outputTokens ?? 0,
      },
    }
    await this.store.finishDesktopGatewayAttempt({
      attemptId: input.attemptId,
      status: input.status,
      inputTokens: input.usage?.inputTokens ?? 0,
      outputTokens: input.usage?.outputTokens ?? 0,
      finishedAt,
      ...(usageRecord === undefined ? {} : { usage: usageRecord }),
      audit,
    })
  }
}
