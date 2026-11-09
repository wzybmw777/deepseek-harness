import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ProductStore } from '../src/product-store.ts'

const cleanup: Array<() => Promise<void>> = []
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close() })

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'zhiliu-product-'))
  let store = await ProductStore.open(directory)
  cleanup.push(async () => { store.close(); await rm(directory, { recursive: true, force: true }) })
  const draft = store.agent('ppt-studio')
  const agent = store.saveAgent({ ...draft, price: 10, modelId: 'model', published: true })
  store.setRates({ input: 100, output: 400 })
  store.policy('team', 'alice', true, true)
  store.credit('team', 'alice', 100, 'initial', 'admin', 'Initial allocation')
  return { get store() { return store }, agent,
    restart: async () => { store.close(); store = await ProductStore.open(directory) } }
}

describe('allocated points and agent rights', () => {
  it('charges once and counts exactly thirty continuous days across month boundaries', async () => {
    const { store, agent } = await fixture()
    const at = new Date('2028-02-20T15:23:45.000Z')
    const first = store.purchase('team', 'alice', agent.id, 'buy', at)
    expect(first.expiresAt).toBe('2028-03-21T15:23:45.000Z')
    expect(store.purchase('team', 'alice', agent.id, 'buy', at)).toEqual(first)
    expect(store.wallet('team', 'alice').balance).toBe(90)
    expect(store.entitlement('team', 'alice', agent.id, new Date('2028-03-21T15:23:44.999Z'))?.active).toBe(true)
    expect(store.entitlement('team', 'alice', agent.id, new Date(first.expiresAt!))?.active).toBe(false)
    expect(() => store.purchase('team', 'alice', agent.id, 'again', at)).toThrow('有效期')
    expect(store.ledger('team', 'alice').filter(row => row.kind === 'unlock')).toHaveLength(1)
  })

  it('supports permanent and custom durations, without sharing rights with another member or team', async () => {
    const { store, agent } = await fixture()
    store.saveAgent({ ...agent, durationDays: null })
    store.purchase('team', 'alice', agent.id, 'permanent')
    expect(store.entitlement('team', 'alice', agent.id, new Date('2099-01-01'))).toMatchObject({ active: true, expiresAt: null })
    expect(store.entitlement('team', 'bob', agent.id)).toBeNull()
    expect(store.entitlement('other', 'alice', agent.id)).toBeNull()
    expect(store.wallet('team', 'bob')).toMatchObject({ balance: 0, canRun: false, canPurchase: false })
    store.saveAgent({ ...agent, durationDays: 7 })
    store.policy('team', 'bob', true, true)
    store.credit('team', 'bob', 20, 'bob', 'admin', 'Allocation')
    expect(store.purchase('team', 'bob', agent.id, 'custom', new Date('2026-11-01T00:00:00Z')).expiresAt).toBe('2026-11-08T00:00:00.000Z')
  })

  it('rejects purchasing without explicit policy or available funds, and rolls back all side effects', async () => {
    const { store, agent } = await fixture()
    expect(() => store.purchase('team', 'bob', agent.id, 'buy')).toThrow('购买权限')
    store.policy('team', 'bob', true, false)
    expect(() => store.purchase('team', 'bob', agent.id, 'buy')).toThrow('积分不足')
    expect(store.entitlement('team', 'bob', agent.id)).toBeNull()
    expect(store.ledger('team', 'bob')).toHaveLength(0)
    store.saveAgent({ ...agent, published: false })
    expect(() => store.purchase('team', 'alice', agent.id, 'buy')).toThrow('下架')
  })

  it('deduplicates administrative credits and rejects reuse for a different transaction', async () => {
    const { store } = await fixture()
    store.credit('team', 'alice', 100, 'initial', 'admin', 'Retry')
    expect(store.wallet('team', 'alice').balance).toBe(100)
    expect(() => store.credit('team', 'bob', 100, 'initial', 'admin', 'Wrong recipient')).toThrow('另一笔')
    expect(store.wallet('team', 'bob').balance).toBe(0)
  })

  it('checks the right and member permission at actual model dispatch, including revocation after task submission', async () => {
    const { store, agent } = await fixture()
    expect(() => store.createJob('team', 'alice', agent.id, 'Material', 'job')).toThrow('解锁')
    store.purchase('team', 'alice', agent.id, 'buy')
    const admitted = store.createJob('team', 'alice', agent.id, 'Material', 'job')
    expect(store.createJob('team', 'alice', agent.id, 'Material', 'job')).toMatchObject({ created: false, job: { id: admitted.job.id } })
    expect(() => store.createJob('team', 'alice', agent.id, 'Changed material', 'job')).toThrow('标识')
    store.grant('team', 'alice', agent.id, null, true)
    expect(() => store.reserve(admitted.job.id, 'team', 'alice', 100_000, '{}')).toThrow('解锁')
    expect(store.wallet('team', 'alice').reserved).toBe(0)
    store.grant('team', 'alice', agent.id, null, false)
    store.policy('team', 'alice', true, false)
    expect(() => store.reserve(admitted.job.id, 'team', 'alice', 100_000, '{}')).toThrow('运行权限')
  })

  it('settles exact provider tokens with frozen rates, releases the hold, and never charges a retry twice', async () => {
    const { store, agent } = await fixture()
    store.purchase('team', 'alice', agent.id, 'buy')
    const { job } = store.createJob('team', 'alice', agent.id, 'Material', 'job')
    const attempt = store.reserve(job.id, 'team', 'alice', 100_000, '{"messages":[]}')
    expect(store.wallet('team', 'alice')).toMatchObject({ balance: 90, reserved: 40 })
    store.setRates({ input: 900, output: 900 })
    store.settle(attempt, 'response', { inputTokens: 1000, outputTokens: 500 })
    store.settle(attempt, 'retry', { inputTokens: 1000, outputTokens: 500 })
    expect(store.wallet('team', 'alice')).toMatchObject({ balance: 89.7, reserved: 0 })
    expect(store.job('team', 'alice', job.id).charged).toBe(.3)
    expect(store.ledger('team', 'alice').filter(row => row.kind === 'usage')).toHaveLength(1)
  })

  it('prevents overspending across reservations and rejects another member reading an artifact task', async () => {
    const { store, agent } = await fixture()
    store.purchase('team', 'alice', agent.id, 'buy')
    const { job } = store.createJob('team', 'alice', agent.id, 'Material', 'job')
    store.reserve(job.id, 'team', 'alice', 200_000, '{}')
    expect(() => store.reserve(job.id, 'team', 'alice', 100_000, '{}')).toThrow('预留')
    expect(store.wallet('team', 'alice')).toMatchObject({ balance: 90, reserved: 80 })
    expect(() => store.job('team', 'bob', job.id)).toThrow('不存在')
    expect(() => store.job('other', 'alice', job.id)).toThrow('不存在')
  })

  it('preserves unresolved model charges across restart and marks the interrupted task visibly', async () => {
    const fixture_ = await fixture()
    fixture_.store.purchase('team', 'alice', fixture_.agent.id, 'buy')
    const { job } = fixture_.store.createJob('team', 'alice', fixture_.agent.id, 'Material', 'job')
    const attempt = fixture_.store.reserve(job.id, 'team', 'alice', 100_000, '{}')
    fixture_.store.settle(attempt, 'Provider omitted usage', null)
    await fixture_.restart()
    expect(fixture_.store.wallet('team', 'alice')).toMatchObject({ balance: 90, reserved: 40 })
    expect(fixture_.store.job('team', 'alice', job.id)).toMatchObject({ state: 'interrupted', error: expect.stringContaining('中断') })
  })

  it('does not expose administrative prompts in the user-visible transaction snapshot', async () => {
    const { store, agent } = await fixture()
    store.purchase('team', 'alice', agent.id, 'buy', new Date('2026-11-07T00:00:00Z'))
    expect({ wallet: store.wallet('team', 'alice'), entitlement: store.entitlement('team', 'alice', agent.id, new Date('2026-11-08T00:00:00Z')),
      ledger: store.ledger('team', 'alice').map(({ delta, kind }) => ({ delta, kind })) }).toMatchInlineSnapshot(`
      {
        "entitlement": {
          "active": true,
          "agentId": "ppt-studio",
          "expiresAt": "2026-12-07T00:00:00.000Z",
        },
        "ledger": [
          {
            "delta": -10,
            "kind": "unlock",
          },
          {
            "delta": 100,
            "kind": "credit",
          },
        ],
        "wallet": {
          "balance": 90,
          "canPurchase": true,
          "canRun": true,
          "reserved": 0,
          "teamId": "team",
          "userId": "alice",
        },
      }
    `)
  })

  it('reconciles a retained hold once and rolls back an excessive reconciliation', async () => {
    const { store, agent } = await fixture()
    store.purchase('team', 'alice', agent.id, 'buy')
    const { job } = store.createJob('team', 'alice', agent.id, 'Material', 'review-job')
    const attempt = store.reserve(job.id, 'team', 'alice', 100_000, '{}')
    store.settle(attempt, 'Unknown provider usage', null)
    expect(() => store.resolve(attempt, 1000, 500, 'admin', 'Provider invoice')).toThrow('仍在执行')
    store.updateJob(job.id, 'interrupted')
    expect(() => store.resolve(attempt, 1_000_000, 0, 'admin', 'Excessive count')).toThrow('exceeded')
    expect(store.wallet('team', 'alice')).toMatchObject({ balance: 90, reserved: 40 })
    expect(store.reviews()).toHaveLength(1)
    store.resolve(attempt, 1000, 500, 'admin', 'Provider invoice')
    store.resolve(attempt, 1000, 500, 'admin', 'Retried invoice')
    expect(store.wallet('team', 'alice')).toMatchObject({ balance: 89.7, reserved: 0 })
    expect(store.reviews()).toHaveLength(0)
    expect(store.job('team', 'alice', job.id).charged).toBe(.3)
    expect(store.ledger('team', 'alice').filter(row => row.kind === 'usage')).toHaveLength(1)
  })
})
