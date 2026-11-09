import { Context } from '@deepseek-ai/cordis'
import { expect, it } from 'vitest'
import {
  EnterpriseBootstrapService, installEnterpriseBootstrap, parseEnterpriseHostBootstrap,
} from '../src/enterprise-bootstrap.ts'

const value = {
  cloudBaseUrl: 'https://cloud.example.com',
  accessToken: 'access-token',
  accessExpiresAt: new Date(Date.now() + 60_000).toISOString(),
  profileKey: 'a'.repeat(32),
  user: { id: 'user-a', email: 'a@example.com', name: 'Alice', roleId: 'member' },
  team: { id: 'team-a', name: 'Team A', slug: 'team-a' },
}

it('accepts one validated bootstrap and rejects the refresh token field', () => {
  expect(parseEnterpriseHostBootstrap(value, 'https://cloud.example.com')).toEqual(value)
  expect(() => parseEnterpriseHostBootstrap({ ...value, refreshToken: 'secret' }, 'https://cloud.example.com'))
    .toThrow('bootstrap is invalid')
})

it('rejects a profile key outside the 32-character Desktop contract', () => {
  expect(() => parseEnterpriseHostBootstrap({ ...value, profileKey: 'a'.repeat(64) }, 'https://cloud.example.com'))
    .toThrow('bootstrap is invalid')
})

it('rejects a bootstrap for a different pinned cloud origin', () => {
  expect(() => parseEnterpriseHostBootstrap(value, 'https://other.example.com')).toThrow('origin changed')
})

it('replaces an expiring token for the same identity and clears it before shutdown', () => {
  const ctx = new Context()
  const service: EnterpriseBootstrapService = installEnterpriseBootstrap(ctx, Object.freeze(value))
  service.replace({ ...value, accessToken: 'next-token' })
  expect(service.current()?.accessToken).toBe('next-token')
  expect(() => { service.replace({ ...value, user: { ...value.user, id: 'other' } }) }).toThrow('identity changed')
  service.clear()
  expect(service.current()).toBeUndefined()
})
