import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import type { AuditRecord, UsageRecord } from '../src/types.ts'
import { PERMISSIONS, RESOURCE_WRITE_PERMISSION } from '../src/types.ts'
import { EnterpriseStore } from '../src/store.ts'

const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  await Promise.all(cleanups.splice(0).reverse().map(cleanup => cleanup()))
})

async function openStore(): Promise<{ dataDir: string; store: EnterpriseStore }> {
  const dataDir = await mkdtemp(join(tmpdir(), 'dsh-enterprise-store-'))
  const opened = await EnterpriseStore.open(dataDir, 'owner@example.com', 'Enterprise Test')
  cleanups.push(async () => {
    await opened.store.close()
    await rm(dataDir, { recursive: true, force: true })
  })
  return { dataDir, store: opened.store }
}

function usage(id: string, overrides: Partial<UsageRecord> = {}): UsageRecord {
  return {
    id,
    teamId: 'team-default',
    modelId: 'model-deepseek-chat',
    requests: 2,
    inputTokens: 100,
    outputTokens: 50,
    costCents: 7,
    recordedAt: '2026-10-30T10:00:00.000Z',
    ...overrides,
  }
}

function audit(id: string, overrides: Partial<AuditRecord> = {}): AuditRecord {
  return {
    id,
    actorEmail: 'owner@example.com',
    action: 'test.action',
    targetType: 'test',
    summary: 'test audit',
    ip: '127.0.0.1',
    createdAt: '2026-10-30T10:00:00.000Z',
    ...overrides,
  }
}

describe('enterprise SQLite store', { concurrent: false }, () => {
  it('persists catalog mutations across reopen', async () => {
    const { dataDir, store } = await openStore()
    await store.mutate((draft) => {
      const owner = draft.users[0]
      if (owner === undefined) throw new Error('seeded owner is missing')
      owner.name = 'Renamed Owner'
      draft.teams.push({
        id: 'team-delivery',
        name: 'Delivery',
        slug: 'delivery',
        planId: 'plan-starter',
        status: 'active',
        seatLimit: 8,
        notes: '',
        createdAt: '2026-10-30T10:00:00.000Z',
      })
    })
    await store.close()

    const reopened = await EnterpriseStore.open(dataDir, 'owner@example.com', 'Enterprise Test')
    cleanups.push(async () => { await reopened.store.close() })
    expect(reopened.seeded).toBe(false)
    expect(reopened.store.snapshot().users[0]?.name).toBe('Renamed Owner')
    expect(reopened.store.snapshot().teams.some(team => team.id === 'team-delivery')).toBe(true)
  })

  it('appends usage and audit rows and restores them after reopen', async () => {
    const { dataDir, store } = await openStore()
    await store.mutate((draft) => {
      draft.usage.push(usage('usage-a'))
      draft.audit.push(audit('audit-a'))
    })
    await store.close()

    const reopened = await EnterpriseStore.open(dataDir, 'owner@example.com', 'Enterprise Test')
    cleanups.push(async () => { await reopened.store.close() })
    expect(reopened.store.usageReport({ limit: 10 }).records).toEqual([
      expect.objectContaining({ id: 'usage-a', requests: 2, costCents: 7 }),
    ])
    expect(reopened.store.auditRecords({ limit: 10 })).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'audit-a', action: 'test.action' }),
    ]))
    expect(reopened.store.snapshot()).not.toHaveProperty('usage')
    expect(reopened.store.snapshot()).not.toHaveProperty('audit')
  })

  it('filters usage and computes its summary in SQLite', async () => {
    const { store } = await openStore()
    await store.mutate((draft) => {
      draft.usage.push(
        usage('usage-a', { teamId: 'team-default', requests: 2, inputTokens: 100, outputTokens: 50, costCents: 7 }),
        usage('usage-b', { id: 'usage-b', teamId: 'team-other', requests: 3, inputTokens: 200, outputTokens: 80, costCents: 11, recordedAt: '2026-10-31T10:00:00.000Z' }),
      )
    })

    const report = store.usageReport({ teamId: 'team-default', limit: 10 })
    expect(report.records.map(record => record.id)).toEqual(['usage-a'])
    expect(report.summary).toEqual({ requests: 2, inputTokens: 100, outputTokens: 50, costCents: 7 })

    const limited = store.usageReport({ limit: 1 })
    expect(limited.records.map(record => record.id)).toEqual(['usage-b'])
    expect(limited.summary).toEqual({ requests: 5, inputTokens: 300, outputTokens: 130, costCents: 18 })
  })

  it('filters audit records and reports model usage existence', async () => {
    const { store } = await openStore()
    await store.mutate((draft) => {
      draft.usage.push(usage('usage-a'))
      draft.audit.push(
        audit('audit-a', { action: 'user.create', actorEmail: 'admin@example.com' }),
        audit('audit-b', { id: 'audit-b', action: 'team.create', actorEmail: 'owner@example.com', createdAt: '2099-12-31T10:00:00.000Z' }),
      )
    })

    expect(store.auditRecords({ action: 'user.create', limit: 10 }).map(record => record.id)).toEqual(['audit-a'])
    expect(store.auditRecords({ actor: 'owner', limit: 10 }).map(record => record.id)).toEqual(['audit-b'])
    expect(store.auditRecords({ limit: 1 }).map(record => record.id)).toEqual(['audit-b'])
    expect(store.hasUsageForModel('model-deepseek-chat')).toBe(true)
    expect(store.hasUsageForModel('model-missing')).toBe(false)
  })

  it('rolls back catalog, usage, and audit writes when the mutation throws', async () => {
    const { store } = await openStore()
    await expect(store.mutate((draft) => {
      const owner = draft.users[0]
      if (owner === undefined) throw new Error('seeded owner is missing')
      owner.name = 'Should Not Persist'
      draft.usage.push(usage('usage-rollback'))
      draft.audit.push(audit('audit-rollback'))
      throw new Error('abort')
    })).rejects.toThrow('abort')

    expect(store.snapshot().users[0]?.name).not.toBe('Should Not Persist')
    expect(store.usageReport({ limit: 10 }).records).toEqual([])
    expect(store.auditRecords({ limit: 10 }).some(record => record.id === 'audit-rollback')).toBe(false)
  })

  it('migrates a version-1 database through phone and default-team settings', async () => {
    const { dataDir, store } = await openStore()
    await store.close()

    const database = new DatabaseSync(join(dataDir, 'enterprise.sqlite'))
    try {
      database.exec('DROP INDEX users_phone')
      database.exec('ALTER TABLE users DROP COLUMN phone')
      database.exec('ALTER TABLE settings DROP COLUMN default_team_id')
      database.prepare('UPDATE meta SET value = ? WHERE key = ?').run('1', 'schema_version')
    } finally {
      database.close()
    }

    const reopened = await EnterpriseStore.open(dataDir, 'owner@example.com', 'Enterprise Test')
    cleanups.push(async () => { await reopened.store.close() })
    expect(reopened.store.snapshot().settings.defaultTeamId).toBe('team-default')
    expect(reopened.store.snapshot().users[0]).not.toHaveProperty('phone')
  })

  it('backfills shared-resource management for owners from schema version 3', async () => {
    const { dataDir, store } = await openStore()
    await store.close()

    const database = new DatabaseSync(join(dataDir, 'enterprise.sqlite'))
    try {
      const legacyPermissions = PERMISSIONS.filter(permission => permission !== RESOURCE_WRITE_PERMISSION)
      database.prepare('UPDATE roles SET permissions = ? WHERE id = ?')
        .run(JSON.stringify(legacyPermissions), 'role-owner')
      database.prepare('UPDATE meta SET value = ? WHERE key = ?').run('3', 'schema_version')
    } finally {
      database.close()
    }

    const reopened = await EnterpriseStore.open(dataDir, 'owner@example.com', 'Enterprise Test')
    cleanups.push(async () => { await reopened.store.close() })
    const roles = reopened.store.snapshot().roles
    expect(roles.find(role => role.id === 'role-owner')?.permissions).toContain(RESOURCE_WRITE_PERMISSION)
    expect(roles.find(role => role.id === 'role-admin')?.permissions).not.toContain(RESOURCE_WRITE_PERMISSION)
  })

  it('migrates channels from schema version 7 with the chat-completions protocol', async () => {
    const { dataDir, store } = await openStore()
    await store.close()

    const database = new DatabaseSync(join(dataDir, 'enterprise.sqlite'))
    try {
      database.exec('ALTER TABLE channels DROP COLUMN wire_protocol')
      database.prepare('UPDATE meta SET value = ? WHERE key = ?').run('7', 'schema_version')
    } finally {
      database.close()
    }

    const reopened = await EnterpriseStore.open(dataDir, 'owner@example.com', 'Enterprise Test')
    cleanups.push(async () => { await reopened.store.close() })
    expect(reopened.store.snapshot().channels).toEqual([
      expect.objectContaining({ id: 'channel-deepseek', wireProtocol: 'openai-chat' }),
    ])
  })

  it('opens a schema-8 database with the gateway attempt ledger', async () => {
    const { dataDir, store } = await openStore()
    await store.close()

    const database = new DatabaseSync(join(dataDir, 'enterprise.sqlite'))
    try {
      database.prepare('UPDATE meta SET value = ? WHERE key = ?').run('8', 'schema_version')
    } finally {
      database.close()
    }

    const reopened = await EnterpriseStore.open(dataDir, 'owner@example.com', 'Enterprise Test')
    cleanups.push(async () => { await reopened.store.close() })
    const started = await reopened.store.beginDesktopGatewayAttempt({
      id: 'attempt-migrated',
      requestId: 'request-migrated',
      teamId: 'team-default',
      userId: 'user-owner',
      modelId: 'model-deepseek-chat',
      channelId: 'channel-deepseek',
      startedAt: '2026-11-04T12:00:00.000Z',
    })
    expect(started).toMatchObject({
      created: true,
      attempt: { id: 'attempt-migrated', requestId: 'request-migrated', status: 'started' },
    })
    expect(reopened.store.desktopGatewayAttempt('team-default', 'request-migrated')).toMatchObject({
      id: 'attempt-migrated',
      status: 'started',
    })
  })
})
