import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { DesktopModels } from '../src/desktop-models.ts'
import { EnterpriseStore } from '../src/store.ts'
import type { ChannelRecord, EnterpriseData, UserRecord } from '../src/types.ts'

const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  await Promise.all(cleanups.splice(0).reverse().map(cleanup => cleanup()))
})

async function openStore(): Promise<EnterpriseStore> {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-desktop-models-'))
  const opened = await EnterpriseStore.open(directory, 'owner@example.com', 'Enterprise Test')
  cleanups.push(async () => {
    await opened.store.close()
    await rm(directory, { recursive: true, force: true })
  })
  return opened.store
}

function owner(store: EnterpriseStore): UserRecord {
  const user = store.snapshot().users.find(candidate => candidate.id === 'user-owner')
  if (user === undefined) throw new Error('seeded owner is missing')
  return user
}

function session(store: EnterpriseStore, user = owner(store)) {
  return { kind: 'member' as const, user, permissions: ['workspace.use'] }
}

function channel(id: string, overrides: Partial<ChannelRecord> = {}): ChannelRecord {
  return {
    id,
    name: `Channel ${id}`,
    provider: 'openai',
    baseUrl: 'https://models.example.com',
    encryptedApiKey: 'sealed-secret',
    wireProtocol: 'openai-chat',
    priority: 5,
    status: 'active',
    createdAt: '2026-10-30T10:00:00.000Z',
    updatedAt: '2026-10-30T10:00:00.000Z',
    ...overrides,
  }
}

function thrown(operation: () => unknown): unknown {
  try {
    operation()
  } catch (error) {
    return error
  }
  throw new Error('Expected operation to throw')
}

describe('Desktop model catalog', () => {
  it('lists only active Desktop models with an active channel and quota', async () => {
    const store = await openStore()
    await store.mutate((draft) => {
      draft.channels.push(channel('channel-disabled', { status: 'disabled' }))
      draft.models.push(
        {
          id: 'model-disabled', name: 'disabled-upstream', displayName: 'Disabled Model',
          channelId: 'channel-deepseek', inputPricePerMillionCents: 100, outputPricePerMillionCents: 200,
          contextWindow: 64_000, capabilities: ['文本'], status: 'disabled', createdAt: '2026-10-30T10:00:00.000Z',
        },
        {
          id: 'model-inactive-channel', name: 'inactive-upstream', displayName: 'Inactive Channel Model',
          channelId: 'channel-disabled', inputPricePerMillionCents: 100, outputPricePerMillionCents: 200,
          contextWindow: 64_000, capabilities: ['文本'], status: 'active', createdAt: '2026-10-30T10:00:00.000Z',
        },
      )
    })

    const catalog = new DesktopModels(store, { now: () => new Date('2026-11-04T12:00:00.000Z') }).catalog(session(store))

    expect(catalog.models.map(model => model.id)).toEqual(['model-deepseek-chat', 'model-deepseek-reasoner'])
    expect(catalog.models[0]).toMatchObject({
      id: 'model-deepseek-chat',
      name: 'DeepSeek Chat',
      protocol: 'openai-chat',
      gatewayBasePath: '/enterprise/api/desktop/gateway/model-deepseek-chat',
      upstreamModelId: 'deepseek-chat',
      contextWindow: 128_000,
      capabilities: ['文本', '工具调用'],
    })
    expect(JSON.stringify(catalog)).not.toContain('https://api.deepseek.com')
    expect(JSON.stringify(catalog)).not.toContain('encryptedApiKey')
    expect(JSON.stringify(catalog)).not.toContain('sealed-secret')
  })

  it('returns the current member and team usage in the catalog quota', async () => {
    const store = await openStore()
    await store.mutate((draft) => {
      draft.users.push({
        id: 'user-teammate', email: 'teammate@example.com', name: 'Teammate', passwordHash: 'unused',
        roleId: 'role-member', teamId: 'team-default', status: 'active', sessionVersion: 1,
        createdAt: '2026-10-30T10:00:00.000Z',
      })
      draft.usage.push(
        {
          id: 'usage-owner', teamId: 'team-default', userId: 'user-owner', modelId: 'model-deepseek-chat',
          requests: 2, inputTokens: 1_000, outputTokens: 500, costCents: 4,
          recordedAt: '2026-11-03T10:00:00.000Z',
        },
        {
          id: 'usage-teammate', teamId: 'team-default', userId: 'user-teammate', modelId: 'model-deepseek-chat',
          requests: 1, inputTokens: 200, outputTokens: 100, costCents: 1,
          recordedAt: '2026-11-03T11:00:00.000Z',
        },
        {
          id: 'usage-last-cycle', teamId: 'team-default', userId: 'user-owner', modelId: 'model-deepseek-chat',
          requests: 9, inputTokens: 9_000, outputTokens: 9_000, costCents: 90,
          recordedAt: '2026-10-31T11:00:00.000Z',
        },
      )
    })

    const catalog = new DesktopModels(store, { now: () => new Date('2026-11-04T12:00:00.000Z') }).catalog(session(store))

    expect(catalog.quota).toEqual({
      planName: '团队版',
      totalTokens: 5_000_000,
      usedTokens: 1_800,
      remainingTokens: 4_998_200,
      userTokens: 1_500,
      cycleStartsAt: '2026-11-01T00:00:00.000Z',
      cycleEndsAt: '2026-12-01T00:00:00.000Z',
    })
    expect(catalog.refreshedAt).toBe('2026-11-04T12:00:00.000Z')
  })

  it('rejects a disabled model or suspended team before returning a route', async () => {
    const store = await openStore()
    const models = new DesktopModels(store, { now: () => new Date('2026-11-04T12:00:00.000Z') })
    await store.mutate((draft: EnterpriseData) => {
      const model = draft.models.find(candidate => candidate.id === 'model-deepseek-chat')
      if (model === undefined) throw new Error('seeded model is missing')
      model.status = 'disabled'
    })
    expect(thrown(() => models.resolve(session(store), 'model-deepseek-chat'))).toMatchObject({
      status: 409,
      code: 'model_unavailable',
    })

    await store.mutate((draft) => {
      const team = draft.teams.find(candidate => candidate.id === 'team-default')
      if (team === undefined) throw new Error('seeded team is missing')
      team.status = 'suspended'
    })
    expect(thrown(() => models.catalog(session(store)))).toMatchObject({
      status: 403,
      code: 'team_unavailable',
    })
  })
})
