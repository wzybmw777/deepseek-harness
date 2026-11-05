import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EnterpriseCredentialStore, type EnterpriseCredentialVault } from '../src/enterprise-credentials.ts'
import { EnterpriseAuthClient, EnterpriseSignOutRequired } from '../src/enterprise-auth.ts'
import type { DesktopBootstrap } from '../src/enterprise-types.ts'

const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  await Promise.all(cleanups.splice(0).reverse().map(cleanup => cleanup()))
})

function fakeVault(): EnterpriseCredentialVault {
  return {
    isEncryptionAvailable: () => true,
    encryptString: value => Buffer.from(`sealed:${value}`),
    decryptString: value => value.toString('utf8').slice('sealed:'.length),
  }
}

function bootstrap(overrides: Partial<DesktopBootstrap> = {}): DesktopBootstrap {
  return {
    apiVersion: 1,
    cloudBaseUrl: 'https://cloud.example.com',
    profileKey: 'profile-key',
    accessExpiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
    user: { id: 'user-owner', email: 'owner@example.com', name: 'Owner', roleId: 'role-owner' },
    team: { id: 'team-default', name: 'Default', slug: 'default' },
    minimumClientVersion: '0.2.2-alpha.2',
    policy: { consumerAnalytics: false, crashReports: 'enterprise-support', supportEmail: 'support@example.com' },
    endpoints: {
      bootstrap: '/enterprise/api/desktop/bootstrap',
      models: '/enterprise/api/desktop/models',
      resources: '/enterprise/api/desktop/resources',
      sessions: '/enterprise/api/desktop/sessions',
      plugins: '/enterprise/api/desktop/plugins',
      billing: '/enterprise/api/desktop/billing',
    },
    ...overrides,
  }
}

function grant(refreshToken = 'refresh-a', deviceId = 'device-a'): Record<string, unknown> {
  return {
    deviceId,
    accessToken: 'access-a',
    accessExpiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
    refreshToken,
    refreshExpiresAt: new Date(Date.now() + 30 * 24 * 60 * 60_000).toISOString(),
    bootstrap: bootstrap(),
  }
}

async function harness(fetcher: typeof fetch): Promise<{
  client: EnterpriseAuthClient
  store: EnterpriseCredentialStore
}> {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-enterprise-auth-'))
  cleanups.push(async () => { await rm(directory, { recursive: true, force: true }) })
  const store = new EnterpriseCredentialStore({ directory, vault: fakeVault() })
  return {
    store,
    client: new EnterpriseAuthClient({
      store,
      fetch: fetcher,
      now: () => Date.now(),
      cloudBaseUrl: 'https://cloud.example.com',
    }),
  }
}

describe('enterprise desktop auth client', { concurrent: false }, () => {
  it('coalesces concurrent refreshes into one request', async () => {
    let requests = 0
    let release: (() => void) | undefined
    const pending = new Promise<void>((resolve) => { release = resolve })
    const fetcher = vi.fn(async () => {
      requests += 1
      await pending
      return new Response(JSON.stringify(grant('refresh-b')), { status: 200 })
    }) as unknown as typeof fetch
    const { client, store } = await harness(fetcher)
    await store.save({
      cloudBaseUrl: 'https://cloud.example.com',
      userId: 'user-owner',
      email: 'owner@example.com',
      deviceId: 'device-a',
      profileKey: 'profile-key',
      refreshToken: 'refresh-a',
    })

    const first = client.refresh()
    const second = client.refresh()
    await Promise.resolve()
    release?.()
    const [left, right] = await Promise.all([first, second])
    expect(requests).toBe(1)
    expect(left).toEqual(right)
    expect((await store.load('https://cloud.example.com'))?.refreshToken).toBe('refresh-b')
  })

  it('requires sign-out when the server revokes the device', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      error: { code: 'desktop_auth_revoked', message: 'revoked' },
    }), { status: 401 })) as unknown as typeof fetch
    const { client, store } = await harness(fetcher)
    await store.save({
      cloudBaseUrl: 'https://cloud.example.com',
      userId: 'user-owner',
      email: 'owner@example.com',
      deviceId: 'device-a',
      profileKey: 'profile-key',
      refreshToken: 'refresh-a',
    })

    await expect(client.refresh()).rejects.toBeInstanceOf(EnterpriseSignOutRequired)
    await expect(store.load('https://cloud.example.com')).resolves.toBeUndefined()
  })

  it('requires sign-out when the user session version changed', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      error: { code: 'desktop_auth_revoked', message: 'session changed' },
    }), { status: 401 })) as unknown as typeof fetch
    const { client, store } = await harness(fetcher)
    await store.save({
      cloudBaseUrl: 'https://cloud.example.com',
      userId: 'user-owner',
      email: 'owner@example.com',
      deviceId: 'device-a',
      profileKey: 'profile-key',
      refreshToken: 'refresh-a',
    })
    await expect(client.restore('https://cloud.example.com')).resolves.toBeUndefined()
  })

  it('drops the stored refresh token after logout succeeds', async () => {
    const fetcher = vi.fn(async () => new Response(null, { status: 204 })) as unknown as typeof fetch
    const { client, store } = await harness(fetcher)
    await store.save({
      cloudBaseUrl: 'https://cloud.example.com',
      userId: 'user-owner',
      email: 'owner@example.com',
      deviceId: 'device-a',
      profileKey: 'profile-key',
      refreshToken: 'refresh-a',
    })

    await client.logout()
    await expect(store.load('https://cloud.example.com')).resolves.toBeUndefined()
  })

  it('keeps the credential when logout fails because the network is down', async () => {
    const fetcher = vi.fn(async () => { throw new TypeError('network down') }) as unknown as typeof fetch
    const { client, store } = await harness(fetcher)
    await store.save({
      cloudBaseUrl: 'https://cloud.example.com',
      userId: 'user-owner',
      email: 'owner@example.com',
      deviceId: 'device-a',
      profileKey: 'profile-key',
      refreshToken: 'refresh-a',
    })

    await expect(client.logout()).rejects.toThrow()
    await expect(store.load('https://cloud.example.com')).resolves.toMatchObject({ refreshToken: 'refresh-a' })
  })
})
