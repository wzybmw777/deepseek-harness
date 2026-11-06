import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime, { createUserMessage, LlmRequestId } from '@deepseek-ai/dsh-llm'
import WebServer from '@deepseek-ai/dsh-host-webserver'
import { installEnterpriseModelRoute, type EnterpriseDesktopCatalog } from '../src/host/model-route.ts'
import type { EnterpriseCloudTransport } from '../src/host/cloud-transport.ts'

const contexts: Context[] = []

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(async (ctx) => { await ctx.fiber.dispose() }))
})

function catalog(overrides: Partial<EnterpriseDesktopCatalog> = {}): EnterpriseDesktopCatalog {
  return {
    refreshedAt: '2026-11-04T00:00:00.000Z',
    quota: {
      planName: 'Team', totalTokens: 100_000, usedTokens: 10_000, remainingTokens: 90_000,
      userTokens: 1_000, cycleStartsAt: '2026-11-01T00:00:00.000Z', cycleEndsAt: '2026-12-01T00:00:00.000Z',
    },
    models: [{
      id: 'model-a', name: 'Model A', protocol: 'openai-chat',
      gatewayBasePath: '/enterprise/api/desktop/gateway/model-a',
      upstreamModelId: 'upstream-a', contextWindow: 64_000, capabilities: ['text', 'image'],
    }],
    ...overrides,
  }
}

function textResponse(): Response {
  const events = [
    '{"choices":[{"delta":{"role":"assistant","content":""},"index":0,"finish_reason":null}]}',
    '{"choices":[{"delta":{"content":"hello"},"index":0,"finish_reason":null}]}',
    '{"choices":[{"delta":{},"index":0,"finish_reason":"stop"}],"usage":{"prompt_tokens":3,"completion_tokens":1}}',
    '[DONE]',
  ]
  return new Response(events.map(event => `data: ${event}\n\n`).join(''), {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  })
}

async function harness(options: {
  readonly catalog?: EnterpriseDesktopCatalog
  readonly transport?: Pick<EnterpriseCloudTransport, 'request'>
} = {}) {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0, compression: 'none' })
  const transport = options.transport ?? { request: vi.fn(async () => textResponse()) }
  const install = () => installEnterpriseModelRoute(
    ctx,
    transport as EnterpriseCloudTransport,
    options.catalog ?? catalog(),
    ctx.webServer.getOrigin(),
  )
  return { ctx, transport, install }
}

async function chunks(ctx: Context, requestId = LlmRequestId('req-a')) {
  const result = []
  for await (const chunk of ctx.llm.stream({
    provider: 'enterprise-gateway',
    model: 'model-a',
    requestId,
    sessionId: 'session-a' as never,
    messages: [createUserMessage({ content: [{ type: 'text', text: 'hi' }], source: { kind: 'user' } })],
  })) result.push(chunk)
  return result
}

describe('enterprise model route', () => {
  it('registers only the enterprise gateway provider from the catalog', async () => {
    const { ctx, install } = await harness()
    install()

    expect(ctx.llm.listProviders()).toEqual([{ id: 'enterprise-gateway', name: '企业模型网关' }])
    await expect(ctx.llm.listModels('enterprise-gateway')).resolves.toMatchObject([
      { provider: 'enterprise-gateway', id: 'model-a', name: 'Model A' },
    ])
  })

  it('stamps the same request identity into headers and the gateway path', async () => {
    const request = vi.fn<EnterpriseCloudTransport['request']>(async () => textResponse())
    const { ctx, install } = await harness({ transport: { request } })
    install()

    const result = await chunks(ctx)

    expect(result.at(-1)).toMatchObject({ type: 'finish', reason: { kind: 'stop' } })
    expect(request).toHaveBeenCalledOnce()
    const input = request.mock.calls[0]?.[0]
    if (input === undefined) throw new Error('expected the model route to call the transport')
    expect(input.path).toBe('/enterprise/api/desktop/gateway/model-a/chat/completions')
    expect(input.headers['x-dsh-request-id']).toBe('req-a')
    expect(input.headers['x-dsh-session-id']).toBe('session-a')
    expect(input.headers.authorization).toBe('enterprise-session')
  })

  it('keeps models on their own protocol and gateway path', async () => {
    const request = vi.fn<EnterpriseCloudTransport['request']>(async () => textResponse())
    const { ctx, install } = await harness({
      catalog: catalog({
        models: [
          catalog().models[0]!,
          {
            id: 'model-b', name: 'Model B', protocol: 'anthropic-messages',
            gatewayBasePath: '/enterprise/api/desktop/gateway/model-b',
            upstreamModelId: 'upstream-b', contextWindow: 128_000, capabilities: ['text'],
          },
        ],
      }),
      transport: { request },
    })
    install()

    const result = []
    for await (const chunk of ctx.llm.stream({
      provider: 'enterprise-gateway',
      model: 'model-b',
      requestId: LlmRequestId('req-b'),
      messages: [createUserMessage({ content: [{ type: 'text', text: 'hi' }], source: { kind: 'user' } })],
    })) result.push(chunk)

    expect(request.mock.calls[0]?.[0]).toMatchObject({
      path: '/enterprise/api/desktop/gateway/model-b/v1/messages',
    })
    expect(result.at(-1)).toMatchObject({ type: 'finish', reason: { kind: 'error' } })
  })

  it('rejects a catalog with an unsupported protocol', async () => {
    const { ctx, install } = await harness({
      catalog: catalog({ models: [{ ...catalog().models[0]!, protocol: 'legacy-wire' }] }),
    })

    expect(() => install()).toThrow('unsupported protocol')
    expect(ctx.llm.listProviders()).toEqual([])
  })

  it('returns quota_exhausted without a direct-provider retry', async () => {
    const request = vi.fn<EnterpriseCloudTransport['request']>(async () => textResponse())
    const exhausted = catalog()
    const { ctx, install } = await harness({
      catalog: catalog({ quota: { ...exhausted.quota, usedTokens: 100_000, remainingTokens: 0 } }),
      transport: { request },
    })
    install()

    const result = await chunks(ctx)

    const finish = result.at(-1)
    expect(finish?.type).toBe('finish')
    if (finish?.type !== 'finish' || finish.reason.kind !== 'error') throw new Error('expected a failed model request')
    expect(finish.reason.failure.code).toBe('quota_exhausted')
    expect(request).not.toHaveBeenCalled()
  })
})
