import { afterEach, expect, it, vi } from 'vitest'
import { EnterpriseAuthTransportError, EnterpriseSignOutRequired, type EnterpriseAuthSession } from '../src/enterprise-auth.ts'
import { EnterpriseAccessRefresh } from '../src/enterprise-refresh.ts'

const session = (expiresAt: number): EnterpriseAuthSession => ({
  accessToken: 'access',
  accessExpiresAt: new Date(expiresAt).toISOString(),
  bootstrap: {
    apiVersion: 1, cloudBaseUrl: 'https://cloud.example.com', profileKey: 'a'.repeat(64),
    accessExpiresAt: new Date(expiresAt).toISOString(),
    user: { id: 'user-a', email: 'a@example.com', name: 'Alice', roleId: 'member' },
    team: { id: 'team-a', name: 'Team A', slug: 'team-a' }, minimumClientVersion: '0.1.0',
    policy: { consumerAnalytics: false, crashReports: 'enterprise-support', supportEmail: 'support@example.com' },
    endpoints: {
      bootstrap: '/enterprise/api/desktop/bootstrap', models: '/enterprise/api/desktop/models',
      resources: '/enterprise/api/desktop/resources', sessions: '/enterprise/api/desktop/sessions',
      plugins: '/enterprise/api/desktop/plugins', billing: '/enterprise/api/desktop/billing',
    },
  },
})

afterEach(() => { vi.useRealTimers() })

it('refreshes before expiry and applies the replacement session', async () => {
  vi.useFakeTimers()
  const now = new Date('2026-11-04T00:00:00Z').getTime()
  const refresh = vi.fn(async () => session(now + 120_000))
  const apply = vi.fn(async () => {})
  const refresher = new EnterpriseAccessRefresh({ client: { refresh }, apply, onSignOut: async () => {}, now: () => now })
  refresher.start(session(now + 61_000))
  await vi.advanceTimersByTimeAsync(1_000)
  expect(refresh).toHaveBeenCalledOnce()
  expect(apply).toHaveBeenCalledWith(expect.objectContaining({ accessToken: 'access' }))
  refresher.dispose()
})

it('backs off transport failures and reports revoked sessions', async () => {
  vi.useFakeTimers()
  const now = Date.now()
  const refresh = vi.fn()
    .mockRejectedValueOnce(new EnterpriseAuthTransportError())
    .mockRejectedValueOnce(new EnterpriseSignOutRequired())
  const signOut = vi.fn(async () => {})
  const refresher = new EnterpriseAccessRefresh({
    client: { refresh }, apply: async () => {}, onSignOut: signOut,
    retryMinMs: 1_000, retryMaxMs: 4_000, now: () => now,
  })
  refresher.start(session(now))
  await vi.advanceTimersByTimeAsync(250)
  expect(refresh).toHaveBeenCalledOnce()
  await vi.advanceTimersByTimeAsync(1_000)
  expect(refresh).toHaveBeenCalledTimes(2)
  expect(signOut).toHaveBeenCalledOnce()
  refresher.dispose()
})
