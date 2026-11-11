import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import { loadAgentCatalogSeed } from '../src/agent-catalog.ts'
import { ProductStore } from '../src/product-store.ts'

const cleanup: Array<() => Promise<void>> = []
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close() })

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'zhiliu-product-'))
  let store = await ProductStore.open(directory)
  cleanup.push(async () => { store.close(); await rm(directory, { recursive: true, force: true }) })
  const draft = store.agent('ppt-studio')
  const agent = store.saveAgent({ ...draft, modelId: 'model', published: true })
  return { get store() { return store }, agent,
    restart: async () => { store.close(); store = await ProductStore.open(directory) } }
}

describe('plan-based agent access', () => {
  it('seeds the shipped catalog once and keeps every entry as an editable draft', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'zhiliu-catalog-'))
    const seed = await loadAgentCatalogSeed()
    if (seed === undefined) throw new Error('the agent-hub bundle must ship a readable catalog')
    try {
      let store = await ProductStore.open(directory, seed)
      const catalog = store.agents().filter(agent => agent.group === '企业经营参谋')
      expect(catalog).toHaveLength(8)
      expect(catalog.every(agent => !agent.published && agent.tasks && agent.materials && agent.deliverables && agent.example)).toBe(true)
      expect(catalog.find(agent => agent.id === 'legal-risk')?.disclaimer).toContain('不替代专业律师')
      store.saveAgent({ ...store.agent('legal-risk'), title: '法务风控（改）' })
      store.close()
      store = await ProductStore.open(directory, seed)
      expect(store.agent('legal-risk').title).toBe('法务风控（改）')
      store.close()
      store = await ProductStore.open(directory, { ...seed, version: 'next-shipped-version' })
      expect(store.agent('legal-risk').title).toBe('法务风控（改）')
      store.close()
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('seeds into a database upgraded from the v1 layout', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'zhiliu-catalog-v1-'))
    const database = new DatabaseSync(join(directory, 'product.sqlite'))
    database.exec(`CREATE TABLE agents (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT NOT NULL, category TEXT NOT NULL,
      output TEXT NOT NULL, executor TEXT NOT NULL, price INTEGER NOT NULL, duration_days INTEGER,
      published INTEGER NOT NULL, model_id TEXT NOT NULL, system_prompt TEXT NOT NULL, skill TEXT NOT NULL,
      revision INTEGER NOT NULL
    ) STRICT; PRAGMA user_version=1;`)
    database.close()
    const seed = await loadAgentCatalogSeed()
    if (seed === undefined) throw new Error('the agent-hub bundle must ship a readable catalog')
    try {
      const store = await ProductStore.open(directory, seed)
      expect(store.agent('legal-risk').price).toBe(0)
      expect(store.agent('legal-risk').group).toBe('企业经营参谋')
      store.close()
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('unlocks permanently and idempotently without charging points', async () => {
    const { store, agent } = await fixture()
    const at = new Date('2028-02-20T15:23:45.000Z')
    const first = store.purchase('team', 'alice', agent.id, 'buy', at)
    expect(first).toEqual({ agentId: agent.id, expiresAt: null, active: true })
    expect(store.purchase('team', 'alice', agent.id, 'buy', at)).toEqual(first)
    expect(() => store.purchase('team', 'alice', agent.id, 'again', at)).toThrow('有效期')
    expect(store.entitlement('team', 'alice', agent.id)?.active).toBe(true)
    expect(store.entitlement('team', 'bob', agent.id)).toBeNull()
    expect(store.unlockedAgents('team')).toBe(1)
    expect(store.unlockedAgents('other')).toBe(0)
  })

  it('counts each unlocked agent once even when several members receive it', async () => {
    const { store, agent } = await fixture()
    store.purchase('team', 'alice', agent.id, 'buy')
    store.grant('team', 'bob', agent.id, null, false)
    expect(store.unlockedAgents('team')).toBe(1)
    expect(store.entitlement('team', 'bob', agent.id)?.active).toBe(true)
    store.grant('team', 'bob', agent.id, null, true)
    expect(store.entitlement('team', 'bob', agent.id)?.active).toBe(false)
    expect(store.unlockedAgents('team')).toBe(1)
  })

  it('requires an active unlock before admitting and running a task', async () => {
    const { store, agent } = await fixture()
    expect(() => store.createJob('team', 'alice', agent.id, 'Material', 'job')).toThrow('请先解锁')
    store.purchase('team', 'alice', agent.id, 'buy')
    const { job } = store.createJob('team', 'alice', agent.id, 'Material', 'job')
    const attempt = store.reserve(job.id, 'team', 'alice', 100_000, '{"messages":[]}')
    store.settle(attempt, 'response', { inputTokens: 1000, outputTokens: 500 })
    store.settle(attempt, 'retry', { inputTokens: 1000, outputTokens: 500 })
    expect(store.job('team', 'alice', job.id)).toMatchObject({ state: 'queued', charged: 0 })
    expect(() => store.job('team', 'bob', job.id)).toThrow('不存在')
    expect(() => store.job('other', 'alice', job.id)).toThrow('不存在')
  })

  it('keeps the unlock and marks an interrupted task across restart', async () => {
    const fixture_ = await fixture()
    fixture_.store.purchase('team', 'alice', fixture_.agent.id, 'buy')
    const { job } = fixture_.store.createJob('team', 'alice', fixture_.agent.id, 'Material', 'job')
    const attempt = fixture_.store.reserve(job.id, 'team', 'alice', 100_000, '{}')
    fixture_.store.settle(attempt, 'Provider omitted usage', null)
    expect(fixture_.store.agent(fixture_.agent.id).published).toBe(true)
    await fixture_.restart()
    expect(fixture_.store.entitlement('team', 'alice', fixture_.agent.id)?.active).toBe(true)
    expect(fixture_.store.job('team', 'alice', job.id)).toMatchObject({ state: 'interrupted', error: expect.stringContaining('中断') })
  })
})
