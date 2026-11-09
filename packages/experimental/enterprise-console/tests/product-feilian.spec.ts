import { createServer } from 'node:http'
import { randomBytes } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ProductFeilian } from '../src/product-feilian.ts'
import { ProductStore } from '../src/product-store.ts'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'zhiliu-feilian-'))
  const store = await ProductStore.open(directory)
  let invalid = false, revoked = 0, queries = 0, logins = 0
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = []
    for await (const chunk of request) chunks.push(Buffer.from(chunk))
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}
    response.setHeader('content-type', 'application/json')
    if (request.url === '/api/v1/plugin/auth/login') {
      logins++
      if (body.password !== 'fixture-password') { response.writeHead(401); response.end('{}'); return }
      response.end(JSON.stringify({ token: 'kb_fixture_readonly', member_token: 'fixture_elevated_member_token', knowledge_bases: [{ id: 'kb-a', name: 'Team knowledge' }] })); return
    }
    if (invalid) { response.writeHead(401); response.end('{}'); return }
    if (request.headers.authorization !== 'Bearer kb_fixture_readonly') { response.writeHead(403); response.end('{}'); return }
    if (request.url === '/api/v1/external/capabilities') response.end(JSON.stringify({ knowledge_bases: [{ id: 'kb-a', name: 'Team knowledge' }] }))
    else if (request.url === '/api/v1/plugin/auth/revoke') { revoked++; response.end('{"revoked":true}') }
    else if (request.url === '/api/v1/external/query') {
      queries++
      if (body.knowledge_base_id !== 'kb-a') { response.writeHead(403); response.end('{}'); return }
      response.end(JSON.stringify({ answer: `Knowledge answer: ${body.question}` }))
    } else { response.writeHead(404); response.end('{}') }
  })
  await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve) })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Expected listener')
  const service = new ProductFeilian(store, randomBytes(32), { baseUrl: `http://127.0.0.1:${address.port}`, timeoutMs: 1000 })
  cleanups.push(async () => {
    server.closeAllConnections()
    await new Promise<void>((resolve) => { server.close(() => { resolve() }) })
    store.close()
    await rm(directory, { recursive: true, force: true })
  })
  return { service, store, invalidate: () => { invalid = true }, counts: () => ({ revoked, queries, logins }) }
}

describe('independent Feilian binding', () => {
  it('stores only the encrypted restricted credential and discovers live account-scoped knowledge', async () => {
    const { service, store } = await fixture()
    await service.bind('team', 'alice', 'alice@example.com', 'fixture-password')
    const binding = store.binding('team', 'alice')!
    expect(binding.encryptedKey).toMatch(/^v1\./u)
    expect(JSON.stringify(binding)).not.toContain('fixture_')
    const status = await service.status('team', 'alice')
    expect(status).toMatchObject({ bound: true, state: 'connected', knowledgeBases: [{ id: 'kb-a' }] })
    expect(JSON.stringify(status)).not.toContain('token')
    expect(await service.status('team', 'bob')).toMatchObject({ bound: false, state: 'unbound', knowledgeBases: [] })
    expect(await service.status('other', 'alice')).toMatchObject({ bound: false, state: 'unbound' })
    expect(store.wallet('team', 'alice').balance).toBe(0)
  })

  it('contains invalid login and serializes simultaneous credential exchanges', async () => {
    const { service, store, counts } = await fixture()
    await expect(service.bind('team', 'alice', 'alice@example.com', 'wrong')).rejects.toMatchObject({ code: 'feilian_auth_required' })
    expect(store.binding('team', 'alice')).toBeNull()
    const attempts = await Promise.allSettled([
      service.bind('team', 'alice', 'alice@example.com', 'fixture-password'),
      service.bind('team', 'alice', 'alice@example.com', 'fixture-password'),
    ])
    expect(attempts.map(item => item.status).sort()).toEqual(['fulfilled', 'rejected'])
    expect(counts().logins).toBe(2)
  })

  it('uses the selected KB, leaves Zhiliu points independent, and revokes before unbinding', async () => {
    const { service, store, counts } = await fixture()
    await service.bind('team', 'alice', 'alice@example.com', 'fixture-password')
    await expect(service.query('team', 'bob', 'kb-a', 'Question')).rejects.toMatchObject({ code: 'feilian_unbound' })
    expect(await service.query('team', 'alice', 'kb-a', 'Question')).toEqual({ answer: 'Knowledge answer: Question' })
    await expect(service.query('team', 'alice', 'kb-other', 'Question')).rejects.toMatchObject({ code: 'feilian_auth_required' })
    expect(store.ledger('team', 'alice')).toHaveLength(0)
    await service.unbind('team', 'alice')
    expect(counts()).toMatchObject({ revoked: 1, queries: 2 })
    expect(store.binding('team', 'alice')).toBeNull()
  })

  it('shows reauthorization when the external key expires', async () => {
    const { service, invalidate } = await fixture()
    await service.bind('team', 'alice', 'alice@example.com', 'fixture-password')
    invalidate()
    expect(await service.status('team', 'alice')).toMatchObject({ bound: true, state: 'reauth', knowledgeBases: [] })
    await service.unbind('team', 'alice')
    expect(await service.status('team', 'alice')).toMatchObject({ bound: false, state: 'unbound' })
  })
})
