import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { DesktopAuthError, DesktopAuthService } from '../src/desktop-auth.ts'
import { EnterpriseStore } from '../src/store.ts'

const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  await Promise.all(cleanups.splice(0).reverse().map(cleanup => cleanup()))
})

async function openHarness(): Promise<{ dataDir: string; password: string; service: DesktopAuthService; store: EnterpriseStore }> {
  const dataDir = await mkdtemp(join(tmpdir(), 'dsh-enterprise-desktop-auth-'))
  const opened = await EnterpriseStore.open(dataDir, 'owner@example.com', 'Enterprise Test')
  const initialPassword = await readFile(opened.initialPasswordFile, 'utf8')
  const password = /^password: (.+)$/mu.exec(initialPassword)?.[1]
  if (password === undefined) throw new Error('Initial password file is malformed')
  cleanups.push(async () => {
    await opened.store.close()
    await rm(dataDir, { recursive: true, force: true })
  })
  return { dataDir, password, service: new DesktopAuthService(opened.store), store: opened.store }
}

describe('enterprise desktop authentication', { concurrent: false }, () => {
  it('stores only a refresh-token hash and issues a fifteen-minute access grant', async () => {
    const harness = await openHarness()
    const before = Date.now()
    const grant = await harness.service.login('owner@example.com', harness.password, 'Office PC', 'https://cloud.example.com')
    const accessMilliseconds = Date.parse(grant.accessExpiresAt) - before
    const refreshMilliseconds = Date.parse(grant.refreshExpiresAt) - before

    expect(accessMilliseconds).toBeGreaterThanOrEqual(14 * 60 * 1000)
    expect(accessMilliseconds).toBeLessThanOrEqual(16 * 60 * 1000)
    expect(refreshMilliseconds).toBeGreaterThan(30 * 24 * 60 * 60 * 1000 - 5_000)
    expect(grant.accessToken).not.toContain(grant.refreshToken)
    expect(JSON.stringify(harness.store.snapshot())).not.toContain(grant.refreshToken)
  })

  it('rotates the refresh token and rejects the previous token', async () => {
    const harness = await openHarness()
    const first = await harness.service.login('owner@example.com', harness.password, 'Office PC', 'https://cloud.example.com')
    const second = await harness.service.refresh(first.refreshToken)

    expect(second.refreshToken).not.toBe(first.refreshToken)
    await expect(harness.service.refresh(first.refreshToken)).rejects.toMatchObject({ code: 'desktop_auth_revoked' })
  })

  it('revokes only the named device', async () => {
    const harness = await openHarness()
    const office = await harness.service.login('owner@example.com', harness.password, 'Office PC', 'https://cloud.example.com')
    const home = await harness.service.login('owner@example.com', harness.password, 'Home PC', 'https://cloud.example.com')

    await harness.service.logout(office.refreshToken)
    await expect(harness.service.refresh(office.refreshToken)).rejects.toMatchObject({ code: 'desktop_auth_revoked' })
    await expect(harness.service.refresh(home.refreshToken)).resolves.toMatchObject({ bootstrap: { user: { email: 'owner@example.com' } } })
  })

  it('rejects bootstrap after the user session version changes', async () => {
    const harness = await openHarness()
    const grant = await harness.service.login('owner@example.com', harness.password, 'Office PC', 'https://cloud.example.com')
    await harness.store.mutate((draft) => {
      const owner = draft.users.find(user => user.email === 'owner@example.com')
      if (owner === undefined) throw new Error('owner is missing')
      owner.sessionVersion += 1
    })

    expect(() => harness.service.authorizeAccess(grant.accessToken)).toThrowError(DesktopAuthError)
    await expect(harness.service.refresh(grant.refreshToken)).rejects.toMatchObject({ code: 'desktop_auth_revoked' })
  })

  it('returns profileKey from server and user identity without exposing either secret', async () => {
    const harness = await openHarness()
    const grant = await harness.service.login('owner@example.com', harness.password, 'Office PC', 'https://cloud.example.com')
    const bootstrap = harness.service.bootstrap(harness.service.authorizeAccess(grant.accessToken), 'https://cloud.example.com')

    expect(bootstrap.profileKey).toMatch(/^[0-9a-f]{32}$/u)
    expect(bootstrap.profileKey).not.toContain(grant.accessToken)
    expect(bootstrap.profileKey).not.toContain(grant.refreshToken)
    expect(bootstrap.user.email).toBe('owner@example.com')
    expect(bootstrap.team.slug).toBe('default')
  })

  it('seals analytics off and returns the enterprise crash-report support address', async () => {
    const harness = await openHarness()
    const grant = await harness.service.login('owner@example.com', harness.password, 'Office PC', 'https://cloud.example.com')
    const bootstrap = harness.service.bootstrap(harness.service.authorizeAccess(grant.accessToken), 'https://cloud.example.com')

    expect(bootstrap.policy).toEqual({
      consumerAnalytics: false,
      crashReports: 'enterprise-support',
      supportEmail: 'support@echoai.best',
    })
  })
})
