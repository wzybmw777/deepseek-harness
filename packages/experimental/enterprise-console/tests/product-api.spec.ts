import { createServer } from 'node:http'
import { createHash } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { EnterpriseApi } from '../src/api.ts'
import { ProductApi } from '../src/product-api.ts'
import { ProductStore } from '../src/product-store.ts'
import { EnterpriseStore } from '../src/store.ts'
import { TeamResources } from '../src/team-resources.ts'
import { encodeSession } from '../src/security.ts'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'zhiliu-product-api-'))
  const { store } = await EnterpriseStore.open(directory, 'owner@example.com', 'Zhiliu')
  const products = await ProductStore.open(directory)
  await store.mutate((draft) => {
    const owner = draft.users.find(item => item.id === 'user-owner')!
    draft.users.push({ ...owner, id: 'member', name: 'Member', email: 'member@example.com', roleId: 'role-member' })
  })
  const draft = products.agent('ppt-studio')
  products.saveAgent({ ...draft, modelId: 'model-deepseek-chat', systemPrompt: 'PRIVATE_PROMPT', skill: 'PRIVATE_SKILL', published: true, price: 5 })
  const launched: string[] = []
  const api = await EnterpriseApi.create({
    publicPathPrefix: '/yituobo', store, resources: new TeamResources(join(directory, 'tenants')),
    tenantPath: team => `/yituobo/t/${team.slug}/harness/`, prepareTenant: async () => {},
    product: new ProductApi(products, store, {
      available: executor => executor !== 'video', start: (_team, _user, jobId) => { launched.push(jobId) },
      download: async (_team, _user, _job, response) => { response.end('artifact') },
    }), logger: { warn: () => {} },
  })
  const server = createServer((request, response) => { void api.handle(request, response, new URL(request.url ?? '/', 'http://test.local')) })
  await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve) })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Expected TCP listener')
  const origin = `http://127.0.0.1:${address.port}`
  const cookie = (id: string): string => {
    const user = store.snapshot().users.find(item => item.id === id)!
    const token = encodeSession({ version: 1, userId: id, sessionVersion: user.sessionVersion,
      issuedAt: Date.now(), expiresAt: Date.now() + 60_000 }, store.sessionKey)
    return `dsh_enterprise_session_${createHash('sha256').update('/yituobo').digest('hex').slice(0, 12)}=${token}`
  }
  const call = async (path: string, id?: string, body?: Record<string, unknown>, otherOrigin?: string) => {
    const response = await fetch(`${origin}/enterprise/api/product${path}`, { method: body ? 'POST' : 'GET',
      headers: { 'content-type': 'application/json', origin: otherOrigin ?? origin, ...(id ? { cookie: cookie(id) } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}) })
    return { status: response.status, body: await response.json() }
  }
  cleanups.push(async () => {
    server.closeAllConnections()
    await new Promise<void>((resolve) => { server.close(() => { resolve() }) })
    products.close(); await store.close()
    await rm(directory, { recursive: true, force: true })
  })
  return { store, products, call, launched }
}

describe('product API over console identity', () => {
  it('returns only the authenticated member wallet in the compact summary', async () => {
    const { call, products } = await fixture()
    products.credit('team-default', 'user-owner', 40, 'owner-credit', 'user-owner', 'fixture')
    expect((await call('/summary')).status).toBe(401)
    const member = await call('/summary', 'member')
    expect(member.status).toBe(200)
    expect(Object.keys(member.body)).toEqual(['wallet'])
    expect(member.body.wallet.balance).toBe(0)
    expect((await call('/summary', 'user-owner')).body.wallet.balance).toBe(40)
  })
  it('requires login, conceals prompts, and prevents member access to administrative transactions', async () => {
    const { call, products } = await fixture()
    expect((await call('/market')).status).toBe(401)
    const market = await call('/market', 'member')
    expect(market.status).toBe(200)
    expect(JSON.stringify(market.body)).not.toContain('PRIVATE_')
    expect((await call('/admin/catalog', 'member')).status).toBe(403)
    expect((await call('/admin/credit', 'member', { userId: 'member', teamId: 'team-default', points: 100, key: 'attack', note: 'credit' })).status).toBe(403)
    expect(products.wallet('team-default', 'member').balance).toBe(0)
    expect((await call('/admin/catalog', 'user-owner')).body.agents[0].systemPrompt).toBe('PRIVATE_PROMPT')
  })

  it('enforces same-origin mutations, configures rates, and admits an unlocked member task once', async () => {
    const { call, products, launched } = await fixture()
    expect((await call('/admin/rates', 'user-owner', { input: 100, output: 400 }, 'https://other.example')).status).toBe(403)
    expect(products.rates()).toBeNull()
    expect((await call('/admin/rates', 'user-owner', { input: 100, output: 400 })).status).toBe(200)
    expect((await call('/admin/wallet', 'user-owner', { userId: 'member', teamId: 'team-default', canRun: true, canPurchase: true })).status).toBe(200)
    expect((await call('/admin/credit', 'user-owner', { userId: 'member', teamId: 'team-default', points: 100, key: 'credit', note: 'trial' })).status).toBe(200)
    expect((await call('/jobs', 'member', { agentId: 'ppt-studio', input: 'Source material', key: 'job' })).status).toBe(403)
    const purchase = { agentId: 'ppt-studio', key: 'purchase' }
    expect((await call('/purchase', 'member', purchase)).status).toBe(200)
    expect((await call('/purchase', 'member', purchase)).status).toBe(200)
    expect(products.wallet('team-default', 'member').balance).toBe(95)
    const submitted = { agentId: 'ppt-studio', input: 'Source material', key: 'job' }
    const first = await call('/jobs', 'member', submitted)
    expect(first.status).toBe(202)
    expect((await call('/jobs', 'member', submitted)).body.id).toBe(first.body.id)
    expect(launched).toEqual([first.body.id])
    expect((await call(`/jobs/${first.body.id}`, 'user-owner')).status).toBe(404)
    expect((await call(`/jobs/${first.body.id}/download`, 'user-owner')).status).toBe(404)
  })

  it('rechecks disabled organization members and refuses publishing an unprovisioned executor', async () => {
    const { call, store } = await fixture()
    await store.mutate((draft) => { draft.users.find(item => item.id === 'member')!.status = 'disabled' })
    expect((await call('/market', 'member')).status).toBe(401)
    const invalid = await call('/admin/agents', 'user-owner', { id: 'bad', title: 'Bad', description: 'Bad executor', category: 'Test', executor: 'arbitrary-command', price: 0, durationDays: 30, published: true, modelId: 'model-deepseek-chat', systemPrompt: 'text', skill: 'text' })
    expect(invalid.status).toBe(400)
    expect((await call('/admin/agents', 'user-owner', { id: 'video', title: 'Video', description: 'Video executor', category: 'Test', executor: 'video', price: 0, durationDays: 30, published: true, modelId: 'model-deepseek-chat', systemPrompt: 'text', skill: 'text' })).status).toBe(409)
  })
})
