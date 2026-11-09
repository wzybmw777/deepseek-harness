/** Transactional points, entitlement, and job owner, independent of legacy token quotas. */

import { randomUUID } from 'node:crypto'
import { chmod, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { DatabaseSync, type SQLOutputValue } from 'node:sqlite'
import { HttpError } from './http.ts'
import type { AgentEntitlement, AgentJob, AgentProduct, PointsRates, PointsWallet } from './product-types.ts'

const UNIT = 1_000_000
type Row = Record<string, SQLOutputValue>

function str(row: Row, key: string): string {
  const value = row[key]
  if (typeof value !== 'string') throw new Error(`Invalid product database string: ${key}`)
  return value
}
function num(row: Row, key: string): number {
  const value = row[key]
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) throw new Error(`Invalid product database integer: ${key}`)
  return value
}
function nullable(row: Row, key: string): string | null { return row[key] === null ? null : str(row, key) }
function micros(points: number): number {
  const value = Math.round(points * UNIT)
  if (!Number.isSafeInteger(value) || value < 0 || points > 1_000_000_000) throw new HttpError(400, '积分数值超出范围', 'invalid_points')
  return value
}
function product(row: Row): AgentProduct {
  const output = str(row, 'output')
  const executor = str(row, 'executor')
  if (output !== 'pptx' && output !== 'text' && output !== 'video') throw new Error('Invalid product output')
  if (executor !== 'ppt-master' && executor !== 'text' && executor !== 'video') throw new Error('Invalid product executor')
  return {
    id: str(row, 'id'), title: str(row, 'title'), description: str(row, 'description'), category: str(row, 'category'),
    output, executor, price: num(row, 'price') / UNIT, durationDays: row.duration_days === null ? null : num(row, 'duration_days'),
    published: num(row, 'published') === 1, modelId: str(row, 'model_id'), systemPrompt: str(row, 'system_prompt'),
    skill: str(row, 'skill'), revision: num(row, 'revision'),
  }
}
function job(row: Row): AgentJob {
  const state = str(row, 'state')
  if (!['queued', 'running', 'completed', 'failed', 'interrupted'].includes(state)) throw new Error('Invalid product task state')
  return {
    id: str(row, 'id'), agentId: str(row, 'agent_id'), title: str(row, 'title'), state: state as AgentJob['state'],
    input: str(row, 'input'), result: nullable(row, 'result'), error: nullable(row, 'error'), artifact: nullable(row, 'artifact'),
    charged: num(row, 'charged') / UNIT, createdAt: str(row, 'created_at'),
  }
}

/** Synchronous SQLite transactions serialize purchase, reservation, and settlement. */
export class ProductStore {
  private constructor(private readonly db: DatabaseSync) {}

  /** Open or migrate product-owned storage. @param directory - private console data root. @returns the open store. */
  static async open(directory: string): Promise<ProductStore> {
    await mkdir(directory, { recursive: true, mode: 0o700 })
    const filename = join(directory, 'product.sqlite')
    const db = new DatabaseSync(filename)
    await chmod(filename, 0o600)
    db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;')
    const version = db.prepare('PRAGMA user_version').get()?.user_version
    if (version !== 0 && version !== 1) { db.close(); throw new Error('Unsupported product database version') }
    db.exec(`
      CREATE TABLE IF NOT EXISTS agents (
        id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT NOT NULL, category TEXT NOT NULL,
        output TEXT NOT NULL, executor TEXT NOT NULL, price INTEGER NOT NULL CHECK(price >= 0),
        duration_days INTEGER, published INTEGER NOT NULL, model_id TEXT NOT NULL,
        system_prompt TEXT NOT NULL, skill TEXT NOT NULL, revision INTEGER NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS wallets (
        team_id TEXT NOT NULL, user_id TEXT NOT NULL, balance INTEGER NOT NULL DEFAULT 0 CHECK(balance >= 0),
        reserved INTEGER NOT NULL DEFAULT 0 CHECK(reserved >= 0 AND reserved <= balance),
        can_purchase INTEGER NOT NULL DEFAULT 0, can_run INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY(team_id, user_id)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS ledger (
        id TEXT PRIMARY KEY, team_id TEXT NOT NULL, user_id TEXT NOT NULL, delta INTEGER NOT NULL,
        kind TEXT NOT NULL, reference TEXT NOT NULL UNIQUE, actor_id TEXT NOT NULL, note TEXT NOT NULL,
        created_at TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS entitlements (
        team_id TEXT NOT NULL, user_id TEXT NOT NULL, agent_id TEXT NOT NULL REFERENCES agents(id),
        expires_at TEXT, revoked INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(team_id,user_id,agent_id)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS purchases (
        team_id TEXT NOT NULL, user_id TEXT NOT NULL, key TEXT NOT NULL, agent_id TEXT NOT NULL,
        price INTEGER NOT NULL, expires_at TEXT, created_at TEXT NOT NULL,
        PRIMARY KEY(team_id,user_id,key)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS settings (id INTEGER PRIMARY KEY CHECK(id=1), input_rate INTEGER, output_rate INTEGER) STRICT;
      INSERT OR IGNORE INTO settings VALUES(1,NULL,NULL);
      CREATE TABLE IF NOT EXISTS jobs (
        id TEXT PRIMARY KEY, team_id TEXT NOT NULL, user_id TEXT NOT NULL, request_key TEXT NOT NULL,
        agent_id TEXT NOT NULL, title TEXT NOT NULL, revision INTEGER NOT NULL, config TEXT NOT NULL,
        input TEXT NOT NULL, state TEXT NOT NULL, result TEXT, error TEXT, artifact TEXT,
        charged INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL,
        UNIQUE(team_id,user_id,request_key)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS attempts (
        id TEXT PRIMARY KEY, job_id TEXT NOT NULL REFERENCES jobs(id), team_id TEXT NOT NULL, user_id TEXT NOT NULL,
        reserved INTEGER NOT NULL, input_rate INTEGER NOT NULL, output_rate INTEGER NOT NULL,
        state TEXT NOT NULL, request TEXT NOT NULL, response TEXT, input_tokens INTEGER, output_tokens INTEGER
      ) STRICT;
      CREATE TABLE IF NOT EXISTS bindings (
        team_id TEXT NOT NULL, user_id TEXT NOT NULL, account TEXT NOT NULL, encrypted_key TEXT NOT NULL,
        updated_at TEXT NOT NULL, PRIMARY KEY(team_id,user_id)
      ) STRICT;
      PRAGMA user_version=1;
    `)
    const store = new ProductStore(db)
    if (store.agents().length === 0) store.saveAgent({ id: 'ppt-studio', title: '演示文稿助手',
      description: '把你的文案、汇报材料或课程内容，整理成一份可以继续编辑的演示文稿。', category: '办公创作',
      output: 'pptx', executor: 'ppt-master', price: 0, durationDays: 30, published: false, modelId: '',
      systemPrompt: '你是织流演示文稿助手，清晰表达用户材料，使用中文，保留事实，不编造数据。',
      skill: '使用 PPT Master 的 Quick Generate 流程交付原生可编辑 PPTX。仅基于用户提供的完整材料，快速制作 3 至 6 页演示文稿。' })
    // A dispatched request may have incurred provider cost: retain its hold for review.
    db.exec("UPDATE jobs SET state='interrupted', error='服务重启中断了任务，请联系管理员核对用量后重新提交。' WHERE state IN ('queued','running')")
    return store
  }

  /** Close after the owning runtime has drained its jobs. */
  close(): void { this.db.close() }

  private transaction<T>(operation: () => T): T {
    this.db.exec('BEGIN IMMEDIATE')
    try { const value = operation(); this.db.exec('COMMIT'); return value }
    catch (error) {
      try { this.db.exec('ROLLBACK') }
      catch (rollbackError) { throw new AggregateError([error, rollbackError], 'Product transaction rollback failed') }
      throw error
    }
  }

  /** Read all administrative revisions. @returns products including private configuration. */
  agents(): AgentProduct[] { return this.db.prepare('SELECT * FROM agents ORDER BY title').all().map(product) }

  /** Read one product. @param id - stable agent identifier. @returns the product or a typed missing error. */
  agent(id: string): AgentProduct {
    const row = this.db.prepare('SELECT * FROM agents WHERE id=?').get(id)
    if (!row) throw new HttpError(404, '智能体不存在', 'agent_missing')
    return product(row)
  }

  /** Save a validated administrative revision. @param input - validated complete product. @returns the stored revision. */
  saveAgent(input: Omit<AgentProduct, 'revision'>): AgentProduct {
    const old = this.db.prepare('SELECT revision FROM agents WHERE id=?').get(input.id)
    const revision = old ? num(old, 'revision') + 1 : 1
    this.db.prepare(`INSERT INTO agents VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET
      title=excluded.title, description=excluded.description, category=excluded.category, output=excluded.output,
      executor=excluded.executor, price=excluded.price, duration_days=excluded.duration_days, published=excluded.published,
      model_id=excluded.model_id, system_prompt=excluded.system_prompt, skill=excluded.skill, revision=excluded.revision`)
      .run(input.id, input.title, input.description, input.category, input.output, input.executor, micros(input.price),
        input.durationDays, Number(input.published), input.modelId, input.systemPrompt, input.skill, revision)
    return this.agent(input.id)
  }

  /** Read the configured runtime rates. @returns null until an administrator configures billing. */
  rates(): PointsRates | null {
    const row = this.db.prepare('SELECT * FROM settings WHERE id=1').get()
    if (!row || row.input_rate === null || row.output_rate === null) return null
    return { input: num(row, 'input_rate'), output: num(row, 'output_rate') }
  }

  /** Set whole points per million tokens. @param rates - validated nonnegative integer rates. */
  setRates(rates: PointsRates): void { this.db.prepare('UPDATE settings SET input_rate=?,output_rate=? WHERE id=1').run(rates.input, rates.output) }

  /**
   * Read a member wallet; missing assignments have no spending permissions.
   * @param teamId - team.
   * @param userId - member.
   * @returns current wallet.
   */
  wallet(teamId: string, userId: string): PointsWallet {
    const row = this.db.prepare('SELECT * FROM wallets WHERE team_id=? AND user_id=?').get(teamId, userId)
    return { teamId, userId, balance: row ? num(row, 'balance') / UNIT : 0, reserved: row ? num(row, 'reserved') / UNIT : 0,
      canPurchase: row ? num(row, 'can_purchase') === 1 : false, canRun: row ? num(row, 'can_run') === 1 : false }
  }

  /**
   * Explicitly assign spending permissions.
   * @param teamId - team.
   * @param userId - member.
   * @param purchase - purchase permission.
   * @param run - execution permission.
   */
  policy(teamId: string, userId: string, purchase: boolean, run: boolean): void {
    this.db.prepare(`INSERT INTO wallets(team_id,user_id,can_purchase,can_run) VALUES(?,?,?,?)
      ON CONFLICT(team_id,user_id) DO UPDATE SET can_purchase=excluded.can_purchase,can_run=excluded.can_run`)
      .run(teamId, userId, Number(purchase), Number(run))
  }

  /**
   * Append an idempotent administrator credit.
   * @param teamId - team.
   * @param userId - member.
   * @param points - positive points.
   * @param key - request idempotency key.
   * @param actorId - administrator.
   * @param note - reason.
   */
  credit(teamId: string, userId: string, points: number, key: string, actorId: string, note: string): void {
    this.transaction(() => {
      const reference = `credit:${actorId}:${key}`
      const previous = this.db.prepare('SELECT * FROM ledger WHERE reference=?').get(reference)
      const delta = micros(points)
      if (previous) {
        if (str(previous, 'team_id') !== teamId || str(previous, 'user_id') !== userId || num(previous, 'delta') !== delta) throw new HttpError(409, '请求标识已被用于另一笔交易', 'idempotency_conflict')
        return
      }
      this.db.prepare('INSERT OR IGNORE INTO wallets(team_id,user_id) VALUES(?,?)').run(teamId, userId)
      const balance = micros(this.wallet(teamId, userId).balance)
      if (!Number.isSafeInteger(balance + delta) || balance + delta > 1_000_000_000 * UNIT) throw new HttpError(400, '钱包余额超出范围，请减少本次增加积分', 'invalid_points')
      this.db.prepare('UPDATE wallets SET balance=balance+? WHERE team_id=? AND user_id=?').run(delta, teamId, userId)
      this.appendLedger(teamId, userId, delta, 'credit', reference, actorId, note)
    })
  }

  private appendLedger(
    teamId: string, userId: string, delta: number, kind: string, reference: string, actorId: string, note: string,
  ): void {
    this.db.prepare('INSERT INTO ledger VALUES(?,?,?,?,?,?,?,?,?)').run(randomUUID(), teamId, userId, delta, kind, reference, actorId, note, new Date().toISOString())
  }

  /**
   * Current right, with expiry evaluated at invocation time.
   * @param teamId - team.
   * @param userId - member.
   * @param agentId - agent.
   * @param now - clock.
   * @returns entitlement if assigned.
   */
  entitlement(teamId: string, userId: string, agentId: string, now = new Date()): AgentEntitlement | null {
    const row = this.db.prepare('SELECT * FROM entitlements WHERE team_id=? AND user_id=? AND agent_id=?').get(teamId, userId, agentId)
    if (!row) return null
    const expiresAt = nullable(row, 'expires_at')
    return { agentId, expiresAt, active: num(row, 'revoked') === 0 && (expiresAt === null || Date.parse(expiresAt) > now.getTime()) }
  }

  /**
   * Purchase permission, independently of runtime usage. Active rights are not charged again.
   * @param teamId - team.
   * @param userId - buyer.
   * @param agentId - product.
   * @param key - idempotency key.
   * @param now - purchase clock.
   * @returns granted right.
   */
  purchase(teamId: string, userId: string, agentId: string, key: string, now = new Date()): AgentEntitlement {
    return this.transaction(() => {
      const previous = this.db.prepare('SELECT * FROM purchases WHERE team_id=? AND user_id=? AND key=?').get(teamId, userId, key)
      if (previous) {
        if (str(previous, 'agent_id') !== agentId) throw new HttpError(409, '请求标识已被用于另一笔购买', 'idempotency_conflict')
        const expiresAt = nullable(previous, 'expires_at')
        return { agentId, expiresAt, active: expiresAt === null || Date.parse(expiresAt) > now.getTime() }
      }
      const item = this.agent(agentId)
      if (!item.published) throw new HttpError(409, '该智能体已下架', 'agent_unpublished')
      const wallet = this.wallet(teamId, userId)
      if (!wallet.canPurchase) throw new HttpError(403, '请联系管理员开通智能体购买权限', 'purchase_forbidden')
      const existing = this.entitlement(teamId, userId, agentId, now)
      if (existing?.active) throw new HttpError(409, '使用权仍在有效期内，请直接使用', 'already_unlocked')
      if (micros(wallet.balance - wallet.reserved) < micros(item.price)) throw new HttpError(402, '可用积分不足，请联系管理员补充积分', 'points_insufficient')
      const expiresAt = item.durationDays === null ? null : new Date(now.getTime() + item.durationDays * 86_400_000).toISOString()
      this.db.prepare('UPDATE wallets SET balance=balance-? WHERE team_id=? AND user_id=?').run(micros(item.price), teamId, userId)
      this.db.prepare(`INSERT INTO entitlements VALUES(?,?,?,?,0) ON CONFLICT(team_id,user_id,agent_id)
        DO UPDATE SET expires_at=excluded.expires_at,revoked=0`).run(teamId, userId, agentId, expiresAt)
      this.db.prepare('INSERT INTO purchases VALUES(?,?,?,?,?,?,?)').run(teamId, userId, key, agentId, micros(item.price), expiresAt, now.toISOString())
      this.appendLedger(teamId, userId, -micros(item.price), 'unlock', `unlock:${teamId}:${userId}:${key}`, userId, item.title)
      return { agentId, expiresAt, active: true }
    })
  }

  /**
   * Explicit administrator entitlement assignment or revocation.
   * @param teamId - team.
   * @param userId - member.
   * @param agentId - agent.
   * @param expiresAt - exact expiry, null for permanent.
   * @param revoke - revoke existing right.
   */
  grant(teamId: string, userId: string, agentId: string, expiresAt: string | null, revoke: boolean): void {
    this.agent(agentId)
    this.db.prepare(`INSERT INTO entitlements VALUES(?,?,?,?,?) ON CONFLICT(team_id,user_id,agent_id)
      DO UPDATE SET expires_at=excluded.expires_at,revoked=excluded.revoked`).run(teamId, userId, agentId, expiresAt, Number(revoke))
  }

  /**
   * Atomically admit an idempotent task after checking current permission.
   * @param teamId - team.
   * @param userId - member.
   * @param agentId - agent.
   * @param input - user material.
   * @param key - submission identity.
   * @returns job and whether it was created.
   */
  createJob(teamId: string, userId: string, agentId: string, input: string, key: string): { job: AgentJob; created: boolean } {
    return this.transaction(() => {
      const previous = this.db.prepare('SELECT * FROM jobs WHERE team_id=? AND user_id=? AND request_key=?').get(teamId, userId, key)
      if (previous) {
        if (str(previous, 'agent_id') !== agentId || str(previous, 'input') !== input) throw new HttpError(409, '提交标识已被使用', 'idempotency_conflict')
        return { job: job(previous), created: false }
      }
      const item = this.assertRun(teamId, userId, agentId)
      const active = this.db.prepare("SELECT id FROM jobs WHERE team_id=? AND user_id=? AND state IN ('queued','running')").get(teamId, userId)
      if (active) throw new HttpError(409, '已有任务正在运行，请等待完成', 'job_in_progress')
      const id = randomUUID()
      this.db.prepare(`INSERT INTO jobs(id,team_id,user_id,request_key,agent_id,title,revision,config,input,state,created_at)
        VALUES(?,?,?,?,?,?,?,?,?,'queued',?)`).run(id, teamId, userId, key, agentId, item.title, item.revision, JSON.stringify(item), input, new Date().toISOString())
      return { job: this.job(teamId, userId, id), created: true }
    })
  }

  /**
   * Check invocation permissions on every model request.
   * @param teamId - team.
   * @param userId - member.
   * @param agentId - agent.
   * @returns published product.
   */
  assertRun(teamId: string, userId: string, agentId: string): AgentProduct {
    const item = this.agent(agentId)
    if (!item.published) throw new HttpError(409, '该智能体已下架', 'agent_unpublished')
    if (!this.wallet(teamId, userId).canRun) throw new HttpError(403, '请联系管理员开通运行权限', 'run_forbidden')
    if (!this.entitlement(teamId, userId, agentId)?.active) throw new HttpError(403, '请先解锁该智能体', 'agent_locked')
    if (this.rates() === null) throw new HttpError(409, '管理员尚未配置运行积分费率', 'rates_unconfigured')
    return item
  }

  /** Read an owner-scoped task. @param teamId - team. @param userId - member. @param id - task. @returns public task. */
  job(teamId: string, userId: string, id: string): AgentJob {
    const row = this.db.prepare('SELECT * FROM jobs WHERE id=? AND team_id=? AND user_id=?').get(id, teamId, userId)
    if (!row) throw new HttpError(404, '任务不存在', 'job_missing')
    return job(row)
  }

  /** List the member's latest tasks. @param teamId - team. @param userId - member. @returns newest first. */
  jobs(teamId: string, userId: string): AgentJob[] { return this.db.prepare('SELECT * FROM jobs WHERE team_id=? AND user_id=? ORDER BY created_at DESC LIMIT 30').all(teamId, userId).map(job) }

  /**
   * Commit a task state or result.
   * @param id - admitted task.
   * @param state - state.
   * @param result - text result.
   * @param artifact - filename only.
   * @param error - localized public error.
   */
  updateJob(id: string, state: AgentJob['state'], result: string | null = null, artifact: string | null = null, error: string | null = null): void {
    this.db.prepare('UPDATE jobs SET state=?,result=?,artifact=?,error=? WHERE id=?').run(state, result, artifact, error, id)
  }

  /**
   * Reserve the request's maximum charge and persist its complete model input before dispatch.
   * @param jobId - admitted task.
   * @param teamId - team.
   * @param userId - member.
   * @param maximumTokens - upper bound from model context.
   * @param request - reconstructable request without credentials.
   * @returns settlement identity.
   */
  reserve(jobId: string, teamId: string, userId: string, maximumTokens: number, request: string): string {
    return this.transaction(() => {
      const current = this.job(teamId, userId, jobId)
      this.assertRun(teamId, userId, current.agentId)
      const rates = this.rates()
      if (!rates) throw new HttpError(409, '请先配置积分费率', 'rates_unconfigured')
      const reserved = maximumTokens * Math.max(rates.input, rates.output)
      if (!Number.isSafeInteger(reserved)) throw new HttpError(400, '预留积分超出范围', 'invalid_points')
      const wallet = this.wallet(teamId, userId)
      if (micros(wallet.balance - wallet.reserved) < reserved) throw new HttpError(402, '可用积分不足以预留本次任务费用，请补充积分后重试', 'points_insufficient')
      const id = randomUUID()
      this.db.prepare('UPDATE wallets SET reserved=reserved+? WHERE team_id=? AND user_id=?').run(reserved, teamId, userId)
      this.db.prepare(`INSERT INTO attempts(id,job_id,team_id,user_id,reserved,input_rate,output_rate,state,request)
        VALUES(?,?,?,?,?,?,?,'started',?)`).run(id, jobId, teamId, userId, reserved, rates.input, rates.output, request)
      return id
    })
  }

  /**
   * Settle provider usage exactly once. Missing usage retains the hold for administrator review.
   * @param id - attempt.
   * @param response - durable response.
   * @param usage - authoritative provider counts, or null for unknown usage.
   * @param reviewed - permit reconciliation of a retained hold.
   */
  settle(id: string, response: string, usage: { inputTokens: number; outputTokens: number } | null, reviewed = false): void {
    this.transaction(() => {
      const row = this.db.prepare('SELECT * FROM attempts WHERE id=?').get(id)
      if (!row) throw new Error('Missing product billing attempt')
      if (str(row, 'state') !== 'started' && !(reviewed && str(row, 'state') === 'review')) return
      if (usage === null) { this.db.prepare("UPDATE attempts SET state='review',response=? WHERE id=?").run(response, id); return }
      const charge = usage.inputTokens * num(row, 'input_rate') + usage.outputTokens * num(row, 'output_rate')
      if (!Number.isSafeInteger(charge) || charge < 0 || charge > num(row, 'reserved')) throw new Error('Provider usage exceeded reserved context budget')
      const teamId = str(row, 'team_id'), userId = str(row, 'user_id')
      this.db.prepare('UPDATE wallets SET reserved=reserved-?,balance=balance-? WHERE team_id=? AND user_id=?').run(num(row, 'reserved'), charge, teamId, userId)
      this.db.prepare("UPDATE attempts SET state='settled',response=?,input_tokens=?,output_tokens=? WHERE id=?").run(response, usage.inputTokens, usage.outputTokens, id)
      this.db.prepare('UPDATE jobs SET charged=charged+? WHERE id=?').run(charge, str(row, 'job_id'))
      this.appendLedger(teamId, userId, -charge, 'usage', `usage:${id}`, userId, str(row, 'job_id'))
    })
  }

  /** List retained holds whose task is no longer executing. @returns references for administrator reconciliation. */
  reviews(): Array<{ id: string; jobId: string; userId: string; teamId: string; reserved: number }> {
    return this.db.prepare(`SELECT attempts.* FROM attempts JOIN jobs ON jobs.id=attempts.job_id
      WHERE attempts.state IN ('started','review') AND jobs.state IN ('failed','interrupted')`).all()
      .map(row => ({ id: str(row, 'id'), jobId: str(row, 'job_id'), userId: str(row, 'user_id'), teamId: str(row, 'team_id'), reserved: num(row, 'reserved') / UNIT }))
  }

  /**
   * Reconcile a terminal task using administrator-verified provider usage.
   * @param id - unsettled request.
   * @param inputTokens - verified input count.
   * @param outputTokens - verified output count.
   * @param actorId - administrator.
   * @param note - evidence or reason.
   */
  resolve(id: string, inputTokens: number, outputTokens: number, actorId: string, note: string): void {
    const row = this.db.prepare('SELECT * FROM attempts WHERE id=?').get(id)
    if (!row) throw new HttpError(404, '待核对记录不存在', 'attempt_missing')
    if (str(row, 'state') === 'settled') return
    const current = this.job(str(row, 'team_id'), str(row, 'user_id'), str(row, 'job_id'))
    if (current.state !== 'failed' && current.state !== 'interrupted') throw new HttpError(409, '任务仍在执行，请等待结束', 'job_in_progress')
    this.settle(id, JSON.stringify({ previous: nullable(row, 'response'), review: { actorId, note, inputTokens, outputTokens, at: new Date().toISOString() } }), { inputTokens, outputTokens }, true)
  }

  /** Recent point movements for a member. @param teamId - team. @param userId - member. @returns safe ledger fields. */
  ledger(teamId: string, userId: string): Array<{ id: string; delta: number; kind: string; note: string; createdAt: string }> {
    return this.db.prepare('SELECT * FROM ledger WHERE team_id=? AND user_id=? ORDER BY rowid DESC LIMIT 50').all(teamId, userId)
      .map(row => ({ id: str(row, 'id'), delta: num(row, 'delta') / UNIT, kind: str(row, 'kind'), note: str(row, 'note'), createdAt: str(row, 'created_at') }))
  }

  /** Read a member's encrypted external binding. @param teamId - team. @param userId - member. @returns private binding or null. */
  binding(teamId: string, userId: string): { account: string; encryptedKey: string; updatedAt: string } | null {
    const row = this.db.prepare('SELECT * FROM bindings WHERE team_id=? AND user_id=?').get(teamId, userId)
    return row ? { account: str(row, 'account'), encryptedKey: str(row, 'encrypted_key'), updatedAt: str(row, 'updated_at') } : null
  }

  /**
   * Save only a restricted plugin credential, never the account password.
   * @param teamId - team.
   * @param userId - member.
   * @param account - display email.
   * @param encryptedKey - encrypted scoped credential.
   */
  bind(teamId: string, userId: string, account: string, encryptedKey: string): void {
    this.db.prepare(`INSERT INTO bindings VALUES(?,?,?,?,?) ON CONFLICT(team_id,user_id)
      DO UPDATE SET account=excluded.account,encrypted_key=excluded.encrypted_key,updated_at=excluded.updated_at`)
      .run(teamId, userId, account, encryptedKey, new Date().toISOString())
  }

  /** Remove a revoked or expired binding. @param teamId - team. @param userId - member. */
  unbind(teamId: string, userId: string): void { this.db.prepare('DELETE FROM bindings WHERE team_id=? AND user_id=?').run(teamId, userId) }
}
