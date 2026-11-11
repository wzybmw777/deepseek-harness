import assert from 'node:assert/strict'
/** Authenticated API owner for the curated market and plan-based agent access. */

import type { IncomingMessage, ServerResponse } from 'node:http'
import { randomUUID } from 'node:crypto'
import type { EnterpriseRequestSession } from './api.ts'
import { booleanField, HttpError, integerField, readJson, sameOriginMutation, sendJson, textField } from './http.ts'
import type { EnterpriseStore } from './store.ts'
import { ProductStore } from './product-store.ts'
import type { AgentIcon, AgentProduct, PublicAgent } from './product-types.ts'
import type { ProductFeilian } from './product-feilian.ts'
import { planAgentAccess, type PlanAgentAccess } from './plan-access.ts'

/** Invocation and delivery implementation supplied by the product runtime. */
export interface ProductRunner {
  /**
   * Start an admitted durable task.
   * @param teamId - team.
   * @param userId - member.
   * @param jobId - task.
   * @param product - immutable admitted revision.
   */
  start(teamId: string, userId: string, jobId: string, product: AgentProduct): void
  /**
   * Write an owner-scoped finished artifact.
   * @param teamId - team.
   * @param userId - member.
   * @param jobId - task.
   * @param response - HTTP response.
   */
  download(teamId: string, userId: string, jobId: string, response: ServerResponse): Promise<void>
  /** Return whether the executor is provisioned. @param executor - product executor. @returns availability. */
  available(executor: AgentProduct['executor']): boolean
}

const PREFIX = '/enterprise/api/product'
const AGENT_ICONS: ReadonlySet<string> = new Set([
  'spark', 'strategy', 'operations', 'brand', 'growth', 'marketing',
  'finance', 'organization', 'legal', 'image', 'video', 'document', 'chat', 'knowledge',
])

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new HttpError(400, '请求内容应为对象', 'invalid_request')
  return value as Record<string, unknown>
}
function identity(value: unknown, label: string): string {
  const result = textField(value, label, 100)
  if (!/^[a-zA-Z0-9_-]+$/u.test(result)) throw new HttpError(400, `${label}只接受字母、数字、连字符和下划线`, 'invalid_identifier')
  return result
}
function optionalText(value: unknown, label: string, max: number): string {
  return value === undefined || value === '' ? '' : textField(value, label, max)
}
function iconField(value: unknown): AgentIcon {
  if (value === undefined || value === '') return 'spark'
  if (typeof value !== 'string' || !AGENT_ICONS.has(value)) throw new HttpError(400, '请选择支持的图标', 'invalid_icon')
  return value as AgentIcon
}
function kindField(value: unknown): AgentProduct['kind'] {
  if (value === undefined || value === '') return 'agent'
  if (value !== 'agent' && value !== 'expert' && value !== 'team') throw new HttpError(400, '请选择支持的智能体类型', 'invalid_kind')
  return value
}
function membersField(value: unknown): string[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value) || value.length > 40) throw new HttpError(400, '团队成员应为不超过 40 项的数组', 'invalid_members')
  return value.map(item => identity(item, '团队成员'))
}
function productInput(value: Record<string, unknown>): Omit<AgentProduct, 'revision'> {
  const executor = value.executor
  if (executor !== 'ppt-master' && executor !== 'text' && executor !== 'video') throw new HttpError(400, '请选择支持的执行器', 'invalid_executor')
  const category = textField(value.category, '分类', 40)
  return {
    kind: kindField(value.kind), members: membersField(value.members),
    id: value.id === undefined ? randomUUID() : identity(value.id, '智能体标识'),
    title: textField(value.title, '名称', 80), description: textField(value.description, '说明', 1000),
    alias: optionalText(value.alias, '别名', 200),
    group: value.group === undefined || value.group === '' ? category : textField(value.group, '分组', 40),
    category, icon: iconField(value.icon),
    tasks: optionalText(value.tasks, '适用任务', 2000), materials: optionalText(value.materials, '所需材料', 1000),
    deliverables: optionalText(value.deliverables, '交付内容', 1000), example: optionalText(value.example, '使用示例', 2000),
    disclaimer: optionalText(value.disclaimer, '使用提示', 300),
    sortOrder: value.sortOrder === undefined ? 100 : integerField(value.sortOrder, '排序', 0, 10_000),
    recommended: value.recommended === undefined ? false : booleanField(value.recommended, '推荐状态'),
    executor,
    output: executor === 'ppt-master' ? 'pptx' : executor,
    price: 0,
    durationDays: null,
    published: booleanField(value.published, '发布状态'), modelId: value.modelId === '' ? '' : textField(value.modelId, '模型', 150),
    systemPrompt: textField(value.systemPrompt, '系统提示词', 30_000), skill: textField(value.skill, '技能说明', 30_000),
  }
}

/** Routes share console identity, but own all new business transactions. */
export class ProductApi {
  /**
   * @param products - agent catalog and entitlement store.
   * @param enterprise - live organization catalog.
   * @param runner - optional installed execution runtime.
   */
  constructor(
    readonly products: ProductStore, private readonly enterprise: EnterpriseStore,
    private readonly runner?: ProductRunner, private readonly feilian?: ProductFeilian,
  ) {}

  /**
   * Handle only product-owned routes.
   * @param request - request.
   * @param response - response.
   * @param url - proxy-normalized URL.
   * @param session - authenticated console session.
   * @returns whether this route was handled.
   */
  async handle(request: IncomingMessage, response: ServerResponse, url: URL, session: EnterpriseRequestSession): Promise<boolean> {
    if (!url.pathname.startsWith(`${PREFIX}/`)) return false
    const method = request.method ?? 'GET'
    if (method !== 'GET' && !sameOriginMutation(request)) throw new HttpError(403, '请求来源校验失败', 'invalid_origin')
    const body = method === 'GET' ? {} : object(await readJson(request))
    const catalog = this.enterprise.snapshot()
    const user = catalog.users.find(candidate => candidate.id === session.user.id && candidate.status === 'active')
    const role = user && catalog.roles.find(candidate => candidate.id === user.roleId)
    const team = user && catalog.teams.find(candidate => candidate.id === user.teamId && candidate.status === 'active')
    if (!user || !role || user.sessionVersion !== session.user.sessionVersion) throw new HttpError(401, '登录状态已变化，请重新登录', 'session_expired')
    if (!role.permissions.includes('workspace.use')) throw new HttpError(403, '当前账号没有工作台使用权限', 'forbidden')
    const admin = url.pathname.startsWith(`${PREFIX}/admin/`)
    if (admin && !role.permissions.includes('settings.write')) throw new HttpError(403, '当前账号没有产品管理权限', 'forbidden')
    const path = url.pathname.slice(PREFIX.length)
    const access: PlanAgentAccess | undefined = team === undefined || team === null
      ? undefined
      : planAgentAccess(catalog.plans.find(candidate => candidate.id === team.planId))

    if (path === '/admin/catalog' && method === 'GET') {
      sendJson(response, 200, { agents: this.products.agents(),
        models: catalog.models.filter(model => model.status === 'active').map(model => ({ id: model.id, name: model.displayName })),
        members: catalog.users.flatMap((member) => {
          if (member.status !== 'active' || member.teamId === undefined) return []
          return [{ id: member.id, name: member.name, teamId: member.teamId,
            teamName: catalog.teams.find(item => item.id === member.teamId)?.name }]
        }),
        teams: catalog.teams.map((memberTeam) => {
          const capability = planAgentAccess(catalog.plans.find(candidate => candidate.id === memberTeam.planId))
          return { id: memberTeam.id, name: memberTeam.name, planName: capability.planName, planCode: capability.planCode,
            agentLimit: capability.agentLimit, teams: capability.teams, unlocked: this.products.unlockedAgents(memberTeam.id) }
        }) })
      return true
    }
    if (path === '/admin/agents' && method === 'POST') {
      const item = productInput(body)
      const model = catalog.models.find(candidate => candidate.id === item.modelId && candidate.status === 'active')
      if ((item.published || item.modelId !== '') && !model) throw new HttpError(400, '请选择启用的模型', 'model_missing')
      if (item.published && !this.runner?.available(item.executor)) throw new HttpError(409, '该执行器尚未开通，请保存为草稿', 'executor_unavailable')
      sendJson(response, 200, this.products.saveAgent(item)); return true
    }
    if (path === '/admin/entitlement' && method === 'POST') {
      const member = catalog.users.find(candidate => candidate.id === body.userId && candidate.teamId === body.teamId)
      if (!member?.teamId) throw new HttpError(404, '团队成员不存在', 'member_missing')
      const agentId = identity(body.agentId, '智能体标识')
      const memberTeam = catalog.teams.find(candidate => candidate.id === member.teamId)
      const memberAccess = planAgentAccess(catalog.plans.find(candidate => candidate.id === memberTeam?.planId))
      const item = this.products.agent(agentId)
      const revoke = booleanField(body.revoke, '撤销授权')
      if (!revoke && item.kind === 'team' && !memberAccess.teams) throw new HttpError(403, '专家团仅随企业版套餐开放', 'plan_teams_locked')
      if (!revoke && !this.products.teamHasAgent(member.teamId, agentId)
        && memberAccess.agentLimit !== null && this.products.unlockedAgents(member.teamId) >= memberAccess.agentLimit) {
        throw new HttpError(409, `当前套餐最多解锁 ${String(memberAccess.agentLimit)} 个智能体`, 'plan_agent_limit')
      }
      const expiry = body.expiresAt === null ? null : textField(body.expiresAt, '有效期', 40)
      if (expiry !== null && (!Number.isFinite(Date.parse(expiry)) || new Date(expiry).toISOString() !== expiry)) throw new HttpError(400, '有效期需要使用 UTC 日期时间', 'invalid_expiry')
      this.products.grant(member.teamId, member.id, agentId, expiry, revoke)
      sendJson(response, 200, this.products.entitlement(member.teamId, member.id, agentId)); return true
    }
    if (!team) throw new HttpError(403, '请联系管理员分配有效的工作空间', 'team_unavailable')
    if (access === undefined) throw new HttpError(403, '请联系管理员分配有效的工作空间', 'team_unavailable')
    if (path === '/summary' && method === 'GET') {
      sendJson(response, 200, { access: { ...access, unlocked: this.products.unlockedAgents(team.id) } }); return true
    }
    if (path === '/feilian' && method === 'GET') {
      if (!this.feilian) throw new HttpError(503, '飞链服务尚未配置', 'feilian_unavailable')
      sendJson(response, 200, await this.feilian.status(team.id, user.id)); return true
    }
    if (path.startsWith('/feilian/') && method === 'POST') {
      if (!this.feilian) throw new HttpError(503, '飞链服务尚未配置', 'feilian_unavailable')
      if (path === '/feilian/bind') {
        const password = body.password
        if (typeof password !== 'string' || !password || password.length > 200) throw new HttpError(400, '请输入有效的飞链账号密码', 'invalid_password')
        await this.feilian.bind(team.id, user.id, textField(body.email, '飞链邮箱', 320), password,
          typeof body.tenantSlug === 'string' && body.tenantSlug.trim() ? textField(body.tenantSlug, '飞链工作空间', 100) : undefined)
        sendJson(response, 200, { bound: true }); return true
      }
      if (path === '/feilian/unbind') {
        await this.feilian.unbind(team.id, user.id); sendJson(response, 200, { bound: false }); return true
      }
      if (path === '/feilian/query') {
        sendJson(response, 200, await this.feilian.query(team.id, user.id, textField(body.knowledgeBaseId, '知识库', 200), textField(body.question, '问题', 10_000))); return true
      }
    }
    if (path === '/market' && method === 'GET') {
      const catalog = this.products.agents()
      const titles = new Map(catalog.map(item => [item.id, item.title]))
      const agents: PublicAgent[] = catalog.filter(item => item.published).map(item => ({
        id: item.id, title: item.title, description: item.description, alias: item.alias, group: item.group,
        category: item.category, icon: item.icon, tasks: item.tasks, materials: item.materials,
        deliverables: item.deliverables, example: item.example, disclaimer: item.disclaimer,
        sortOrder: item.sortOrder, recommended: item.recommended, output: item.output,
        kind: item.kind,
        members: item.kind === 'team'
          ? item.members.filter(id => titles.has(id)).map(id => ({ id, title: titles.get(id) ?? id }))
          : [],
        teamUnlocked: this.products.teamHasAgent(team.id, item.id),
        entitlement: this.products.entitlement(team.id, user.id, item.id),
      })).sort((left, right) => left.sortOrder - right.sortOrder || left.title.localeCompare(right.title, 'zh-CN'))
      const catalogOnly = url.searchParams.get('view') === 'catalog'
      sendJson(response, 200, { agents, access: { ...access, unlocked: this.products.unlockedAgents(team.id) },
        jobs: catalogOnly ? [] : this.products.jobs(team.id, user.id) })
      return true
    }
    if (path === '/purchase' && method === 'POST') {
      const agentId = identity(body.agentId, '智能体标识')
      const item = this.products.agent(agentId)
      if (item.kind === 'team' && !access.teams) throw new HttpError(403, '专家团仅随企业版套餐开放', 'plan_teams_locked')
      const active = this.products.entitlement(team.id, user.id, agentId)
      if (!active?.active && !this.products.teamHasAgent(team.id, agentId)
        && access.agentLimit !== null && this.products.unlockedAgents(team.id) >= access.agentLimit) {
        throw new HttpError(409, `当前套餐最多解锁 ${String(access.agentLimit)} 个智能体`, 'plan_agent_limit')
      }
      const entitlement = this.products.purchase(team.id, user.id, agentId, identity(body.key, '请求标识'), new Date(), access.agentLimit)
      sendJson(response, 200, { entitlement }); return true
    }
    if (path === '/jobs' && method === 'POST') {
      const agentId = identity(body.agentId, '智能体标识')
      const item = this.products.agent(agentId)
      if (item.kind === 'team' && !access.teams) throw new HttpError(403, '专家团仅随企业版套餐开放', 'plan_teams_locked')
      if (!this.runner?.available(item.executor)) throw new HttpError(409, '智能体执行服务尚未就绪，请稍后重试', 'executor_unavailable')
      const admitted = this.products.createJob(team.id, user.id, agentId, textField(body.input, '任务材料', 30_000), identity(body.key, '请求标识'))
      if (admitted.created) this.runner.start(team.id, user.id, admitted.job.id, item)
      sendJson(response, 202, admitted.job); return true
    }
    const match = /^\/jobs\/([a-zA-Z0-9_-]+)(\/download)?$/u.exec(path)
    if (match && method === 'GET') {
      const id = match[1]
      assert(id, 'Job route includes an identifier')
      if (match[2]) {
        this.products.job(team.id, user.id, id)
        if (!this.runner) throw new HttpError(503, '成果服务尚未就绪', 'executor_unavailable')
        await this.runner.download(team.id, user.id, id, response)
      } else sendJson(response, 200, this.products.job(team.id, user.id, id))
      return true
    }
    throw new HttpError(404, '产品接口不存在', 'not_found')
  }
}
