import { createServer, type IncomingHttpHeaders, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import type { EnterpriseRequestSession } from '../src/api.ts'
import { TenantGateway } from '../src/tenant-router.ts'
import type { TenantRuntimeLease } from '../src/tenant-runtime.ts'
import type { EnterpriseData, TeamRecord, UserRecord } from '../src/types.ts'

const NOW = '2026-10-30T00:00:00.000Z'

const teams: TeamRecord[] = [
  { id: 'team-a', name: 'Acme', slug: 'acme', planId: 'plan-a', status: 'active', seatLimit: 10, notes: '', createdAt: NOW },
  { id: 'team-b', name: 'Beta', slug: 'beta', planId: 'plan-a', status: 'active', seatLimit: 10, notes: '', createdAt: NOW },
  { id: 'team-suspended', name: 'Paused', slug: 'paused', planId: 'plan-a', status: 'suspended', seatLimit: 10, notes: '', createdAt: NOW },
]

function user(id: string, teamId: string): UserRecord {
  return {
    id,
    email: `${id}@example.com`,
    name: id,
    passwordHash: 'unused',
    roleId: 'role-member',
    teamId,
    status: 'active',
    sessionVersion: 1,
    createdAt: NOW,
  }
}

function data(): EnterpriseData {
  return {
    version: 1,
    users: [],
    teams,
    roles: [],
    plans: [],
    orders: [],
    channels: [],
    models: [],
    plugins: [],
    usage: [],
    audit: [],
    settings: {
      registrationEnabled: false,
      defaultRoleId: 'role-member',
      defaultTeamId: 'team-a',
      defaultPlanId: 'plan-a',
      sessionMaxAgeDays: 30,
      supportEmail: 'support@example.com',
      brandName: 'Enterprise Test',
    },
  }
}

interface Upstream {
  readonly port: number
  readonly requests: Array<{ url: string | undefined; headers: IncomingHttpHeaders }>
  close(): Promise<void>
}

async function startUpstream(): Promise<Upstream> {
  const requests: Upstream['requests'] = []
  const server = createServer((request, response) => {
    requests.push({ url: request.url, headers: request.headers })
    response.setHeader('set-cookie', ['dsh-auth-internal=secret; Path=/; HttpOnly'])
    response.setHeader('content-type', 'text/html; charset=utf-8')
    response.end('<!doctype html><html><head><title>DSH Local Build</title></head><body><main>Tenant workspace</main></body></html>')
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  return {
    port: (server.address() as AddressInfo).port,
    requests,
    close: () => new Promise<void>((resolve) => { server.close(() => { resolve() }) }),
  }
}

interface GatewayHarness {
  readonly base: string
  readonly server: Server
  readonly runtimeCalls: string[]
  readonly upgrades: string[]
  close(): Promise<void>
}

async function startGateway(upstream: Upstream, publicPathPrefix = ''): Promise<GatewayHarness> {
  const runtimeCalls: string[] = []
  const upgrades: string[] = []
  const sessions: Record<string, EnterpriseRequestSession> = {
    'owner-a': { kind: 'member', user: user('owner-a', 'team-a'), permissions: ['workspace.use'] },
    'owner-b': { kind: 'member', user: user('owner-b', 'team-b'), permissions: ['workspace.use'] },
    'owner-paused': { kind: 'member', user: user('owner-paused', 'team-suspended'), permissions: ['workspace.use'] },
    'reader-a': { kind: 'member', user: user('reader-a', 'team-a'), permissions: [] },
  }
  const gateway = new TenantGateway({
    publicPathPrefix,
    store: { snapshot: data },
    runtime: {
      ensureTenant: async (team) => {
        runtimeCalls.push(team.id)
        return {
          port: upstream.port,
          cookie: 'dsh-auth-internal=secret',
          begin: () => () => undefined,
        } satisfies TenantRuntimeLease
      },
    },
    authenticate: (request) => {
      const name = request.headers['x-test-session']
      return typeof name === 'string' ? sessions[name] : undefined
    },
    webServer: {
      registerUpgrade: (route) => {
        upgrades.push(route.path)
        return () => undefined
      },
    },
    logger: { warn: () => undefined },
  })
  const server = createServer((request, response) => {
    void gateway.handleHttp(request, response, new URL(request.url ?? '/', 'http://tenant.test'))
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  return {
    base: `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`,
    server,
    runtimeCalls,
    upgrades,
    close: async () => {
      gateway.close()
      await new Promise<void>((resolve) => { server.close(() => { resolve() }) })
    },
  }
}

const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  await Promise.all(cleanups.splice(0).reverse().map(cleanup => cleanup()))
})

function sessionHeader(id: string): HeadersInit {
  return { 'x-test-session': id }
}

describe.sequential('tenant gateway routing', () => {
  it('preserves a public subpath in login, injected guard, forwarding, and mount redirects', async () => {
    const upstream = await startUpstream()
    const gateway = await startGateway(upstream, '/preview')
    cleanups.push(gateway.close, upstream.close)
    const guest = await fetch(`${gateway.base}/t/acme/harness/?view=chat`, { redirect: 'manual' })
    expect(guest.headers.get('location')).toBe('/preview/enterprise/login?next=%2Fpreview%2Ft%2Facme%2Fharness%2F%3Fview%3Dchat')
    const page = await fetch(`${gateway.base}/t/acme/harness/`, { headers: sessionHeader('owner-a') })
    expect(await page.text()).toContain('src="/preview/enterprise/session-guard.js"')
    expect(upstream.requests[0]?.headers['x-forwarded-prefix']).toBe('/preview/t/acme/harness')
    const mount = await fetch(`${gateway.base}/t/acme/harness`, { redirect: 'manual' })
    expect(mount.headers.get('location')).toBe('/preview/t/acme/harness/')
  })

  it('redirects unauthenticated requests without starting a tenant process', async () => {
    const upstream = await startUpstream()
    const gateway = await startGateway(upstream)
    cleanups.push(gateway.close, upstream.close)

    const response = await fetch(`${gateway.base}/t/acme/harness/?view=chat`, { redirect: 'manual' })
    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe('/enterprise/login?next=%2Ft%2Facme%2Fharness%2F%3Fview%3Dchat')
    expect(gateway.runtimeCalls).toEqual([])
  })

  it('proxies its own tenant, injects the guard, and never leaks upstream cookies', async () => {
    const upstream = await startUpstream()
    const gateway = await startGateway(upstream)
    cleanups.push(gateway.close, upstream.close)

    const response = await fetch(`${gateway.base}/t/acme/harness/`, { headers: sessionHeader('owner-a') })
    expect(response.status).toBe(200)
    expect(response.headers.get('set-cookie')).toBeNull()
    const page = await response.text()
    expect(page).toContain('<html data-dsh-enterprise="">')
    expect(page).toContain('<title>织流</title>')
    expect(page).not.toContain('DSH Local Build')
    expect(page).toContain('data-dsh-tenant-guard')
    expect(gateway.runtimeCalls).toEqual(['team-a'])
    expect(gateway.upgrades).toEqual(['/t/acme/harness/api/remote.mux'])

    const request = upstream.requests[0]
    expect(request?.url).toBe('/')
    expect(request?.headers.cookie).toBe('dsh-auth-internal=secret')
    expect(request?.headers.host).toBe(`127.0.0.1:${String(upstream.port)}`)
    expect(request?.headers['x-forwarded-prefix']).toBe('/t/acme/harness')
  })

  it('denies cross-tenant, suspended, unknown, and unauthorized access', async () => {
    const upstream = await startUpstream()
    const gateway = await startGateway(upstream)
    cleanups.push(gateway.close, upstream.close)

    const crossTenant = await fetch(`${gateway.base}/t/acme/harness/`, { headers: sessionHeader('owner-b') })
    expect(crossTenant.status).toBe(403)
    expect(await crossTenant.json()).toMatchObject({ error: { code: 'tenant_forbidden' } })

    const suspended = await fetch(`${gateway.base}/t/paused/harness/`, { headers: sessionHeader('owner-paused') })
    expect(suspended.status).toBe(403)
    expect(await suspended.json()).toMatchObject({ error: { code: 'tenant_suspended' } })

    const unknown = await fetch(`${gateway.base}/t/missing/harness/`, { headers: sessionHeader('owner-a') })
    expect(unknown.status).toBe(404)
    expect(await unknown.json()).toMatchObject({ error: { code: 'tenant_not_found' } })

    const unauthorized = await fetch(`${gateway.base}/t/acme/harness/`, { headers: sessionHeader('reader-a') })
    expect(unauthorized.status).toBe(403)
    expect(await unauthorized.json()).toMatchObject({ error: { code: 'forbidden' } })
    expect(gateway.runtimeCalls).toEqual([])
    expect(upstream.requests).toEqual([])
  })

  it('redirects a mount without its trailing slash before authentication', async () => {
    const upstream = await startUpstream()
    const gateway = await startGateway(upstream)
    cleanups.push(gateway.close, upstream.close)

    const response = await fetch(`${gateway.base}/t/acme/harness?x=1`, { redirect: 'manual' })
    expect(response.status).toBe(308)
    expect(response.headers.get('location')).toBe('/t/acme/harness/?x=1')
  })

  it('keeps plugin-manager reads and rejects every other plugin call before RPC', async () => {
    const upstream = await startUpstream()
    const gateway = await startGateway(upstream)
    cleanups.push(gateway.close, upstream.close)

    const read = await fetch(`${gateway.base}/t/acme/harness/api/pluginManager/listBundles`, {
      method: 'POST',
      headers: { ...sessionHeader('owner-a'), 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId: 'rpc-read', method: 'listBundles', params: [] }),
    })
    expect(read.status).toBe(200)
    expect(await read.text()).toContain('data-dsh-tenant-guard')
    expect(upstream.requests.map(request => request.url)).toEqual(['/api/pluginManager/listBundles'])

    for (const method of ['installBundle', '%69nstallBundle', 'setBundleEnabled/']) {
      const response = await fetch(`${gateway.base}/t/acme/harness/api/pluginManager/${method}`, {
        method: 'POST',
        headers: { ...sessionHeader('owner-a'), 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'client-request', rpcId: `rpc-${method}`, method, params: [] }),
      })
      expect(response.status).toBe(200)
      expect(await response.json()).toMatchObject({
        type: 'server-response',
        rpcId: `rpc-${method}`,
        result: { ok: false, error: { code: 'enterprise/plugin-admin-only' } },
      })
    }
    expect(upstream.requests).toHaveLength(1)
  })
})
