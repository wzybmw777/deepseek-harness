import { expect, it } from 'vitest'
import { createEnterpriseHostBootstrap, EnterpriseBootstrapError, validateEnterpriseHostBootstrap } from '../src/enterprise-bootstrap.ts'

const profileKey = 'a'.repeat(32)
const value = {
  cloudBaseUrl: 'https://cloud.example.com',
  accessToken: 'access-token',
  accessExpiresAt: new Date(Date.now() + 60_000).toISOString(),
  profileKey,
  user: { id: 'user-a', email: 'a@example.com', name: 'Alice', roleId: 'member' },
  team: { id: 'team-a', name: 'Team A', slug: 'team-a' },
}

it('accepts one validated bootstrap and freezes the Host payload', () => {
  const parsed = validateEnterpriseHostBootstrap(value)
  expect(parsed).toEqual(value)
  expect(Object.isFrozen(parsed)).toBe(true)
  expect(Object.isFrozen(parsed.user)).toBe(true)
})

it('rejects refresh credentials and malformed profile keys', () => {
  expect(() => validateEnterpriseHostBootstrap({ ...value, refreshToken: 'secret' })).toThrow(EnterpriseBootstrapError)
  expect(() => validateEnterpriseHostBootstrap({ ...value, profileKey: 'email@example.com' })).toThrow(EnterpriseBootstrapError)
  expect(() => validateEnterpriseHostBootstrap({ ...value, profileKey: 'a'.repeat(64) })).toThrow(EnterpriseBootstrapError)
})

it('rejects credentials embedded in an origin URL', () => {
  expect(() => validateEnterpriseHostBootstrap({ ...value, cloudBaseUrl: 'https://user:pass@cloud.example.com' }))
    .toThrow(EnterpriseBootstrapError)
})

it('builds only the short-lived access grant from an enterprise session', () => {
  expect(createEnterpriseHostBootstrap({
    accessToken: value.accessToken,
    accessExpiresAt: value.accessExpiresAt,
    bootstrap: {
      apiVersion: 1,
      cloudBaseUrl: value.cloudBaseUrl,
      profileKey: value.profileKey,
      accessExpiresAt: value.accessExpiresAt,
      user: value.user,
      team: value.team,
      minimumClientVersion: '0.1.0',
      policy: { consumerAnalytics: false, crashReports: 'enterprise-support', supportEmail: 'support@example.com' },
      endpoints: {
        bootstrap: '/enterprise/api/desktop/bootstrap', models: '/enterprise/api/desktop/models',
        resources: '/enterprise/api/desktop/resources', sessions: '/enterprise/api/desktop/sessions',
        plugins: '/enterprise/api/desktop/plugins', billing: '/enterprise/api/desktop/billing',
      },
    },
  })).toEqual(value)
})
