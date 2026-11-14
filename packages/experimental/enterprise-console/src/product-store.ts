/** Transactional agent entitlement and job owner, independent of plan quotas. */

import { randomUUID } from 'node:crypto'
import { chmod, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { DatabaseSync, type SQLOutputValue } from 'node:sqlite'
import { HttpError } from './http.ts'
import type { AgentEntitlement, AgentIcon, AgentJob, AgentJobStep, AgentJobStepKind, AgentProduct } from './product-types.ts'

const UNIT = 1_000_000
const AGENT_ICONS: ReadonlySet<string> = new Set([
  'spark', 'strategy', 'operations', 'brand', 'growth', 'marketing',
  'finance', 'organization', 'legal', 'image', 'video', 'document', 'chat', 'knowledge',
])
type Row = Record<string, SQLOutputValue>
const STEP_KINDS: ReadonlySet<string> = new Set(['prepare', 'think', 'search', 'read', 'answer', 'build', 'tool'])
const STEP_STATES: ReadonlySet<string> = new Set(['running', 'done', 'failed'])

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
function agentKind(row: Row): AgentProduct['kind'] {
  const value = str(row, 'kind')
  if (value !== 'agent' && value !== 'expert' && value !== 'team') throw new Error('Invalid product kind')
  return value
}
function agentMembers(row: Row): string[] {
  const parsed: unknown = JSON.parse(str(row, 'members'))
  if (!Array.isArray(parsed) || parsed.some(item => typeof item !== 'string')) throw new Error('Invalid product members')
  return parsed as string[]
}
function agentIcon(row: Row): AgentIcon {
  const value = str(row, 'icon')
  if (!AGENT_ICONS.has(value)) throw new Error('Invalid product icon')
  return value as AgentIcon
}
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
    alias: str(row, 'alias'), kind: agentKind(row), members: agentMembers(row), group: str(row, 'group_name'), icon: agentIcon(row),
    tasks: str(row, 'tasks'), materials: str(row, 'materials'), deliverables: str(row, 'deliverables'),
    example: str(row, 'example'), disclaimer: str(row, 'disclaimer'),
    sortOrder: num(row, 'sort_order'), recommended: num(row, 'recommended') === 1,
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
    steps: jobSteps(row), charged: num(row, 'charged') / UNIT, createdAt: str(row, 'created_at'),
  }
}

/** Read recorded stages tolerantly; old rows and hand-edited values degrade to no timeline. */
function jobSteps(row: Row): AgentJobStep[] {
  const value = row.steps
  if (typeof value !== 'string' || value === '') return []
  let parsed: unknown
  try { parsed = JSON.parse(value) } catch { return [] }
  if (!Array.isArray(parsed)) return []
  const steps: AgentJobStep[] = []
  for (const item of parsed) {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) continue
    const entry = item as Record<string, unknown>
    if (typeof entry.kind !== 'string' || !STEP_KINDS.has(entry.kind)
      || typeof entry.at !== 'string' || typeof entry.state !== 'string' || !STEP_STATES.has(entry.state)) continue
    steps.push({
      kind: entry.kind as AgentJobStepKind,
      ...(typeof entry.detail === 'string' && entry.detail !== '' ? { detail: entry.detail } : {}),
      at: entry.at, state: entry.state as AgentJobStep['state'],
    })
  }
  return steps
}

/** One shipped agent definition, inserted as a draft the first time its catalog version is seen. */
export type AgentCatalogEntry = Omit<AgentProduct, 'revision'>

/** Shipped first-party agent catalog and the content hash that identifies it. */
export interface AgentCatalogSeed {
  readonly version: string
  readonly agents: readonly AgentCatalogEntry[]
}

/** Synchronous SQLite transactions serialize purchase, reservation, and settlement. */
export class ProductStore {
  private constructor(private readonly db: DatabaseSync) {}

  /**
   * Open or migrate product-owned storage.
   * @param directory - private console data root.
   * @param seed - shipped first-party catalog; missing entries are inserted when its version changes.
   * @returns the open store.
   */
  static async open(directory: string, seed?: AgentCatalogSeed): Promise<ProductStore> {
    await mkdir(directory, { recursive: true, mode: 0o700 })
    const filename = join(directory, 'product.sqlite')
    const db = new DatabaseSync(filename)
    await chmod(filename, 0o600)
    db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;')
    const version = db.prepare('PRAGMA user_version').get()?.user_version
    if (version !== 0 && version !== 1 && version !== 2 && version !== 3 && version !== 4) { db.close(); throw new Error('Unsupported product database version') }
    db.exec(`
      CREATE TABLE IF NOT EXISTS agents (
        id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT NOT NULL, alias TEXT NOT NULL DEFAULT '',
        group_name TEXT NOT NULL DEFAULT '', category TEXT NOT NULL, icon TEXT NOT NULL DEFAULT 'spark',
        tasks TEXT NOT NULL DEFAULT '', materials TEXT NOT NULL DEFAULT '', deliverables TEXT NOT NULL DEFAULT '',
        example TEXT NOT NULL DEFAULT '', disclaimer TEXT NOT NULL DEFAULT '',
        sort_order INTEGER NOT NULL DEFAULT 100, recommended INTEGER NOT NULL DEFAULT 0,
        output TEXT NOT NULL, executor TEXT NOT NULL, price INTEGER NOT NULL CHECK(price >= 0),
        duration_days INTEGER, published INTEGER NOT NULL, model_id TEXT NOT NULL,
        system_prompt TEXT NOT NULL, skill TEXT NOT NULL,
        kind TEXT NOT NULL DEFAULT 'agent', members TEXT NOT NULL DEFAULT '[]', revision INTEGER NOT NULL
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
      CREATE TABLE IF NOT EXISTS catalog_seed (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;
    `)
    const jobColumns = db.prepare('PRAGMA table_info(jobs)').all() as Array<{ name?: unknown }>
    if (!jobColumns.some(column => column.name === 'steps')) {
      db.exec("ALTER TABLE jobs ADD COLUMN steps TEXT NOT NULL DEFAULT '[]'")
    }
    if (version === 1) {
      db.exec('BEGIN IMMEDIATE')
      try {
        db.exec(`
        ALTER TABLE agents ADD COLUMN alias TEXT NOT NULL DEFAULT '';
        ALTER TABLE agents ADD COLUMN group_name TEXT NOT NULL DEFAULT '';
        ALTER TABLE agents ADD COLUMN icon TEXT NOT NULL DEFAULT 'spark';
        ALTER TABLE agents ADD COLUMN tasks TEXT NOT NULL DEFAULT '';
        ALTER TABLE agents ADD COLUMN materials TEXT NOT NULL DEFAULT '';
        ALTER TABLE agents ADD COLUMN deliverables TEXT NOT NULL DEFAULT '';
        ALTER TABLE agents ADD COLUMN example TEXT NOT NULL DEFAULT '';
        ALTER TABLE agents ADD COLUMN disclaimer TEXT NOT NULL DEFAULT '';
        ALTER TABLE agents ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 100;
        ALTER TABLE agents ADD COLUMN recommended INTEGER NOT NULL DEFAULT 0;
        `)
        db.exec('COMMIT')
      } catch (error) {
        db.exec('ROLLBACK')
        throw error
      }
    }
    if (version === 1 || version === 2) {
      db.exec('BEGIN IMMEDIATE')
      try {
        db.exec(`
        ALTER TABLE agents ADD COLUMN kind TEXT NOT NULL DEFAULT 'agent';
        ALTER TABLE agents ADD COLUMN members TEXT NOT NULL DEFAULT '[]';
        `)
        db.exec('COMMIT')
      } catch (error) {
        db.exec('ROLLBACK')
        throw error
      }
    }
    db.exec('PRAGMA user_version=4')
    const store = new ProductStore(db)
    if (store.agents().length === 0) store.saveAgent({ id: 'ppt-studio', title: '演示文稿助手',
      description: '把你的文案、汇报材料或课程内容，整理成一份可以继续编辑的演示文稿。',
      alias: 'PPT,演示文稿,幻灯片', group: '办公创作', category: '办公创作', icon: 'document',
      tasks: '汇报材料成稿\n课程内容整理\n方案初稿可视化', materials: '完整的文字材料、汇报对象与用途',
      deliverables: '3–6 页原生可编辑 PPTX', example: '把这些周报整理成 5 页管理层汇报，突出增长与风险。',
      disclaimer: '', kind: 'agent', members: [], sortOrder: 10, recommended: true,
      output: 'pptx', executor: 'ppt-master', price: 0, durationDays: 30, published: false, modelId: '',
      systemPrompt: '你是织流演示文稿助手，清晰表达用户材料，使用中文，保留事实，不编造数据。',
      skill: '使用 PPT Master 的 Quick Generate 流程交付原生可编辑 PPTX。仅基于用户提供的完整材料，快速制作 3 至 6 页演示文稿。' })
    db.prepare(`UPDATE agents SET alias='PPT,演示文稿,幻灯片', group_name=category, icon='document',
      tasks=CASE WHEN tasks='' THEN '汇报材料成稿\n课程内容整理\n方案初稿可视化' ELSE tasks END,
      materials=CASE WHEN materials='' THEN '完整的文字材料、汇报对象与用途' ELSE materials END,
      deliverables=CASE WHEN deliverables='' THEN '3–6 页原生可编辑 PPTX' ELSE deliverables END,
      example=CASE WHEN example='' THEN '把这些周报整理成 5 页管理层汇报，突出增长与风险。' ELSE example END,
      recommended=1, sort_order=10 WHERE id='ppt-studio' AND alias=''`).run()
    if (seed !== undefined) store.seedCatalog(seed)
    db.exec("UPDATE jobs SET state='interrupted', error='服务重启中断了任务，请重新提交。' WHERE state IN ('queued','running')")
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

  /**
   * Insert shipped catalog entries the store does not hold yet, once per shipped version.
   * Owner edits and deletions stay untouched; a new version only adds its missing ids.
   * @param seed - shipped catalog and its content version.
   * @returns ids inserted by this call.
   */
  seedCatalog(seed: AgentCatalogSeed): string[] {
    const recorded = (this.db.prepare("SELECT value FROM catalog_seed WHERE key='agents'").get() as { value?: string } | undefined)?.value
    if (recorded === seed.version) return []
    const created: string[] = []
    this.transaction(() => {
      for (const agent of seed.agents) {
        if (this.db.prepare('SELECT 1 FROM agents WHERE id=?').get(agent.id)) continue
        this.saveAgent(agent)
        created.push(agent.id)
      }
      this.db.prepare(`INSERT INTO catalog_seed(key,value) VALUES('agents',?)
        ON CONFLICT(key) DO UPDATE SET value=excluded.value`).run(seed.version)
    })
    return created
  }

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
    // Name every column: a database upgraded from v1 keeps the original order with the v2 columns appended.
    this.db.prepare(`INSERT INTO agents(id, title, description, alias, group_name, category, icon, tasks, materials,
      deliverables, example, disclaimer, sort_order, recommended, output, executor, price, duration_days, published,
      model_id, system_prompt, skill, kind, members, revision) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET
      title=excluded.title, description=excluded.description, alias=excluded.alias, group_name=excluded.group_name,
      category=excluded.category, icon=excluded.icon, tasks=excluded.tasks, materials=excluded.materials,
      deliverables=excluded.deliverables, example=excluded.example, disclaimer=excluded.disclaimer,
      sort_order=excluded.sort_order, recommended=excluded.recommended, output=excluded.output,
      executor=excluded.executor, price=excluded.price, duration_days=excluded.duration_days, published=excluded.published,
      model_id=excluded.model_id, system_prompt=excluded.system_prompt, skill=excluded.skill,
      kind=excluded.kind, members=excluded.members, revision=excluded.revision`)
      .run(input.id, input.title, input.description, input.alias, input.group, input.category, input.icon,
        input.tasks, input.materials, input.deliverables, input.example, input.disclaimer,
        input.sortOrder, Number(input.recommended), input.output, input.executor, micros(input.price),
        input.durationDays, Number(input.published), input.modelId, input.systemPrompt, input.skill,
        input.kind, JSON.stringify(input.members), revision)
    return this.agent(input.id)
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

  /** Distinct agents the team currently holds, including administrator grants. */
  unlockedAgents(teamId: string, now = new Date()): number {
    const row = this.db.prepare(`SELECT COUNT(DISTINCT agent_id) AS count FROM entitlements
      WHERE team_id=? AND revoked=0 AND (expires_at IS NULL OR expires_at > ?)`).get(teamId, now.toISOString())
    return row === undefined ? 0 : num(row, 'count')
  }

  /** Whether any team member currently holds this agent, including administrator grants. */
  teamHasAgent(teamId: string, agentId: string, now = new Date()): boolean {
    return this.db.prepare(`SELECT 1 FROM entitlements WHERE team_id=? AND agent_id=? AND revoked=0
      AND (expires_at IS NULL OR expires_at > ?) LIMIT 1`).get(teamId, agentId, now.toISOString()) !== undefined
  }

  /**
   * Unlock a published agent for one member; the caller enforces plan limits.
   * Active rights are not granted twice.
   * @param teamId - team.
   * @param userId - buyer.
   * @param agentId - product.
   * @param key - idempotency key.
   * @param now - purchase clock.
   * @param agentLimit - distinct agents the team's plan allows, or null for unlimited.
   * @returns granted right.
   */
  purchase(
    teamId: string, userId: string, agentId: string, key: string,
    now = new Date(), agentLimit: number | null = null,
  ): AgentEntitlement {
    return this.transaction(() => {
      const previous = this.db.prepare('SELECT * FROM purchases WHERE team_id=? AND user_id=? AND key=?').get(teamId, userId, key)
      if (previous) {
        if (str(previous, 'agent_id') !== agentId) throw new HttpError(409, '请求标识已被用于另一笔购买', 'idempotency_conflict')
        const expiresAt = nullable(previous, 'expires_at')
        return { agentId, expiresAt, active: expiresAt === null || Date.parse(expiresAt) > now.getTime() }
      }
      const item = this.agent(agentId)
      if (!item.published) throw new HttpError(409, '该智能体已下架', 'agent_unpublished')
      const existing = this.entitlement(teamId, userId, agentId, now)
      if (existing?.active) throw new HttpError(409, '使用权仍在有效期内，请直接使用', 'already_unlocked')
      if (agentLimit !== null && !this.teamHasAgent(teamId, agentId, now) && this.unlockedAgents(teamId, now) >= agentLimit) {
        throw new HttpError(409, `当前套餐最多解锁 ${String(agentLimit)} 个智能体`, 'plan_agent_limit')
      }
      // Plan access stays active while the team keeps its subscription.
      const expiresAt = null
      this.db.prepare(`INSERT INTO entitlements VALUES(?,?,?,?,0) ON CONFLICT(team_id,user_id,agent_id)
        DO UPDATE SET expires_at=excluded.expires_at,revoked=0`).run(teamId, userId, agentId, expiresAt)
      this.db.prepare('INSERT INTO purchases VALUES(?,?,?,?,?,?,?)').run(teamId, userId, key, agentId, 0, expiresAt, now.toISOString())
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
    if (!this.entitlement(teamId, userId, agentId)?.active) throw new HttpError(403, '请先解锁该智能体', 'agent_locked')
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
    const row = this.db.prepare('SELECT steps FROM jobs WHERE id=?').get(id)
    const steps = row === undefined ? [] : jobSteps(row)
    const settled = state === 'running' ? steps : steps.map((step): AgentJobStep =>
      step.state === 'running' ? { ...step, state: state === 'completed' ? 'done' : 'failed' } : step)
    this.db.prepare('UPDATE jobs SET state=?,result=?,artifact=?,error=?,steps=? WHERE id=?')
      .run(state, result, artifact, error, JSON.stringify(settled), id)
  }

  /**
   * Record one progress stage and settle the previous one, keeping the latest twenty.
   * Consecutive duplicate stages are ignored so polling clients do not see repeats.
   * @param id - admitted task.
   * @param kind - stage kind; display copy is localized by the client.
   * @param detail - bounded subject such as the searched question or page path.
   */
  appendStep(id: string, kind: AgentJobStepKind, detail?: string): void {
    const row = this.db.prepare('SELECT steps FROM jobs WHERE id=?').get(id)
    if (row === undefined) return
    const current = jobSteps(row)
    const subject = detail === undefined || detail.trim() === '' ? undefined : detail.trim().slice(0, 80)
    const last = current[current.length - 1]
    if (last?.kind === kind && last.detail === subject) return
    const steps = current.map((step): AgentJobStep => step.state === 'running' ? { ...step, state: 'done' } : step)
    steps.push({ kind, ...(subject === undefined ? {} : { detail: subject }), at: new Date().toISOString(), state: 'running' })
    this.db.prepare('UPDATE jobs SET steps=? WHERE id=?').run(JSON.stringify(steps.slice(-20)), id)
  }

  /**
   * Persist the complete model input before dispatch. Plan-based access no longer holds points.
   * @param jobId - admitted task.
   * @param teamId - team.
   * @param userId - member.
   * @param _maximumTokens - retained for the runner's context bound.
   * @param request - reconstructable request without credentials.
   * @returns settlement identity.
   */
  reserve(jobId: string, teamId: string, userId: string, _maximumTokens: number, request: string): string {
    return this.transaction(() => {
      const current = this.job(teamId, userId, jobId)
      this.assertRun(teamId, userId, current.agentId)
      const id = randomUUID()
      this.db.prepare(`INSERT INTO attempts(id,job_id,team_id,user_id,reserved,input_rate,output_rate,state,request)
        VALUES(?,?,?,?,0,0,0,'started',?)`).run(id, jobId, teamId, userId, request)
      return id
    })
  }

  /**
   * Record provider usage exactly once. Plan-based access never charges points.
   * @param id - attempt.
   * @param response - durable response.
   * @param usage - provider counts, or null when the provider omitted them.
   */
  settle(id: string, response: string, usage: { inputTokens: number; outputTokens: number } | null): void {
    this.transaction(() => {
      const row = this.db.prepare('SELECT * FROM attempts WHERE id=?').get(id)
      if (!row) throw new Error('Missing product billing attempt')
      if (str(row, 'state') !== 'started') return
      const counts = usage ?? { inputTokens: 0, outputTokens: 0 }
      this.db.prepare("UPDATE attempts SET state='settled',response=?,input_tokens=?,output_tokens=? WHERE id=?").run(response, counts.inputTokens, counts.outputTokens, id)
    })
  }

}
