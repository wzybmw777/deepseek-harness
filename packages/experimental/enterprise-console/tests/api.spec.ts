import { createServer, type Server } from 'node:http'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type {
  RemoteBrowserControl,
  RemoteBrowserViewState,
} from '@deepseek-ai/dsh-client-ui-sidebar-browser/types'
import { EnterpriseApi } from '../src/api.ts'
import { parseEnterprisePluginSpec, type EnterprisePluginInstaller } from '../src/plugin-installer.ts'
import type { RemoteBrowserService } from '../src/remote-browser.ts'
import { EnterpriseStore } from '../src/store.ts'
import { TeamResources } from '../src/team-resources.ts'
import { VerificationService, type VerificationMessage } from '../src/verification.ts'

interface Harness {
  readonly base: string
  readonly dataDir: string
  readonly server: Server
  readonly password: string
  readonly initialPasswordFile: string
  readonly tenantRoot: string
  readonly preparedTeams: string[]
  readonly verificationMessages: VerificationMessage[]
}

interface HarnessOptions {
  readonly publicPathPrefix?: string
  readonly verification?: boolean
  readonly remoteBrowser?: RemoteBrowserService
}

interface CallOptions {
  readonly method?: string
  readonly body?: Record<string, unknown>
  readonly cookie?: string
  readonly authorization?: string
}

const cleanups: Array<() => Promise<void>> = []
let harness: Harness | undefined

async function startHarness(options: HarnessOptions = {}): Promise<Harness> {
  const dataDir = await mkdtemp(join(tmpdir(), 'dsh-enterprise-console-'))
  const tenantRoot = join(dataDir, 'tenants')
  const opened = await EnterpriseStore.open(dataDir, 'owner@example.com', 'Enterprise Test')
  const preparedTeams: string[] = []
  const verificationMessages: VerificationMessage[] = []
  const plugins: EnterprisePluginInstaller = {
    install: async (spec) => {
      const { name } = parseEnterprisePluginSpec(spec)
      return { packageName: name, spec, version: '1.2.3', description: 'Enterprise review plugin' }
    },
    remove: async () => undefined,
  }
  const verification = new VerificationService({
    delivery: { send: async (message) => { verificationMessages.push(message) } },
  })
  const api = await EnterpriseApi.create({
    ...(options.publicPathPrefix === undefined ? {} : { publicPathPrefix: options.publicPathPrefix }),
    store: opened.store,
    resources: new TeamResources(tenantRoot),
    tenantPath: team => `${options.publicPathPrefix ?? ''}/t/${team.slug}/harness/`,
    prepareTenant: async (team) => { preparedTeams.push(team.id) },
    plugins,
    ...(options.verification === false ? {} : { verification }),
    ...(options.remoteBrowser === undefined ? {} : { remoteBrowser: options.remoteBrowser }),
    logger: { warn: () => undefined },
  })
  const server = createServer((request, response) => {
    void api.handle(request, response, new URL(request.url ?? '/', 'http://enterprise.test'))
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('Expected a TCP listener')
  const passwordFile = await readFile(opened.initialPasswordFile, 'utf8')
  const password = /^password: (.+)$/mu.exec(passwordFile)?.[1]
  if (password === undefined) throw new Error('Initial password file is malformed')
  const value: Harness = {
    base: `http://127.0.0.1:${String(address.port)}`,
    dataDir,
    server,
    password,
    initialPasswordFile: opened.initialPasswordFile,
    tenantRoot,
    preparedTeams,
    verificationMessages,
  }
  cleanups.push(async () => {
    await new Promise<void>(resolve => server.close(() => { resolve() }))
    server.closeAllConnections()
    await opened.store.close()
    await rm(dataDir, { recursive: true, force: true })
  })
  return value
}

async function call(path: string, options: CallOptions = {}): Promise<{ response: Response; body: unknown }> {
  if (harness === undefined) throw new Error('Harness is not running')
  const headers = new Headers()
  if (options.body !== undefined) headers.set('content-type', 'application/json')
  if (options.cookie !== undefined) headers.set('cookie', options.cookie)
  if (options.authorization !== undefined) headers.set('authorization', options.authorization)
  if (options.method !== undefined && options.method !== 'GET') headers.set('origin', harness.base)
  const response = await fetch(`${harness.base}/enterprise/api${path}`, {
    method: options.method ?? 'GET',
    headers,
    redirect: 'manual',
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  })
  const text = await response.text()
  return { response, body: text === '' ? undefined : JSON.parse(text) as unknown }
}

async function callBinary(
  path: string,
  options: { method: 'POST'; cookie: string; contentType: string; body: BodyInit },
): Promise<{ response: Response; body: unknown }> {
  if (harness === undefined) throw new Error('Harness is not running')
  const response = await fetch(`${harness.base}/enterprise/api${path}`, {
    method: options.method,
    headers: {
      cookie: options.cookie,
      origin: harness.base,
      'content-type': options.contentType,
    },
    redirect: 'manual',
    body: options.body,
  })
  const text = await response.text()
  return { response, body: text === '' ? undefined : JSON.parse(text) as unknown }
}

async function login(email: string, password: string): Promise<{ cookie: string; session: Record<string, unknown> }> {
  const { response, body } = await call('/login', { method: 'POST', body: { email, password } })
  expect(response.status).toBe(200)
  const setCookie = response.headers.get('set-cookie')
  expect(setCookie).toContain('HttpOnly')
  expect(setCookie).toContain('SameSite=Lax')
  return { cookie: setCookie?.split(';', 1)[0] ?? '', session: body as Record<string, unknown> }
}

async function createUser(
  cookie: string,
  input: Record<string, unknown>,
): Promise<{ id: string; temporaryPassword: string }> {
  const { response, body } = await call('/users', { method: 'POST', cookie, body: input })
  expect(response.status).toBe(201)
  const result = body as { user: { id: string }; temporaryPassword: string }
  return { id: result.user.id, temporaryPassword: result.temporaryPassword }
}

function deliveredCode(identifier: string, purpose: 'login' | 'register'): string {
  const message = harness?.verificationMessages.findLast(candidate => candidate.identifier === identifier && candidate.purpose === purpose)
  if (message === undefined) throw new Error(`No verification code was delivered for ${identifier}`)
  return message.code
}

afterEach(async () => {
  harness = undefined
  await Promise.all(cleanups.splice(0).map(cleanup => cleanup()))
})

describe('enterprise authentication and Harness gate', { concurrent: false }, () => {
  it('isolates subpath cookies and launch links from the origin-root deployment', async () => {
    harness = await startHarness({ publicPathPrefix: '/preview' })
    const guest = await fetch(`${harness.base}/enterprise/api/harness/launch`, { redirect: 'manual' })
    expect(guest.headers.get('location')).toBe('/preview/enterprise/login?next=%2Fpreview%2Fenterprise%2Fworkspace')
    const login = await fetch(`${harness.base}/enterprise/api/login`, {
      method: 'POST', headers: { 'content-type': 'application/json', origin: harness.base },
      body: JSON.stringify({ identifier: 'owner@example.com', password: harness.password }),
    })
    expect(login.status).toBe(200)
    const cookie = login.headers.get('set-cookie') ?? ''
    expect(cookie).toMatch(/^dsh_enterprise_session_[a-f0-9]{12}=/u)
    expect(cookie).toContain('Path=/preview/')
    const rootCookie = cookie.replace(/^dsh_enterprise_session_[a-f0-9]{12}=/u, 'dsh_enterprise_session=')
    const rejected = await fetch(`${harness.base}/enterprise/api/session`, { headers: { cookie: rootCookie.split(';')[0] ?? '' } })
    expect(rejected.status).toBe(401)
    const launch = await fetch(`${harness.base}/enterprise/api/harness/launch`, {
      headers: { cookie: cookie.split(';')[0] ?? '' }, redirect: 'manual',
    })
    expect(launch.headers.get('location')).toBe('/preview/t/default/harness/')
  })

  it('redirects unauthenticated workspace launches to login without creating a session', async () => {
    harness = await startHarness()

    const launch = await call('/harness/launch')
    expect(launch.response.status).toBe(303)
    expect(launch.response.headers.get('location')).toBe('/enterprise/login?next=%2Fenterprise%2Fworkspace')
    expect(launch.response.headers.get('set-cookie')).toBeNull()
    expect(harness.preparedTeams).toEqual([])

    const legacyGuestCookie = 'dsh_enterprise_guest=forged'
    expect((await call('/session', { cookie: legacyGuestCookie })).response.status).toBe(401)
    expect((await call('/session/authorize', { cookie: legacyGuestCookie })).response.status).toBe(401)
    expect((await call('/dashboard', { cookie: legacyGuestCookie })).response.status).toBe(401)
  })

  it('requires a signed session before granting workspace access', async () => {
    harness = await startHarness()

    expect((await call('/session/authorize')).response.status).toBe(401)
    expect((await call('/login', {
      method: 'POST',
      body: { email: 'owner@example.com', password: 'wrong-password' },
    })).response.status).toBe(401)

    const { cookie, session } = await login('owner@example.com', harness.password)
    expect((session.user as { email: string }).email).toBe('owner@example.com')
    expect((await call('/session/authorize', { cookie })).response.status).toBe(204)
    expect((await call('/dashboard', { cookie })).response.status).toBe(200)
    expect(session.runtime).toMatchObject({
      isolated: true,
      harnessPath: '/t/default/harness/',
      tenant: { id: 'team-default', slug: 'default' },
    })

    const launch = await call('/harness/launch', { cookie })
    expect(launch.response.status).toBe(303)
    expect(launch.response.headers.get('location')).toBe('/t/default/harness/')
    expect(harness.preparedTeams).toEqual(['team-default'])

    const logout = await call('/logout', { method: 'POST', cookie })
    expect(logout.response.status).toBe(200)
    const cleared = logout.response.headers.getSetCookie().join('\n')
    expect(cleared).toContain('dsh_enterprise_session=')
    expect(cleared).toContain('dsh-auth-')
    expect(cleared).toContain('Path=/t/default/harness/')
    expect(cleared).toContain('Max-Age=0')
    expect((await call('/session/authorize', { cookie })).response.status).toBe(401)
  })

  it('authenticates a desktop device and serves bootstrap without preparing a tenant', async () => {
    harness = await startHarness()
    const loginResponse = await call('/desktop/auth/login', {
      method: 'POST',
      body: {
        email: 'owner@example.com',
        password: harness.password,
        deviceName: 'Office PC',
      },
    })
    expect(loginResponse.response.status).toBe(200)
    expect(loginResponse.response.headers.get('set-cookie')).toBeNull()
    expect(loginResponse.body).toMatchObject({
      accessToken: expect.any(String),
      refreshToken: expect.any(String),
      bootstrap: {
        user: { email: 'owner@example.com' },
        team: { slug: 'default' },
        policy: { consumerAnalytics: false, crashReports: 'enterprise-support' },
      },
    })
    const grant = loginResponse.body as { accessToken: string; refreshToken: string }
    const bootstrap = await call('/desktop/bootstrap', {
      authorization: `Bearer ${grant.accessToken}`,
    })
    expect(bootstrap.response.status).toBe(200)
    expect(bootstrap.body).toMatchObject({
      cloudBaseUrl: harness.base,
      endpoints: {
        bootstrap: '/enterprise/api/desktop/bootstrap',
        models: '/enterprise/api/desktop/models',
      },
    })
    expect(harness.preparedTeams).toEqual([])

    const cookie = await login('owner@example.com', harness.password)
    expect((await call('/desktop/bootstrap', {
      authorization: `Bearer ${cookie.cookie}`,
    })).response.status).toBe(401)

    const audit = await call('/audit?action=desktop.auth.login', { cookie: cookie.cookie })
    expect(audit.response.status).toBe(200)
    expect(audit.body).toEqual([expect.objectContaining({ action: 'desktop.auth.login', targetType: 'desktop_device' })])
    expect(JSON.stringify(audit.body)).not.toContain(grant.refreshToken)
  })

  it('serves Desktop model routes from a bearer session and rejects cookie auth', async () => {
    harness = await startHarness()
    const desktop = await call('/desktop/auth/login', {
      method: 'POST',
      body: { email: 'owner@example.com', password: harness.password, deviceName: 'Model Client' },
    })
    const grant = desktop.body as { accessToken: string }

    const catalog = await call('/desktop/models', { authorization: `Bearer ${grant.accessToken}` })
    expect(catalog.response.status).toBe(200)
    expect(catalog.body).toMatchObject({
      quota: {
        planName: '团队版',
        totalTokens: 5_000_000,
        usedTokens: 0,
        remainingTokens: 5_000_000,
        userTokens: 0,
      },
      models: [
        expect.objectContaining({ id: 'model-deepseek-chat', protocol: 'openai-chat' }),
        expect.objectContaining({ id: 'model-deepseek-reasoner', protocol: 'openai-chat' }),
      ],
    })
    expect(JSON.stringify(catalog.body)).not.toContain('api.deepseek.com')
    expect(JSON.stringify(catalog.body)).not.toContain('encryptedApiKey')
    expect(harness.preparedTeams).toEqual([])

    const billing = await call('/desktop/billing', { authorization: `Bearer ${grant.accessToken}` })
    expect(billing.response.status).toBe(200)
    expect(billing.body).toMatchObject({
      quota: {
        planName: '团队版', totalTokens: 5_000_000, usedTokens: 0, remainingTokens: 5_000_000,
        userTokens: 0, cycleStartsAt: expect.any(String), cycleEndsAt: expect.any(String),
      },
      planName: '团队版',
      updatedAt: expect.any(String),
    })
    expect(JSON.stringify(billing.body)).not.toContain('orders')
    expect(JSON.stringify(billing.body)).not.toContain('price')

    const owner = await login('owner@example.com', harness.password)
    expect((await call('/desktop/models', { cookie: owner.cookie })).response.status).toBe(401)
    expect((await call('/desktop/billing', { cookie: owner.cookie })).response.status).toBe(401)
    expect((await call('/desktop/gateway/model-deepseek-chat/chat/completions', {
      method: 'POST',
      cookie: owner.cookie,
      body: { model: 'deepseek-chat', messages: [] },
    })).response.status).toBe(401)
  })

  it('rejects an unknown wire protocol during channel configuration', async () => {
    harness = await startHarness()
    const { cookie } = await login('owner@example.com', harness.password)

    const invalid = await call('/channels', {
      method: 'POST',
      cookie,
      body: {
        name: 'Invalid Protocol', provider: 'openai', baseUrl: 'https://models.example.com',
        wireProtocol: 'telnet',
      },
    })
    expect(invalid.response.status).toBe(400)
    expect(invalid.body).toMatchObject({ error: { code: 'invalid_field' } })

    const created = await call('/channels', {
      method: 'POST',
      cookie,
      body: {
        name: 'Responses Channel', provider: 'openai', baseUrl: 'https://models.example.com',
        wireProtocol: 'openai-responses',
      },
    })
    expect(created.response.status).toBe(201)
    expect(created.body).toMatchObject({ wireProtocol: 'openai-responses' })
  })

  it('preserves significant whitespace in a desktop password', async () => {
    harness = await startHarness()
    const owner = await login('owner@example.com', harness.password)
    const member = await createUser(owner.cookie, {
      email: 'spaced-password@example.com',
      name: 'Spaced Password',
      roleId: 'role-member',
      teamId: 'team-default',
    })
    const memberSession = await login('spaced-password@example.com', member.temporaryPassword)
    const exactPassword = '  enterprise password  '
    const changed = await call('/session/password', {
      method: 'POST',
      cookie: memberSession.cookie,
      body: { currentPassword: member.temporaryPassword, newPassword: exactPassword },
    })
    expect(changed.response.status).toBe(200)

    const trimmed = await call('/desktop/auth/login', {
      method: 'POST',
      body: { email: 'spaced-password@example.com', password: exactPassword.trim() },
    })
    expect(trimmed.response.status).toBe(401)
    const exact = await call('/desktop/auth/login', {
      method: 'POST',
      body: { email: 'spaced-password@example.com', password: exactPassword },
    })
    expect(exact.response.status).toBe(200)
  })

  it('writes successful mutations to the audit ledger and never returns a channel credential', async () => {
    harness = await startHarness()
    const { cookie } = await login('owner@example.com', harness.password)

    const team = await call('/teams', {
      method: 'POST',
      cookie,
      body: { name: 'Delivery', slug: 'delivery', planId: 'plan-starter', seatLimit: 8 },
    })
    expect(team.response.status).toBe(201)

    const secret = 'sk-test-channel-secret'
    const channel = await call('/channels', {
      method: 'POST',
      cookie,
      body: {
        name: 'Primary DeepSeek',
        provider: 'deepseek',
        baseUrl: 'https://api.deepseek.com',
        apiKey: secret,
        priority: 1,
      },
    })
    expect(channel.response.status).toBe(201)
    expect(channel.body).toMatchObject({ hasCredential: true })
    expect(JSON.stringify(channel.body)).not.toContain(secret)
    expect(JSON.stringify(channel.body)).not.toContain('encryptedApiKey')

    const stored = await readFile(join(harness.dataDir, 'enterprise.sqlite'))
    expect(stored.includes(Buffer.from(secret))).toBe(false)

    const audit = await call('/audit?action=team.create', { cookie })
    expect(audit.response.status).toBe(200)
    expect(audit.body).toEqual([expect.objectContaining({ action: 'team.create', targetType: 'team' })])
  })

  it('limits members to the workspace surface', async () => {
    harness = await startHarness()
    const owner = await login('owner@example.com', harness.password)
    const member = await createUser(owner.cookie, {
      email: 'member@example.com',
      name: 'Workspace Member',
      roleId: 'role-member',
      teamId: 'team-default',
    })
    const memberSession = await login('member@example.com', member.temporaryPassword)

    expect((await call('/session/authorize', { cookie: memberSession.cookie })).response.status).toBe(204)
    expect((await call('/dashboard', { cookie: memberSession.cookie })).response.status).toBe(403)
    expect((await call('/settings', { cookie: memberSession.cookie })).response.status).toBe(403)
  })

  it('lets owners add built-in and enterprise plugins while administrators add only enterprise plugins', async () => {
    harness = await startHarness()
    const owner = await login('owner@example.com', harness.password)
    const admin = await createUser(owner.cookie, {
      email: 'plugin-admin@example.com',
      name: 'Plugin Administrator',
      roleId: 'role-admin',
      teamId: 'team-default',
    })
    const adminSession = await login('plugin-admin@example.com', admin.temporaryPassword)
    const member = await createUser(owner.cookie, {
      email: 'plugin-member@example.com',
      name: 'Plugin Member',
      roleId: 'role-member',
      teamId: 'team-default',
    })
    const memberSession = await login('plugin-member@example.com', member.temporaryPassword)

    const ownerPlugins = await call('/plugins', { cookie: owner.cookie })
    expect(ownerPlugins.response.status).toBe(200)
    const builtin = (ownerPlugins.body as { builtins: Array<{ id: string; packageName: string; manageable: boolean }> }).builtins[0]
    if (builtin === undefined) throw new Error('test requires at least one built-in plugin')
    expect(builtin.manageable).toBe(true)
    const addedBuiltin = await call('/plugins/builtin', {
      method: 'POST', cookie: owner.cookie, body: { packageName: builtin.packageName },
    })
    expect(addedBuiltin.response.status).toBe(201)
    const addedBuiltinView = addedBuiltin.body as { builtins: Array<{ packageName: string; enabled: boolean; manageable: boolean }> }
    const addedPlugin = addedBuiltinView.builtins.find(plugin => plugin.packageName === builtin.packageName)
    expect(addedPlugin?.enabled).toBe(true)
    expect(addedPlugin?.manageable).toBe(true)
    expect((await call('/plugins/builtin', {
      method: 'POST', cookie: owner.cookie, body: { packageName: builtin.packageName },
    })).response.status).toBe(409)
    expect((await call(`/plugins/${encodeURIComponent(builtin.id)}`, {
      method: 'PATCH', cookie: owner.cookie, body: { enabled: false },
    })).response.status).toBe(200)

    const adminPlugins = await call('/plugins', { cookie: adminSession.cookie })
    expect(adminPlugins.response.status).toBe(200)
    expect((adminPlugins.body as { builtins: Array<{ manageable: boolean }> }).builtins.every(plugin => !plugin.manageable)).toBe(true)
    const adminBuiltin = await call(`/plugins/${encodeURIComponent(builtin.id)}`, {
      method: 'PATCH', cookie: adminSession.cookie, body: { enabled: false },
    })
    expect(adminBuiltin.response.status).toBe(403)
    expect((await call('/plugins/builtin', {
      method: 'POST', cookie: adminSession.cookie, body: { packageName: builtin.packageName },
    })).response.status).toBe(403)

    const added = await call('/plugins', {
      method: 'POST', cookie: adminSession.cookie, body: { spec: '@acme/dsh-reviewer@1.2.3' },
    })
    expect(added.response.status).toBe(201)
    expect(added.body).toMatchObject({
      enterprise: [expect.objectContaining({ packageName: '@acme/dsh-reviewer', scope: 'enterprise', manageable: true })],
    })
    const ownerAdded = await call('/plugins', {
      method: 'POST', cookie: owner.cookie, body: { spec: '@acme/owner-reviewer@2.0.0' },
    })
    expect(ownerAdded.response.status).toBe(201)
    const ownerAddedView = ownerAdded.body as { enterprise: Array<{ packageName: string; scope: string; manageable: boolean }> }
    expect(ownerAddedView.enterprise.find(plugin => plugin.packageName === '@acme/owner-reviewer')).toMatchObject({
      scope: 'enterprise',
      manageable: true,
    })
    const builtinPackage = (ownerPlugins.body as { builtins: Array<{ packageName: string }> }).builtins[0]?.packageName
    if (builtinPackage === undefined) throw new Error('test requires at least one built-in plugin')
    const shadowBuiltin = await call('/plugins', {
      method: 'POST',
      cookie: adminSession.cookie,
      body: { spec: builtinPackage },
    })
    expect(shadowBuiltin.response.status).toBe(409)
    expect(shadowBuiltin.body).toMatchObject({ error: { code: 'builtin_plugin' } })
    expect((await call('/plugins', { cookie: memberSession.cookie })).response.status).toBe(403)
    expect((await call('/plugins', {
      method: 'POST', cookie: memberSession.cookie, body: { spec: '@acme/dsh-reviewer@1.2.3' },
    })).response.status).toBe(403)
  }, 20_000)

  it('lets a member change their own password and revokes the previous login', async () => {
    harness = await startHarness()
    const owner = await login('owner@example.com', harness.password)
    const member = await createUser(owner.cookie, {
      email: 'password-member@example.com',
      name: 'Password Member',
      roleId: 'role-member',
      teamId: 'team-default',
    })
    const memberSession = await login('password-member@example.com', member.temporaryPassword)

    const changed = await call('/session/password', {
      method: 'POST',
      cookie: memberSession.cookie,
      body: { currentPassword: member.temporaryPassword, newPassword: 'changed-member-password' },
    })
    expect(changed.response.status).toBe(200)
    expect(changed.response.headers.get('set-cookie')).toContain('HttpOnly')
    expect((await call('/session', { cookie: memberSession.cookie })).response.status).toBe(401)

    expect((await call('/login', {
      method: 'POST',
      body: { email: 'password-member@example.com', password: member.temporaryPassword },
    })).response.status).toBe(401)
    const relogin = await login('password-member@example.com', 'changed-member-password')
    expect((relogin.session.user as { email: string }).email).toBe('password-member@example.com')

    const audit = await call('/audit?action=auth.password_change', { cookie: owner.cookie })
    expect(audit.body).toEqual([expect.objectContaining({ action: 'auth.password_change', targetType: 'user' })])
  })

  it('authenticates with a bound phone number and keeps phone ownership unique', async () => {
    harness = await startHarness()
    const owner = await login('owner@example.com', harness.password)
    const member = await createUser(owner.cookie, {
      email: 'phone-member@example.com',
      phone: '13800138000',
      name: 'Phone Member',
      roleId: 'role-member',
      teamId: 'team-default',
    })

    const phoneSession = await call('/login', {
      method: 'POST',
      body: { identifier: '138 0013 8000', password: member.temporaryPassword },
    })
    expect(phoneSession.response.status).toBe(200)
    expect(phoneSession.body).toMatchObject({
      user: { email: 'phone-member@example.com', phone: '+8613800138000' },
    })

    const prefixedPhoneSession = await call('/login', {
      method: 'POST',
      body: { identifier: '86 138 0013 8000', password: member.temporaryPassword },
    })
    expect(prefixedPhoneSession.response.status).toBe(200)

    const identifierSession = await call('/login', {
      method: 'POST',
      body: { identifier: 'owner@example.com', password: harness.password },
    })
    expect(identifierSession.response.status).toBe(200)

    const duplicate = await call('/users', {
      method: 'POST',
      cookie: owner.cookie,
      body: {
        email: 'other-phone@example.com',
        phone: '+86 138 0013 8000',
        name: 'Other Phone',
        roleId: 'role-member',
      },
    })
    expect(duplicate.response.status).toBe(409)
    expect(duplicate.body).toMatchObject({ error: { code: 'phone_exists' } })
  })

  it('records usage and serves it through the usage and dashboard projections', async () => {
    harness = await startHarness()
    const { cookie } = await login('owner@example.com', harness.password)

    const created = await call('/usage/record', {
      method: 'POST',
      cookie,
      body: {
        teamId: 'team-default',
        modelId: 'model-deepseek-chat',
        requests: 3,
        inputTokens: 1_000,
        outputTokens: 500,
      },
    })
    expect(created.response.status).toBe(201)
    expect(created.body).toMatchObject({
      teamName: '默认团队',
      modelName: 'DeepSeek Chat',
      channelName: 'DeepSeek 主渠道',
      requests: 3,
      inputTokens: 1_000,
      outputTokens: 500,
      costCents: 1,
    })

    const usage = await call('/usage?teamId=team-default', { cookie })
    expect(usage.response.status).toBe(200)
    expect(usage.body).toMatchObject({
      summary: { requests: 3, inputTokens: 1_000, outputTokens: 500, costCents: 1 },
      records: [expect.objectContaining({ teamName: '默认团队', modelName: 'DeepSeek Chat' })],
    })

    const dashboard = await call('/dashboard', { cookie })
    expect(dashboard.response.status).toBe(200)
    expect(dashboard.body).toMatchObject({
      stats: { requests: 3, inputTokens: 1_000, outputTokens: 500, costCents: 1 },
      modelUsage: [expect.objectContaining({ modelId: 'model-deepseek-chat', requests: 3, tokens: 1_500, costCents: 1 })],
      teamUsage: [expect.objectContaining({ teamId: 'team-default', requests: 3, costCents: 1 })],
    })
    const recentAudit = (dashboard.body as { recentAudit: Array<{ action: string }> }).recentAudit
    expect(recentAudit.some(record => record.action === 'usage.record')).toBe(true)

    const audit = await call('/audit?action=usage.record', { cookie })
    expect(audit.response.status).toBe(200)
    expect(audit.body).toEqual([expect.objectContaining({ action: 'usage.record', targetType: 'usage' })])
  })

  it('meters completed turns once and reports the shared team quota', async () => {
    harness = await startHarness()
    const { cookie } = await login('owner@example.com', harness.password)

    const initial = await call('/billing', { cookie })
    expect(initial.response.status).toBe(200)
    expect(initial.body).toMatchObject({
      team: { id: 'team-default', name: '默认团队', memberCount: 1 },
      plan: { id: 'plan-starter', name: '团队版' },
      quota: {
        totalTokens: 5_000_000,
        usedTokens: 0,
        remainingTokens: 5_000_000,
        userTokens: 0,
        requests: 0,
        userRequests: 0,
        percentUsed: 0,
      },
      canPurchase: true,
    })

    const payload = {
      sessionId: 'metered-session',
      turn: 3,
      inputTokens: 1_000,
      outputTokens: 500,
      model: 'deepseek-chat',
    }
    const created = await call('/billing/usage', { method: 'POST', cookie, body: payload })
    expect(created.response.status).toBe(201)
    expect(created.body).toEqual({ recorded: true })
    const duplicate = await call('/billing/usage', { method: 'POST', cookie, body: payload })
    expect(duplicate.response.status).toBe(200)
    expect(duplicate.body).toEqual({ recorded: false })

    const billing = await call('/billing', { cookie })
    expect(billing.response.status).toBe(200)
    expect(billing.body).toMatchObject({
      quota: {
        usedTokens: 1_500,
        remainingTokens: 4_998_500,
        userTokens: 1_500,
        requests: 1,
        userRequests: 1,
        percentUsed: 0,
      },
    })
  })

  it('lets an owner order and activate a plan while members keep read-only quota access', async () => {
    harness = await startHarness()
    const owner = await login('owner@example.com', harness.password)
    const member = await createUser(owner.cookie, {
      email: 'billing-member@example.com',
      name: 'Billing Member',
      roleId: 'role-member',
      teamId: 'team-default',
    })
    const memberSession = await login('billing-member@example.com', member.temporaryPassword)

    const memberBilling = await call('/billing', { cookie: memberSession.cookie })
    expect(memberBilling.response.status).toBe(200)
    expect(memberBilling.body).toMatchObject({ canPurchase: false })
    const memberOrder = await call('/billing/orders', {
      method: 'POST',
      cookie: memberSession.cookie,
      body: { planId: 'plan-business', billingCycle: 'monthly' },
    })
    expect(memberOrder.response.status).toBe(403)
    expect(memberOrder.body).toMatchObject({ error: { code: 'forbidden' } })

    const asked = await call('/billing/orders', {
      method: 'POST',
      cookie: owner.cookie,
      body: { planId: 'plan-business', billingCycle: 'monthly', reference: 'BANK-1001' },
    })
    expect(asked.response.status).toBe(201)
    const order = asked.body as { id: string; status: string; amountCents: number; billingCycle: string }
    expect(order).toMatchObject({ status: 'pending', amountCents: 99_900, billingCycle: 'monthly' })

    const duplicate = await call('/billing/orders', {
      method: 'POST',
      cookie: owner.cookie,
      body: { planId: 'plan-enterprise', billingCycle: 'annual' },
    })
    expect(duplicate.response.status).toBe(409)
    expect(duplicate.body).toMatchObject({ error: { code: 'order_pending' } })

    const approved = await call(`/orders/${order.id}/approve`, { method: 'POST', cookie: owner.cookie })
    expect(approved.response.status).toBe(200)
    expect(approved.body).toMatchObject({ status: 'paid', planName: '商业版' })

    const upgraded = await call('/billing', { cookie: owner.cookie })
    expect(upgraded.response.status).toBe(200)
    expect(upgraded.body).toMatchObject({
      plan: { id: 'plan-business', name: '商业版' },
      team: { seatLimit: 50 },
      quota: { totalTokens: 30_000_000, remainingTokens: 30_000_000 },
      orders: [expect.objectContaining({ id: order.id, status: 'paid' })],
    })
  })

  it('enforces owner-only role management and administrator member assignment', async () => {
    harness = await startHarness()
    const owner = await login('owner@example.com', harness.password)
    const admin = await createUser(owner.cookie, {
      email: 'admin@example.com',
      name: 'Administrator',
      roleId: 'role-admin',
      teamId: 'team-default',
    })
    const adminSession = await login('admin@example.com', admin.temporaryPassword)

    const createdMember = await call('/users', {
      method: 'POST',
      cookie: adminSession.cookie,
      body: {
        email: 'member-by-admin@example.com',
        name: 'Member by Administrator',
        roleId: 'role-member',
        teamId: 'team-default',
      },
    })
    expect(createdMember.response.status).toBe(201)
    expect(createdMember.body).toMatchObject({
      user: { email: 'member-by-admin@example.com', roleId: 'role-member', teamId: 'team-default' },
    })
    const createdMemberId = (createdMember.body as { user: { id: string } }).user.id

    const createdAdmin = await call('/users', {
      method: 'POST',
      cookie: adminSession.cookie,
      body: {
        email: 'admin-by-admin@example.com',
        name: 'Administrator by Administrator',
        roleId: 'role-admin',
        teamId: 'team-default',
      },
    })
    expect(createdAdmin.response.status).toBe(403)
    expect(createdAdmin.body).toMatchObject({ error: { code: 'role_assignment_forbidden' } })

    const createdOwner = await call('/users', {
      method: 'POST',
      cookie: adminSession.cookie,
      body: {
        email: 'owner-by-admin@example.com',
        name: 'Owner by Administrator',
        roleId: 'role-owner',
        teamId: 'team-default',
      },
    })
    expect(createdOwner.response.status).toBe(403)
    expect(createdOwner.body).toMatchObject({ error: { code: 'role_assignment_forbidden' } })

    const promotedMember = await call(`/users/${createdMemberId}`, {
      method: 'PATCH',
      cookie: adminSession.cookie,
      body: { roleId: 'role-admin' },
    })
    expect(promotedMember.response.status).toBe(403)
    expect(promotedMember.body).toMatchObject({ error: { code: 'role_assignment_forbidden' } })

    const createdRole = await call('/roles', {
      method: 'POST',
      cookie: adminSession.cookie,
      body: { name: 'Member Only', permissions: ['workspace.use'] },
    })
    expect(createdRole.response.status).toBe(403)
    expect(createdRole.body).toMatchObject({ error: { code: 'owner_required' } })

    const editedAdminRole = await call('/roles/role-admin', {
      method: 'PATCH',
      cookie: adminSession.cookie,
      body: { description: 'Changed by administrator' },
    })
    expect(editedAdminRole.response.status).toBe(403)
    expect(editedAdminRole.body).toMatchObject({ error: { code: 'owner_required' } })

    const selfAssignment = await call(`/users/${admin.id}`, {
      method: 'PATCH',
      cookie: adminSession.cookie,
      body: { roleId: 'role-owner' },
    })
    expect(selfAssignment.response.status).toBe(403)
    expect(selfAssignment.body).toMatchObject({ error: { code: 'role_hierarchy_forbidden' } })

    const ownerId = (owner.session.user as { id: string }).id
    const ownerUpdate = await call(`/users/${ownerId}`, {
      method: 'PATCH',
      cookie: adminSession.cookie,
      body: { name: 'Changed by administrator' },
    })
    expect(ownerUpdate.response.status).toBe(403)
    expect(ownerUpdate.body).toMatchObject({ error: { code: 'role_hierarchy_forbidden' } })

    const ownerRoleUpdate = await call('/roles/role-owner', {
      method: 'PATCH',
      cookie: owner.cookie,
      body: { name: 'Renamed Owner' },
    })
    expect(ownerRoleUpdate.response.status).toBe(409)
    expect(ownerRoleUpdate.body).toMatchObject({ error: { code: 'owner_role_locked' } })

    const ownerCreatedRole = await call('/roles', {
      method: 'POST',
      cookie: owner.cookie,
      body: { name: 'Team Lead', permissions: ['workspace.use', 'dashboard.read'] },
    })
    expect(ownerCreatedRole.response.status).toBe(201)
    const customRoleId = (ownerCreatedRole.body as { id: string }).id
    const customRoleUser = await createUser(owner.cookie, {
      email: 'custom-role-member@example.com',
      name: 'Custom Role Member',
      roleId: customRoleId,
      teamId: 'team-default',
    })
    const customRoleUpdate = await call(`/users/${customRoleUser.id}`, {
      method: 'PATCH',
      cookie: adminSession.cookie,
      body: { name: 'Changed by administrator' },
    })
    expect(customRoleUpdate.response.status).toBe(403)
    expect(customRoleUpdate.body).toMatchObject({ error: { code: 'role_hierarchy_forbidden' } })
    const customRoleDelete = await call(`/users/${customRoleUser.id}`, {
      method: 'DELETE',
      cookie: adminSession.cookie,
    })
    expect(customRoleDelete.response.status).toBe(403)
    expect(customRoleDelete.body).toMatchObject({ error: { code: 'role_hierarchy_forbidden' } })
  })

  it('signs in with an emailed verification code and consumes it once', async () => {
    harness = await startHarness()
    const requested = await call('/auth/verification-code', {
      method: 'POST',
      body: { identifier: 'owner@example.com', purpose: 'login' },
    })
    expect(requested.response.status).toBe(202)
    expect(requested.body).toMatchObject({ ok: true, expiresInSeconds: 600, retryAfterSeconds: 60 })
    const code = deliveredCode('owner@example.com', 'login')
    expect(code).toMatch(/^\d{6}$/u)

    const wrong = await call('/auth/login/code', {
      method: 'POST',
      body: { identifier: 'owner@example.com', code: code === '000000' ? '111111' : '000000' },
    })
    expect(wrong.response.status).toBe(401)
    expect(wrong.body).toMatchObject({ error: { code: 'invalid_code' } })

    const success = await call('/auth/login/code', {
      method: 'POST',
      body: { identifier: 'owner@example.com', code },
    })
    expect(success.response.status).toBe(200)
    expect(success.body).toMatchObject({ user: { email: 'owner@example.com' } })
    expect(success.response.headers.get('set-cookie')).toContain('HttpOnly')

    const reused = await call('/auth/login/code', {
      method: 'POST',
      body: { identifier: 'owner@example.com', code },
    })
    expect(reused.response.status).toBe(401)
  })

  it('signs in with a phone verification code', async () => {
    harness = await startHarness()
    const owner = await login('owner@example.com', harness.password)
    await createUser(owner.cookie, {
      email: 'code-phone@example.com',
      phone: '13800138000',
      name: 'Code Phone',
      roleId: 'role-member',
      teamId: 'team-default',
    })

    const requested = await call('/auth/verification-code', {
      method: 'POST',
      body: { identifier: '86 138 0013 8000', purpose: 'login' },
    })
    expect(requested.response.status).toBe(202)
    expect(harness.verificationMessages.at(-1)).toMatchObject({
      identifier: '+8613800138000',
      channel: 'phone',
      purpose: 'login',
    })

    const success = await call('/auth/login/code', {
      method: 'POST',
      body: { identifier: '+86 138 0013 8000', code: deliveredCode('+8613800138000', 'login') },
    })
    expect(success.response.status).toBe(200)
    expect(success.body).toMatchObject({ user: { phone: '+8613800138000' } })
  })

  it('does not send login codes for unknown or disabled accounts', async () => {
    harness = await startHarness()
    const requested = await call('/auth/verification-code', {
      method: 'POST',
      body: { identifier: 'missing@example.com', purpose: 'login' },
    })
    expect(requested.response.status).toBe(202)
    expect(harness.verificationMessages).toEqual([])
  })

  it('registers a verified email into the configured default team', async () => {
    harness = await startHarness()
    const owner = await login('owner@example.com', harness.password)
    const enabled = await call('/settings', {
      method: 'PATCH',
      cookie: owner.cookie,
      body: { registrationEnabled: true, defaultTeamId: 'team-default', defaultRoleId: 'role-member' },
    })
    expect(enabled.response.status).toBe(200)

    const requested = await call('/auth/verification-code', {
      method: 'POST',
      body: { identifier: 'new-member@example.com', purpose: 'register' },
    })
    expect(requested.response.status).toBe(202)
    const code = deliveredCode('new-member@example.com', 'register')
    const registered = await call('/auth/register', {
      method: 'POST',
      body: {
        identifier: 'new-member@example.com',
        code,
        name: 'New Member',
        password: 'new-member-password',
      },
    })
    expect(registered.response.status).toBe(201)
    expect(registered.body).toMatchObject({
      user: { email: 'new-member@example.com', roleName: '成员', teamId: 'team-default', teamName: '默认团队' },
    })
    expect(registered.response.headers.get('set-cookie')).toContain('HttpOnly')

    const passwordLogin = await login('new-member@example.com', 'new-member-password')
    expect((passwordLogin.session.user as { email: string }).email).toBe('new-member@example.com')
    const audit = await call('/audit?action=user.register', { cookie: owner.cookie })
    expect(audit.body).toEqual([expect.objectContaining({ action: 'user.register', targetType: 'user' })])
  })

  it('registers a verified phone with a profile email', async () => {
    harness = await startHarness()
    const owner = await login('owner@example.com', harness.password)
    await call('/settings', {
      method: 'PATCH',
      cookie: owner.cookie,
      body: { registrationEnabled: true },
    })
    await call('/auth/verification-code', {
      method: 'POST',
      body: { identifier: '13900139000', purpose: 'register' },
    })
    const registered = await call('/auth/register', {
      method: 'POST',
      body: {
        identifier: '13900139000',
        email: 'phone-register@example.com',
        code: deliveredCode('+8613900139000', 'register'),
        name: 'Phone Register',
        password: 'phone-register-password',
      },
    })
    expect(registered.response.status).toBe(201)
    expect(registered.body).toMatchObject({ user: { email: 'phone-register@example.com', phone: '+8613900139000' } })
  })

  it('rejects registration when it is disabled or the identifier already exists', async () => {
    harness = await startHarness()
    const disabled = await call('/auth/verification-code', {
      method: 'POST',
      body: { identifier: 'disabled@example.com', purpose: 'register' },
    })
    expect(disabled.response.status).toBe(403)
    expect(disabled.body).toMatchObject({ error: { code: 'registration_disabled' } })

    const owner = await login('owner@example.com', harness.password)
    await call('/settings', {
      method: 'PATCH',
      cookie: owner.cookie,
      body: { registrationEnabled: true },
    })
    await call('/auth/verification-code', {
      method: 'POST',
      body: { identifier: 'owner@example.com', purpose: 'register' },
    })
    const duplicate = await call('/auth/register', {
      method: 'POST',
      body: {
        identifier: 'owner@example.com',
        code: deliveredCode('owner@example.com', 'register'),
        name: 'Duplicate Owner',
        password: 'duplicate-password',
      },
    })
    expect(duplicate.response.status).toBe(409)
    expect(duplicate.body).toMatchObject({ error: { code: 'email_exists' } })
  })

  it('keeps registration unavailable without a verification delivery provider', async () => {
    harness = await startHarness({ verification: false })
    const publicConfig = await call('/public-config')
    expect(publicConfig.body).toMatchObject({ registrationEnabled: false, verificationEnabled: false })

    const owner = await login('owner@example.com', harness.password)
    const enabled = await call('/settings', {
      method: 'PATCH',
      cookie: owner.cookie,
      body: { registrationEnabled: true },
    })
    expect(enabled.response.status).toBe(409)
    expect(enabled.body).toMatchObject({ error: { code: 'verification_unavailable' } })
  })

  it('applies the resend cooldown to verification-code requests', async () => {
    harness = await startHarness()
    expect((await call('/auth/verification-code', {
      method: 'POST',
      body: { identifier: 'owner@example.com', purpose: 'login' },
    })).response.status).toBe(202)
    const repeated = await call('/auth/verification-code', {
      method: 'POST',
      body: { identifier: 'owner@example.com', purpose: 'login' },
    })
    expect(repeated.response.status).toBe(429)
    expect(repeated.body).toMatchObject({ error: { code: 'too_many_attempts' } })
  })

  it('serves authenticated team files as a real workspace file manager', async () => {
    harness = await startHarness()
    expect((await call('/resources/files')).response.status).toBe(401)

    const owner = await login('owner@example.com', harness.password)
    const uploaded = await callBinary('/resources/files/upload?path=&name=notes.txt', {
      method: 'POST',
      cookie: owner.cookie,
      contentType: 'text/plain; charset=utf-8',
      body: 'Hello team',
    })
    expect(uploaded.response.status).toBe(201)
    expect(uploaded.body).toMatchObject({ name: 'notes.txt', path: 'notes.txt', kind: 'file', size: 10 })
    const listing = await call('/resources/files', { cookie: owner.cookie })
    expect(listing.response.status).toBe(200)
    expect(listing.body).toMatchObject({
      directory: '',
      entries: [expect.objectContaining({ name: 'notes.txt', path: 'notes.txt', kind: 'file' })],
    })

    const content = await call('/resources/files/content?path=notes.txt', { cookie: owner.cookie })
    expect(content.body).toMatchObject({ path: 'notes.txt', content: 'Hello team', editable: true })

    const updated = await call('/resources/files/content', {
      method: 'PATCH',
      cookie: owner.cookie,
      body: { path: 'notes.txt', content: 'Updated team notes' },
    })
    expect(updated.response.status).toBe(200)

    const downloaded = await fetch(`${harness.base}/enterprise/api/resources/files/download?path=notes.txt`, {
      headers: { cookie: owner.cookie },
    })
    expect(downloaded.status).toBe(200)
    expect(downloaded.headers.get('content-disposition')).toContain('attachment')
    expect(await downloaded.text()).toBe('Updated team notes')

    const folder = await call('/resources/files/directory', {
      method: 'POST',
      cookie: owner.cookie,
      body: { path: 'docs' },
    })
    expect(folder.response.status).toBe(201)
    const location = await call('/resources/projects/location?path=docs', { cookie: owner.cookie })
    expect(location.response.status).toBe(200)
    expect(location.body).toMatchObject({
      path: expect.stringMatching(/\/team-default\/documents\/deepseek-harness\/default-workspace\/docs$/u),
    })
    expect((await call('/resources/projects/location?path=docs')).response.status).toBe(401)
    expect((await call('/resources/projects/location?path=..%2Fother-team', { cookie: owner.cookie })).response.status).toBe(400)
    const renamed = await call('/resources/files', {
      method: 'PATCH',
      cookie: owner.cookie,
      body: { path: 'notes.txt', name: 'readme.txt' },
    })
    expect(renamed.response.status).toBe(200)
    const removed = await call('/resources/files?path=readme.txt', { method: 'DELETE', cookie: owner.cookie })
    expect(removed.response.status).toBe(204)

    expect(await readFile(join(harness.tenantRoot, 'team-default', 'documents', 'deepseek-harness', 'default-workspace', 'readme.txt'), 'utf8').catch(() => 'missing')).toBe('missing')
  })

  it('binds file, skill, and knowledge operations to the signed-in user team', async () => {
    harness = await startHarness()
    const owner = await login('owner@example.com', harness.password)
    await callBinary('/resources/files/upload?path=&name=owner.txt', {
      method: 'POST',
      cookie: owner.cookie,
      contentType: 'text/plain',
      body: 'owner only',
    })

    const otherTeam = await call('/teams', {
      method: 'POST',
      cookie: owner.cookie,
      body: { name: 'Other Team', slug: 'other-team', planId: 'plan-starter', seatLimit: 5 },
    })
    expect(otherTeam.response.status).toBe(201)
    const otherTeamId = (otherTeam.body as { id: string }).id
    const otherTeamOwner = await createUser(owner.cookie, {
      email: 'other-member@example.com',
      name: 'Other Team Owner',
      roleId: 'role-owner',
      teamId: otherTeamId,
    })
    const otherTeamOwnerSession = await login('other-member@example.com', otherTeamOwner.temporaryPassword)

    const files = await call('/resources/files', { cookie: otherTeamOwnerSession.cookie })
    expect(files.response.status).toBe(200)
    expect(files.body).toMatchObject({ directory: '', entries: [] })

    const skill = await call('/resources/skills', {
      method: 'POST',
      cookie: otherTeamOwnerSession.cookie,
      body: {
        name: 'other-team-skill',
        description: 'Only available in the other team.',
        instructions: 'Use the other team workflow.',
      },
    })
    expect(skill.response.status).toBe(201)
    const ownerSkills = await call('/resources/skills', { cookie: owner.cookie })
    expect(ownerSkills.body).toEqual([])
    const memberSkills = await call('/resources/skills', { cookie: otherTeamOwnerSession.cookie })
    expect(memberSkills.body).toEqual([expect.objectContaining({ name: 'other-team-skill' })])

    const article = await call('/resources/knowledge', {
      method: 'POST',
      cookie: otherTeamOwnerSession.cookie,
      body: {
        title: 'Other team knowledge',
        summary: 'A private team article.',
        body: 'This belongs only to the other team.',
        tags: ['private'],
      },
    })
    expect(article.response.status).toBe(201)
    expect((await call('/resources/knowledge', { cookie: owner.cookie })).body).toEqual([])
    expect((await call('/resources/knowledge', { cookie: otherTeamOwnerSession.cookie })).body)
      .toEqual([expect.objectContaining({ title: 'Other team knowledge' })])
  })

  it('lets console readers select another team without exposing it to members', async () => {
    harness = await startHarness()
    const owner = await login('owner@example.com', harness.password)
    const otherTeam = await call('/teams', {
      method: 'POST',
      cookie: owner.cookie,
      body: { name: 'Research Team', slug: 'research-team', planId: 'plan-starter', seatLimit: 5 },
    })
    expect(otherTeam.response.status).toBe(201)
    const otherTeamId = (otherTeam.body as { id: string }).id
    const target = `teamId=${encodeURIComponent(otherTeamId)}`

    expect((await callBinary(`/resources/files/upload?path=&name=research.txt&${target}`, {
      method: 'POST', cookie: owner.cookie, contentType: 'text/plain; charset=utf-8', body: 'Research notes',
    })).response.status).toBe(201)
    expect((await call(`/resources/skills?${target}`, {
      method: 'POST',
      cookie: owner.cookie,
      body: { name: 'research-review', description: 'Review research findings.', instructions: 'Check the evidence.' },
    })).response.status).toBe(201)
    expect((await call(`/resources/knowledge?${target}`, {
      method: 'POST',
      cookie: owner.cookie,
      body: { title: 'Research policy', summary: 'Keep research notes private.', body: 'Private to research.', tags: ['research'] },
    })).response.status).toBe(201)

    expect((await call(`/resources/files?${target}`, { cookie: owner.cookie })).body)
      .toMatchObject({ entries: [expect.objectContaining({ name: 'research.txt' })] })
    expect((await call(`/resources/skills?${target}`, { cookie: owner.cookie })).body)
      .toEqual(expect.arrayContaining([expect.objectContaining({ name: 'research-review' })]))
    expect((await call(`/resources/knowledge?${target}`, { cookie: owner.cookie })).body)
      .toEqual([expect.objectContaining({ title: 'Research policy' })])
    expect((await call('/resources/files', { cookie: owner.cookie })).body).toMatchObject({ entries: [] })
    expect((await call('/resources/skills', { cookie: owner.cookie })).body).toEqual([])
    expect((await call('/resources/knowledge', { cookie: owner.cookie })).body).toEqual([])

    const member = await createUser(owner.cookie, {
      email: 'resource-member@example.com',
      name: 'Resource Member',
      roleId: 'role-member',
      teamId: 'team-default',
    })
    const memberSession = await login('resource-member@example.com', member.temporaryPassword)
    const forbidden = await call(`/resources/files?${target}`, { cookie: memberSession.cookie })
    expect(forbidden.response.status).toBe(403)
    expect(forbidden.body).toMatchObject({ error: { code: 'cross_team_forbidden' } })
  })

  it('keeps team files, skills, and knowledge read-only for members', async () => {
    harness = await startHarness()
    const owner = await login('owner@example.com', harness.password)
    expect((await call('/resources/access', { cookie: owner.cookie })).body).toEqual({ canWrite: true })
    await callBinary('/resources/files/upload?path=&name=shared.txt', {
      method: 'POST',
      cookie: owner.cookie,
      contentType: 'text/plain; charset=utf-8',
      body: 'Shared by the owner',
    })
    await call('/resources/skills', {
      method: 'POST',
      cookie: owner.cookie,
      body: { name: 'owner-skill', description: 'Owner maintained', instructions: 'Use the owner workflow.' },
    })
    const article = await call('/resources/knowledge', {
      method: 'POST',
      cookie: owner.cookie,
      body: { title: 'Owner knowledge', summary: 'Owner maintained', body: 'Read-only for members.', tags: ['shared'] },
    })
    const articleId = (article.body as { id: string }).id

    const member = await createUser(owner.cookie, {
      email: 'readonly-member@example.com',
      name: 'Read-only Member',
      roleId: 'role-member',
      teamId: 'team-default',
    })
    const memberSession = await login('readonly-member@example.com', member.temporaryPassword)
    expect((await call('/resources/access', { cookie: memberSession.cookie })).body).toEqual({ canWrite: false })

    expect((await call('/resources/files', { cookie: memberSession.cookie })).body)
      .toMatchObject({ entries: [expect.objectContaining({ name: 'shared.txt' })] })
    expect((await call('/resources/files/content?path=shared.txt', { cookie: memberSession.cookie })).body)
      .toMatchObject({ content: 'Shared by the owner' })
    expect((await fetch(`${harness.base}/enterprise/api/resources/files/download?path=shared.txt`, {
      headers: { cookie: memberSession.cookie },
    })).status).toBe(200)
    expect((await call('/resources/skills', { cookie: memberSession.cookie })).body)
      .toEqual(expect.arrayContaining([expect.objectContaining({ name: 'owner-skill' })]))
    expect((await call(`/resources/knowledge/${articleId}`, { cookie: memberSession.cookie })).body)
      .toMatchObject({ title: 'Owner knowledge' })

    const writes = await Promise.all([
      callBinary('/resources/files/upload?path=&name=member.txt', {
        method: 'POST', cookie: memberSession.cookie, contentType: 'text/plain', body: 'blocked',
      }),
      call('/resources/files/content', {
        method: 'PATCH', cookie: memberSession.cookie, body: { path: 'shared.txt', content: 'changed' },
      }),
      call('/resources/files/directory', {
        method: 'POST', cookie: memberSession.cookie, body: { path: 'member-folder' },
      }),
      call('/resources/files', {
        method: 'PATCH', cookie: memberSession.cookie, body: { path: 'shared.txt', name: 'renamed.txt' },
      }),
      call('/resources/files?path=shared.txt', { method: 'DELETE', cookie: memberSession.cookie }),
      call('/resources/skills', {
        method: 'POST', cookie: memberSession.cookie,
        body: { name: 'member-skill', description: 'Blocked', instructions: 'Blocked.' },
      }),
      call('/resources/skills/owner-skill', {
        method: 'PATCH', cookie: memberSession.cookie,
        body: { description: 'Blocked', instructions: 'Blocked.' },
      }),
      call('/resources/skills/owner-skill', { method: 'DELETE', cookie: memberSession.cookie }),
      call('/resources/knowledge', {
        method: 'POST', cookie: memberSession.cookie,
        body: { title: 'Blocked', summary: 'Blocked', body: 'Blocked', tags: [] },
      }),
      call(`/resources/knowledge/${articleId}`, {
        method: 'PATCH', cookie: memberSession.cookie,
        body: { title: 'Blocked', summary: 'Blocked', body: 'Blocked', tags: [] },
      }),
      call(`/resources/knowledge/${articleId}`, { method: 'DELETE', cookie: memberSession.cookie }),
    ])
    expect(writes.map(result => result.response.status)).toEqual(Array.from({ length: writes.length }, () => 403))
  })

  it('creates filesystem skills and searchable knowledge from the console API', async () => {
    harness = await startHarness()
    const owner = await login('owner@example.com', harness.password)

    const createdSkill = await call('/resources/skills', {
      method: 'POST',
      cookie: owner.cookie,
      body: {
        name: 'incident-runbook',
        description: 'Guide the team through an incident.',
        instructions: 'Open an incident record, assign an owner, and communicate status.',
      },
    })
    expect(createdSkill.response.status).toBe(201)
    const skillList = await call('/resources/skills', { cookie: owner.cookie })
    expect(skillList.body).toEqual([expect.objectContaining({ name: 'incident-runbook', managedBy: 'user' })])
    const skill = await call('/resources/skills/incident-runbook', { cookie: owner.cookie })
    expect(skill.body).toMatchObject({ name: 'incident-runbook' })
    expect((skill.body as { instructions: string }).instructions).toContain('assign an owner')

    const createdKnowledge = await call('/resources/knowledge', {
      method: 'POST',
      cookie: owner.cookie,
      body: {
        title: 'Production access',
        summary: 'How to request production access.',
        body: 'Open an access request and wait for owner approval.',
        tags: ['security', 'operations'],
      },
    })
    expect(createdKnowledge.response.status).toBe(201)
    const article = createdKnowledge.body as { id: string }
    const knowledgeList = await call('/resources/knowledge', { cookie: owner.cookie })
    expect(knowledgeList.body).toEqual([expect.objectContaining({ title: 'Production access', tags: ['security', 'operations'] })])
    expect((await call(`/resources/knowledge/${article.id}`, { cookie: owner.cookie })).body)
      .toMatchObject({ body: 'Open an access request and wait for owner approval.' })

    const managedSkill = await call('/resources/skills/team-knowledge', { cookie: owner.cookie })
    expect(managedSkill.response.status).toBe(200)
    expect(managedSkill.body).toMatchObject({ name: 'team-knowledge', managedBy: 'knowledge' })
    expect(await readFile(join(harness.tenantRoot, 'team-default', 'home', 'skills', 'team-knowledge', 'SKILL.md'), 'utf8'))
      .toContain('Production access')

    expect((await call(`/resources/skills/${createdSkill.body ? 'incident-runbook' : ''}`, {
      method: 'DELETE',
      cookie: owner.cookie,
    })).response.status).toBe(204)
    expect((await call(`/resources/knowledge/${article.id}`, { method: 'DELETE', cookie: owner.cookie })).response.status).toBe(204)
  })

  it('authenticates remote browser routes and binds every session to the team member', async () => {
    const opened: Array<{ owner: string; url: string; width: number; height: number }> = []
    const controlled: Array<{ owner: string; sessionId: string; control: RemoteBrowserControl }> = []
    const closed: Array<{ owner: string; sessionId: string }> = []
    const subscribed: string[] = []
    const state: RemoteBrowserViewState = {
      url: 'https://www.google.com/', title: 'Google', loading: false, canGoBack: false, canGoForward: false,
    }
    const remoteBrowser: RemoteBrowserService = {
      open: async (owner, request) => {
        opened.push({ owner, ...request })
        return { sessionId: 'browser-session-1', state }
      },
      control: async (owner, sessionId, control) => {
        controlled.push({ owner, sessionId, control })
        return state
      },
      close: async (owner, sessionId) => { closed.push({ owner, sessionId }) },
      subscribe: (owner, sessionId, listener) => {
        subscribed.push(`${owner}:${sessionId}`)
        listener({ type: 'state', state })
        return () => {}
      },
      dispose: async () => {},
    }
    harness = await startHarness({ remoteBrowser })

    expect((await call('/browser/sessions', {
      method: 'POST',
      body: { url: 'https://www.google.com/', width: 800, height: 600 },
    })).response.status).toBe(401)

    const owner = await login('owner@example.com', harness.password)
    const userId = (owner.session.user as { id: string }).id
    const session = await call('/browser/sessions', {
      method: 'POST',
      cookie: owner.cookie,
      body: { url: 'https://www.google.com/', width: 800, height: 600 },
    })
    expect(session.response.status).toBe(201)
    expect(session.body).toEqual({ sessionId: 'browser-session-1', state })
    expect(opened).toEqual([{
      owner: `team-default:${userId}`, url: 'https://www.google.com/', width: 800, height: 600,
    }])

    const control = await call('/browser/control', {
      method: 'POST',
      cookie: owner.cookie,
      body: { sessionId: 'browser-session-1', action: 'navigate', url: 'https://example.com/' },
    })
    expect(control.response.status).toBe(200)
    expect(controlled).toEqual([{
      owner: `team-default:${userId}`,
      sessionId: 'browser-session-1',
      control: { action: 'navigate', url: 'https://example.com/' },
    }])

    const crossOrigin = await fetch(`${harness.base}/enterprise/api/browser/close`, {
      method: 'POST',
      headers: { cookie: owner.cookie, origin: 'https://attacker.example', 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: 'browser-session-1' }),
    })
    expect(crossOrigin.status).toBe(403)
    expect(closed).toEqual([])

    const close = await call('/browser/close', {
      method: 'POST', cookie: owner.cookie, body: { sessionId: 'browser-session-1' },
    })
    expect(close.response.status).toBe(200)
    expect(closed).toEqual([{ owner: `team-default:${userId}`, sessionId: 'browser-session-1' }])
    expect(subscribed).toEqual([])
  })

  it('reports remote browser unavailability without breaking authenticated routes', async () => {
    harness = await startHarness()
    const owner = await login('owner@example.com', harness.password)
    const session = await call('/browser/sessions', {
      method: 'POST', cookie: owner.cookie, body: { url: 'https://www.google.com/' },
    })
    expect(session.response.status).toBe(503)
    expect(session.body).toMatchObject({ error: { code: 'browser_unavailable' } })
  })
})
