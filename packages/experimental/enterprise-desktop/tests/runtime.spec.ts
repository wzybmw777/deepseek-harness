import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import WebServer from '@deepseek-ai/dsh-host-webserver'
import { installEnterpriseDesktopRuntime } from '../src/host/runtime.ts'
import type { EnterpriseBootstrapPort } from '../src/host/cloud-transport.ts'

const contexts: Context[] = []
const originalFetch = globalThis.fetch

afterEach(async () => {
  vi.unstubAllGlobals()
  await Promise.all(contexts.splice(0).map(async (ctx) => { await ctx.fiber.dispose() }))
})

function bootstrap(): EnterpriseBootstrapPort {
  const value = {
    cloudBaseUrl: 'https://cloud.example.com',
    accessToken: 'access-a',
    accessExpiresAt: '2099-01-01T00:00:00.000Z',
    profileKey: 'a'.repeat(32),
    user: { id: 'user-a', email: 'a@example.com', name: 'Alice', roleId: 'member' },
    team: { id: 'team-a', name: 'Team A', slug: 'team-a' },
  }
  return { current: () => value, refresh: async current => current }
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
}

describe('enterprise Desktop runtime', () => {
  it('installs the catalog-backed model and billing routes together, then removes both', async () => {
    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0, compression: 'none' })
    const origin = ctx.webServer.getOrigin()
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : input)
      if (url.origin === origin) return originalFetch(input, init)
      if (url.pathname === '/enterprise/api/desktop/models') return json({
        quota: {
          planName: '团队版', totalTokens: 5_000_000, usedTokens: 1_660, remainingTokens: 4_998_340,
          userTokens: 1_500, cycleStartsAt: '2026-11-01T00:00:00.000Z', cycleEndsAt: '2026-12-01T00:00:00.000Z',
        },
        models: [{
          id: 'model-a', name: 'Model A', protocol: 'openai-chat',
          gatewayBasePath: '/enterprise/api/desktop/gateway/model-a', upstreamModelId: 'upstream-a',
          contextWindow: 64_000, capabilities: ['text'],
        }],
        refreshedAt: '2026-11-04T00:00:00.000Z',
      })
      if (url.pathname === '/enterprise/api/desktop/billing') return json({
        quota: {
          planName: '团队版', totalTokens: 5_000_000, usedTokens: 1_660, remainingTokens: 4_998_340,
          userTokens: 1_500, cycleStartsAt: '2026-11-01T00:00:00.000Z', cycleEndsAt: '2026-12-01T00:00:00.000Z',
        },
        planName: '团队版',
        updatedAt: '2026-11-04T00:00:00.000Z',
      })
      throw new Error(`unexpected cloud request: ${url.pathname}`)
    }))

    const dispose = await installEnterpriseDesktopRuntime(ctx, bootstrap())

    expect(ctx.llm.listProviders()).toEqual([{ id: 'enterprise-gateway', name: '企业模型网关' }])
    const billing = await originalFetch(`${origin}/enterprise/api/desktop/billing`)
    expect(await billing.json()).toMatchObject({ purchaseUrl: 'https://cloud.example.com/enterprise/billing' })

    dispose()
    expect(ctx.llm.listProviders()).toEqual([])
    expect((await originalFetch(`${origin}/enterprise/api/desktop/billing`)).status).toBe(404)
  })
})
