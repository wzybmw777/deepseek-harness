import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import WebServer from '@deepseek-ai/dsh-host-webserver'
import { installEnterpriseBillingRoute } from '../src/host/billing-route.ts'
import type { EnterpriseBootstrapPort, EnterpriseCloudTransport } from '../src/host/cloud-transport.ts'

const contexts: Context[] = []

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(async (ctx) => { await ctx.fiber.dispose() }))
})

function bootstrap(origin = 'https://cloud.example.com'): EnterpriseBootstrapPort {
  const value = {
    cloudBaseUrl: origin,
    accessToken: 'access-a',
    accessExpiresAt: '2026-11-04T01:00:00.000Z',
    profileKey: 'a'.repeat(64),
    user: { id: 'user-a', email: 'a@example.com', name: 'Alice', roleId: 'member' },
    team: { id: 'team-a', name: 'Team A', slug: 'team-a' },
  }
  return { current: () => value, refresh: async current => current }
}

async function harness(response = new Response(JSON.stringify({
  quota: {
    planName: '团队版', totalTokens: 5_000_000, usedTokens: 1_660, remainingTokens: 4_998_340,
    userTokens: 1_500, cycleStartsAt: '2026-11-01T00:00:00.000Z', cycleEndsAt: '2026-12-01T00:00:00.000Z',
  },
  planName: '团队版',
  updatedAt: '2026-11-04T00:00:00.000Z',
}), { status: 200, headers: { 'content-type': 'application/json' } })) {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0, compression: 'none' })
  const request = vi.fn(async () => response.clone())
  installEnterpriseBillingRoute(ctx, { request } as unknown as EnterpriseCloudTransport, bootstrap())
  return { ctx, request }
}

describe('enterprise billing route', () => {
  it('returns only the quota projection and the pinned purchase page', async () => {
    const { ctx, request } = await harness()

    const response = await fetch(`${ctx.webServer.getOrigin()}/enterprise/api/desktop/billing`)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      quota: {
        planName: '团队版', totalTokens: 5_000_000, usedTokens: 1_660, remainingTokens: 4_998_340,
        userTokens: 1_500, cycleStartsAt: '2026-11-01T00:00:00.000Z', cycleEndsAt: '2026-12-01T00:00:00.000Z',
      },
      planName: '团队版',
      updatedAt: '2026-11-04T00:00:00.000Z',
      purchaseUrl: 'https://cloud.example.com/enterprise/billing',
    })
    expect(request).toHaveBeenCalledWith({
      path: '/enterprise/api/desktop/billing',
      method: 'GET',
      headers: { accept: 'application/json' },
    })
  })

  it('rejects non-GET requests without contacting the cloud', async () => {
    const { ctx, request } = await harness()

    const response = await fetch(`${ctx.webServer.getOrigin()}/enterprise/api/desktop/billing`, { method: 'POST' })

    expect(response.status).toBe(405)
    expect(request).not.toHaveBeenCalled()
  })
})
