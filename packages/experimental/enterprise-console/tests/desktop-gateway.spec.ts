import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { EnterpriseApi } from '../src/api.ts'
import { parseProviderUsage } from '../src/desktop-gateway.ts'
import { encryptCredential } from '../src/security.ts'
import { EnterpriseStore } from '../src/store.ts'
import { TeamResources } from '../src/team-resources.ts'
import type { DesktopGatewayAttemptRecord } from '../src/types.ts'

interface UpstreamRequest {
  readonly method: string
  readonly path: string
  readonly authorization?: string
  readonly contentType?: string
  readonly body: Buffer
}

type UpstreamHandler = (
  request: IncomingMessage,
  response: ServerResponse,
  body: Buffer,
) => void | Promise<void>

interface GatewayHarness {
  readonly base: string
  readonly store: EnterpriseStore
  readonly token: string
  readonly requests: UpstreamRequest[]
  setUpstream(handler: UpstreamHandler): void
}

interface GatewayRequestOptions {
  readonly token?: string
  readonly requestId?: string
  readonly sessionId?: string
  readonly method?: string
  readonly body?: unknown
}

const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  await Promise.all(cleanups.splice(0).reverse().map(cleanup => cleanup()))
})

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => { resolve() })
    server.closeAllConnections()
  })
}

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('Expected a TCP listener')
  return `http://127.0.0.1:${String(address.port)}`
}

async function requestBody(request: IncomingMessage): Promise<Buffer> {
  const chunks: Uint8Array[] = []
  for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  return Buffer.concat(chunks)
}

async function startHarness(): Promise<GatewayHarness> {
  const requests: UpstreamRequest[] = []
  let handler: UpstreamHandler | undefined
  const upstream = createServer((request, response) => {
    void requestBody(request).then(async (body) => {
      requests.push({
        method: request.method ?? '',
        path: request.url ?? '',
        ...(typeof request.headers.authorization === 'string'
          ? { authorization: request.headers.authorization }
          : {}),
        ...(typeof request.headers['content-type'] === 'string'
          ? { contentType: request.headers['content-type'] }
          : {}),
        body,
      })
      if (handler === undefined) {
        response.writeHead(503).end()
        return
      }
      await handler(request, response, body)
    }).catch(() => { response.destroy() })
  })
  const upstreamBase = await listen(upstream)
  cleanups.push(() => closeServer(upstream))

  const dataDir = await mkdtemp(join(tmpdir(), 'dsh-desktop-gateway-'))
  const opened = await EnterpriseStore.open(dataDir, 'owner@example.com', 'Enterprise Test')
  await opened.store.mutate((draft) => {
    const channel = draft.channels.find(candidate => candidate.id === 'channel-deepseek')
    if (channel === undefined) throw new Error('seed channel is missing')
    channel.baseUrl = `${upstreamBase}/v1`
    channel.encryptedApiKey = encryptCredential('upstream-secret', opened.store.credentialKey)
  })

  const api = await EnterpriseApi.create({
    store: opened.store,
    resources: new TeamResources(join(dataDir, 'tenants')),
    tenantPath: () => '/enterprise/workspace',
    prepareTenant: async () => undefined,
    logger: { warn: () => undefined },
  })
  const server = createServer((request, response) => {
    void api.handle(request, response, new URL(request.url ?? '/', 'http://enterprise.test'))
  })
  const base = await listen(server)
  cleanups.push(async () => {
    await closeServer(server)
    await opened.store.close()
    await rm(dataDir, { recursive: true, force: true })
  })

  const passwordFile = await readFile(opened.initialPasswordFile, 'utf8')
  const password = /^password: (.+)$/mu.exec(passwordFile)?.[1]
  if (password === undefined) throw new Error('Initial password file is malformed')
  const login = await fetch(`${base}/enterprise/api/desktop/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: base },
    body: JSON.stringify({ email: 'owner@example.com', password, deviceName: 'Gateway Test' }),
  })
  if (login.status !== 200) throw new Error(`Desktop login failed with ${String(login.status)}`)
  const grant = await login.json() as { accessToken: string }

  return {
    base,
    store: opened.store,
    token: grant.accessToken,
    requests,
    setUpstream(next) { handler = next },
  }
}

async function callGateway(
  harness: GatewayHarness,
  path: string,
  options: GatewayRequestOptions = {},
): Promise<{ response: Response; text: string }> {
  const headers = new Headers({ 'content-type': 'application/json' })
  if (options.token !== undefined) headers.set('authorization', `Bearer ${options.token}`)
  if (options.requestId !== undefined) headers.set('x-dsh-request-id', options.requestId)
  if (options.sessionId !== undefined) headers.set('x-dsh-session-id', options.sessionId)
  const body = options.method === 'GET' ? undefined : JSON.stringify(options.body ?? {
    model: 'client-selected-model',
    messages: [{ role: 'user', content: 'Hello' }],
    stream: true,
  })
  const response = await fetch(`${harness.base}/enterprise/api/desktop/gateway/${path}`, {
    method: options.method ?? 'POST',
    headers,
    ...(body === undefined ? {} : { body }),
  })
  return { response, text: await response.text() }
}

async function waitForAttempt(
  store: EnterpriseStore,
  requestId: string,
  status?: DesktopGatewayAttemptRecord['status'],
): Promise<DesktopGatewayAttemptRecord> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const record = store.desktopGatewayAttempt('team-default', requestId)
    if (record !== undefined && (status === undefined || record.status === status)) return record
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  throw new Error(`Gateway attempt ${requestId} did not reach ${status ?? 'a terminal state'}`)
}

async function waitFor(predicate: () => boolean, message: string): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  throw new Error(message)
}

function sse(events: readonly unknown[], end = true): string {
  const data = events.map(event => `data: ${JSON.stringify(event)}\n\n`).join('')
  return end ? `${data}data: [DONE]\n\n` : data
}

describe('Desktop model gateway', () => {
  it('forwards a streaming response without changing provider chunks', async () => {
    const harness = await startHarness()
    const first = 'data: {"id":"chunk-1","choices":[{"delta":{"content":"织"}}]}\n'
    const second = sse([{
      id: 'chunk-2',
      choices: [],
      usage: { prompt_tokens: 7, completion_tokens: 3 },
    }])
    harness.setUpstream((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      response.write(first)
      setTimeout(() => { response.end(second) }, 5)
    })

    const result = await callGateway(harness, 'model-deepseek-chat/chat/completions', {
      token: harness.token,
      requestId: 'request-stream-1',
      sessionId: 'session-1',
    })

    expect(result.response.status).toBe(200)
    expect(result.response.headers.get('content-type')).toBe('text/event-stream')
    expect(result.text).toBe(first + second)
    expect(harness.requests).toHaveLength(1)
    expect(harness.requests[0]).toMatchObject({
      method: 'POST',
      path: '/v1/chat/completions',
      authorization: 'Bearer upstream-secret',
      contentType: 'application/json',
    })
    expect(JSON.parse(harness.requests[0]?.body.toString('utf8') ?? '{}')).toMatchObject({
      model: 'deepseek-chat',
      messages: [{ role: 'user', content: 'Hello' }],
      stream: true,
    })
    expect(await waitForAttempt(harness.store, 'request-stream-1')).toMatchObject({
      teamId: 'team-default',
      userId: 'user-owner',
      modelId: 'model-deepseek-chat',
      channelId: 'channel-deepseek',
      sessionId: 'session-1',
      status: 'completed',
      inputTokens: 7,
      outputTokens: 3,
    })
    expect(harness.store.usageReport({ teamId: 'team-default', limit: 10 }).summary).toMatchObject({
      requests: 1,
      inputTokens: 7,
      outputTokens: 3,
    })
  })

  it('completes a stream that crosses the remaining quota and rejects the next request', async () => {
    const harness = await startHarness()
    await harness.store.mutate((draft) => {
      const plan = draft.plans.find(candidate => candidate.id === 'plan-starter')
      if (plan === undefined) throw new Error('seed plan is missing')
      plan.monthlyCredits = 100
    })
    harness.setUpstream((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      response.end(sse([{
        choices: [],
        usage: { prompt_tokens: 60, completion_tokens: 50 },
      }]))
    })

    const first = await callGateway(harness, 'model-deepseek-chat/chat/completions', {
      token: harness.token,
      requestId: 'request-quota-1',
    })
    expect(first.response.status).toBe(200)
    expect(await waitForAttempt(harness.store, 'request-quota-1')).toMatchObject({
      status: 'completed',
      inputTokens: 60,
      outputTokens: 50,
    })

    const second = await callGateway(harness, 'model-deepseek-chat/chat/completions', {
      token: harness.token,
      requestId: 'request-quota-2',
    })
    expect(second.response.status).toBe(402)
    expect(JSON.parse(second.text)).toEqual({
      error: { code: 'quota_exhausted', message: '本月团队 Token 额度已用完' },
    })
    expect(harness.requests).toHaveLength(1)
    expect(harness.store.desktopGatewayAttempt('team-default', 'request-quota-2')).toBeUndefined()
  })

  it('forwards tool calls, reasoning fields, and images unchanged', async () => {
    const harness = await startHarness()
    const providerBody = '{"id":"response-1","choices":[{"message":{"reasoning_content":"plan","tool_calls":[{"id":"call-1","type":"function","function":{"name":"read_file","arguments":"{\\"path\\":\\"a.txt\\"}"}}]}}],"image":{"url":"https://images.example.com/result.png"},"usage":{"prompt_tokens":11,"completion_tokens":13}}'
    harness.setUpstream((_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(providerBody)
    })
    const body = {
      model: 'client-selected-model',
      stream: false,
      reasoning_effort: 'high',
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: 'Inspect this image' },
          { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } },
        ],
      }],
      tools: [{ type: 'function', function: { name: 'read_file', parameters: { type: 'object' } } }],
    }

    const result = await callGateway(harness, 'model-deepseek-chat/chat/completions', {
      token: harness.token,
      requestId: 'request-fields-1',
      body,
    })

    expect(result.response.status).toBe(200)
    expect(result.text).toBe(providerBody)
    const forwarded = JSON.parse(harness.requests[0]?.body.toString('utf8') ?? '{}') as Record<string, unknown>
    expect(forwarded).toMatchObject({ ...body, model: 'deepseek-chat' })
    expect(await waitForAttempt(harness.store, 'request-fields-1', 'completed')).toMatchObject({
      inputTokens: 11,
      outputTokens: 13,
    })
    expect(harness.store.usageReport({ teamId: 'team-default', limit: 10 }).records[0]).toMatchObject({
      inputTokens: 11,
      outputTokens: 13,
    })
  })

  it('aborts the upstream request when the client disconnects', async () => {
    const harness = await startHarness()
    let upstreamClosed = false
    harness.setUpstream((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      response.write('data: {"choices":[{"delta":{"content":"started"}}]}\n\n')
      response.on('close', () => { upstreamClosed = true })
    })
    const controller = new AbortController()
    const response = await fetch(
      `${harness.base}/enterprise/api/desktop/gateway/model-deepseek-chat/chat/completions`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${harness.token}`,
          'content-type': 'application/json',
          'x-dsh-request-id': 'request-abort-1',
        },
        body: JSON.stringify({ model: 'deepseek-chat', messages: [], stream: true }),
        signal: controller.signal,
      },
    )
    expect(response.status).toBe(200)
    await response.body?.getReader().read()
    controller.abort()

    expect(await waitForAttempt(harness.store, 'request-abort-1', 'failed')).toMatchObject({
      status: 'failed',
      inputTokens: 0,
      outputTokens: 0,
    })
    await waitFor(() => upstreamClosed, 'Upstream connection remained open after client disconnect')
    expect(harness.store.usageReport({ teamId: 'team-default', limit: 10 }).records).toHaveLength(0)
  })

  it('deduplicates a repeated request identity before upstream dispatch', async () => {
    const harness = await startHarness()
    harness.setUpstream((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      response.end(sse([{ choices: [], usage: { prompt_tokens: 2, completion_tokens: 1 } }]))
    })

    const first = await callGateway(harness, 'model-deepseek-chat/chat/completions', {
      token: harness.token,
      requestId: 'request-replay-1',
    })
    expect(first.response.status).toBe(200)
    await waitForAttempt(harness.store, 'request-replay-1', 'completed')

    const replay = await callGateway(harness, 'model-deepseek-chat/chat/completions', {
      token: harness.token,
      requestId: 'request-replay-1',
    })
    expect(replay.response.status).toBe(409)
    expect(JSON.parse(replay.text)).toEqual({ error: { code: 'request_replayed', message: '请求已处理，请勿重复提交' } })
    expect(harness.requests).toHaveLength(1)
  })

  it('rejects missing and oversized request identities before upstream dispatch', async () => {
    const harness = await startHarness()
    const missing = await callGateway(harness, 'model-deepseek-chat/chat/completions', { token: harness.token })
    expect(missing.response.status).toBe(400)
    expect(JSON.parse(missing.text)).toMatchObject({ error: { code: 'invalid_request_id' } })

    const oversized = await callGateway(harness, 'model-deepseek-chat/chat/completions', {
      token: harness.token,
      requestId: 'x'.repeat(129),
    })
    expect(oversized.response.status).toBe(400)
    expect(JSON.parse(oversized.text)).toMatchObject({ error: { code: 'invalid_request_id' } })
    expect(harness.requests).toHaveLength(0)
  })

  it('records usage_missing instead of charging zero for malformed usage', async () => {
    const harness = await startHarness()
    const providerBody = sse([{
      choices: [{ delta: { content: 'unmetered' } }],
      usage: { prompt_tokens: 'seven', completion_tokens: 3 },
    }])
    harness.setUpstream((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      response.end(providerBody)
    })

    const result = await callGateway(harness, 'model-deepseek-chat/chat/completions', {
      token: harness.token,
      requestId: 'request-missing-usage-1',
    })
    expect(result.response.status).toBe(200)
    expect(result.text).toBe(providerBody)
    expect(await waitForAttempt(harness.store, 'request-missing-usage-1', 'usage_missing')).toMatchObject({
      status: 'usage_missing',
      inputTokens: 0,
      outputTokens: 0,
    })
    expect(harness.store.usageReport({ teamId: 'team-default', limit: 10 }).records).toHaveLength(0)
  })

  it('preserves provider error status and body', async () => {
    const harness = await startHarness()
    const providerBody = '{"error":{"message":"rate limited","type":"rate_limit_error"}}'
    harness.setUpstream((_request, response) => {
      response.writeHead(429, { 'content-type': 'application/json', 'retry-after': '30' })
      response.end(providerBody)
    })

    const result = await callGateway(harness, 'model-deepseek-chat/chat/completions', {
      token: harness.token,
      requestId: 'request-provider-error-1',
    })
    expect(result.response.status).toBe(429)
    expect(result.response.headers.get('content-type')).toBe('application/json')
    expect(result.text).toBe(providerBody)
    expect(await waitForAttempt(harness.store, 'request-provider-error-1', 'failed')).toMatchObject({
      status: 'failed',
      inputTokens: 0,
      outputTokens: 0,
    })
    expect(harness.store.usageReport({ teamId: 'team-default', limit: 10 }).records).toHaveLength(0)
  })

  it('fails closed when the upstream is unavailable', async () => {
    const harness = await startHarness()
    harness.setUpstream((_request, response) => { response.destroy() })

    const result = await callGateway(harness, 'model-deepseek-chat/chat/completions', {
      token: harness.token,
      requestId: 'request-upstream-down-1',
    })
    expect(result.response.status).toBe(502)
    expect(JSON.parse(result.text)).toMatchObject({ error: { code: 'upstream_unavailable' } })
    expect(result.text).not.toContain('upstream-secret')
    expect(await waitForAttempt(harness.store, 'request-upstream-down-1', 'failed')).toMatchObject({
      status: 'failed',
      inputTokens: 0,
      outputTokens: 0,
    })
    expect(harness.requests).toHaveLength(1)
    expect(harness.store.usageReport({ teamId: 'team-default', limit: 10 }).records).toHaveLength(0)
  })

  it('rejects unsupported upstream paths and non-POST methods before upstream dispatch', async () => {
    const harness = await startHarness()
    const path = await callGateway(harness, 'model-deepseek-chat/embeddings', {
      token: harness.token,
      requestId: 'request-path-1',
    })
    expect(path.response.status).toBe(400)
    expect(JSON.parse(path.text)).toMatchObject({ error: { code: 'invalid_upstream_path' } })

    const method = await callGateway(harness, 'model-deepseek-chat/chat/completions', {
      token: harness.token,
      requestId: 'request-method-1',
      method: 'GET',
    })
    expect(method.response.status).toBe(405)
    expect(JSON.parse(method.text)).toMatchObject({ error: { code: 'method_not_allowed' } })
    expect(harness.requests).toHaveLength(0)
  })
})

describe('provider usage parser', () => {
  it('reads OpenAI Responses completion usage from a streaming event', () => {
    const body = sse([{
      type: 'response.completed',
      response: { usage: { input_tokens: 17, output_tokens: 19 } },
    }])
    expect(parseProviderUsage('openai-responses', body)).toEqual({ inputTokens: 17, outputTokens: 19 })
  })

  it('combines Anthropic message start input and message delta output usage', () => {
    const body = sse([
      { type: 'message_start', message: { usage: { input_tokens: 23, output_tokens: 0 } } },
      { type: 'message_delta', usage: { output_tokens: 29 } },
    ])
    expect(parseProviderUsage('anthropic-messages', body)).toEqual({ inputTokens: 23, outputTokens: 29 })
  })

  it('rejects partial malformed usage instead of treating it as zero', () => {
    const body = sse([{ usage: { prompt_tokens: 12 } }])
    expect(parseProviderUsage('openai-chat', body)).toBeUndefined()
  })
})
