import { describe, expect, it, vi } from 'vitest'
import {
  EnterpriseCloudTransport,
  EnterpriseCloudTransportError,
  type EnterpriseAccessBootstrap,
  type EnterpriseBootstrapPort,
} from '../src/host/cloud-transport.ts'

const now = Date.parse('2026-11-04T00:00:00.000Z')

function bootstrap(accessToken = 'access-a'): EnterpriseAccessBootstrap {
  return {
    cloudBaseUrl: 'https://cloud.example.com',
    accessToken,
    accessExpiresAt: new Date(now + 60_000).toISOString(),
    profileKey: 'a'.repeat(64),
    user: { id: 'user-a', email: 'a@example.com', name: 'Alice', roleId: 'member' },
    team: { id: 'team-a', name: 'Team A', slug: 'team-a' },
  }
}

function port(
  initial: EnterpriseAccessBootstrap,
  refresh?: (value: EnterpriseAccessBootstrap) => Promise<EnterpriseAccessBootstrap>,
): EnterpriseBootstrapPort {
  let current = initial
  return {
    current: () => current,
    async refresh(value) {
      current = refresh === undefined ? { ...value, accessToken: 'access-b' } : await refresh(value)
      return current
    },
  }
}

describe('enterprise cloud transport', () => {
  it('attaches the current access token and request identity', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response('{"ok":true}', {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }))
    const transport = new EnterpriseCloudTransport({ bootstrap: port(bootstrap()), fetch, now: () => now })
    const response = await transport.request({
      path: '/enterprise/api/desktop/models',
      method: 'GET',
      headers: {
        accept: 'application/json',
        authorization: 'Bearer caller-value',
        cookie: 'session=secret',
        'x-dsh-request-id': 'req-a',
      },
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true })
    const [url, init] = fetch.mock.calls[0] ?? []
    if (!(url instanceof URL)) throw new Error('expected the transport to pass a URL')
    if (init === undefined) throw new Error('expected the transport to pass request options')
    expect(url.href).toBe('https://cloud.example.com/enterprise/api/desktop/models')
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer access-a')
    expect(new Headers(init.headers).get('x-dsh-request-id')).toBe('req-a')
    expect(new Headers(init.headers).has('cookie')).toBe(false)
    expect(init.redirect).toBe('error')
    expect(init.credentials).toBe('omit')
  })

  it('replaces an expired token through the bootstrap port before retrying', async () => {
    const refresh = vi.fn(async (value: EnterpriseAccessBootstrap) => ({ ...value, accessToken: 'access-b' }))
    const fetch = vi.fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(new Response('{"error":{"code":"expired"}}', { status: 401 }))
      .mockResolvedValueOnce(new Response('{"ok":true}', { status: 200 }))
    const transport = new EnterpriseCloudTransport({ bootstrap: port(bootstrap(), refresh), fetch, now: () => now })

    const response = await transport.request({
      path: '/enterprise/api/desktop/models', method: 'GET', headers: { accept: 'application/json' },
    })

    expect(response.status).toBe(200)
    expect(refresh).toHaveBeenCalledOnce()
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(new Headers(fetch.mock.calls[0]?.[1]?.headers).get('authorization')).toBe('Bearer access-a')
    expect(new Headers(fetch.mock.calls[1]?.[1]?.headers).get('authorization')).toBe('Bearer access-b')
  })

  it('rejects paths outside the Desktop API prefix', async () => {
    const fetch = vi.fn()
    const transport = new EnterpriseCloudTransport({ bootstrap: port(bootstrap()), fetch, now: () => now })

    for (const path of [
      'https://other.example.com/enterprise/api/desktop/models',
      '//other.example.com/enterprise/api/desktop/models',
      '/enterprise/api/admin/users',
      '/enterprise/api/desktop/../admin',
      '/enterprise/api/desktop/%2e%2e/admin',
    ]) {
      await expect(transport.request({ path, method: 'GET', headers: {} })).rejects.toMatchObject({ code: 'invalid_path' })
    }
    expect(fetch).not.toHaveBeenCalled()
  })

  it('does not follow upstream redirects', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(null, {
      status: 302,
      headers: { location: 'https://other.example.com/' },
    }))
    const transport = new EnterpriseCloudTransport({ bootstrap: port(bootstrap()), fetch, now: () => now })

    await transport.request({ path: '/enterprise/api/desktop/models', method: 'GET', headers: {} })
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({ redirect: 'error' })
  })

  it('surfaces gateway network failure without invoking a direct provider', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => { throw new TypeError('connection refused') })
    const transport = new EnterpriseCloudTransport({ bootstrap: port(bootstrap()), fetch, now: () => now })

    await expect(transport.request({
      path: '/enterprise/api/desktop/gateway/model-a/chat/completions',
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-dsh-request-id': 'req-a' },
      body: new Uint8Array([123, 125]),
    })).rejects.toMatchObject({
      name: 'EnterpriseCloudTransportError',
      code: 'gateway_unavailable',
    } satisfies Partial<EnterpriseCloudTransportError>)
    expect(fetch).toHaveBeenCalledOnce()
  })
})
