/** Tenant-scoped model catalog and quota projection for enterprise Desktop clients. */

import type { EnterpriseRequestSession } from './api.ts'
import { HttpError } from './http.ts'
import type { EnterpriseStore } from './store.ts'
import type { ChannelRecord, ChannelWireProtocol, ModelRecord, TeamRecord } from './types.ts'

/** Team allowance and the signed-in member's usage for the current monthly cycle. */
export interface DesktopQuota {
  readonly planName: string
  readonly totalTokens: number
  readonly usedTokens: number
  readonly remainingTokens: number
  readonly userTokens: number
  readonly cycleStartsAt: string
  readonly cycleEndsAt: string
}

/** One model route visible to a Desktop client without upstream credentials. */
export interface DesktopModelView {
  readonly id: string
  readonly name: string
  readonly protocol: ChannelWireProtocol
  readonly gatewayBasePath: `/enterprise/api/desktop/gateway/${string}`
  readonly upstreamModelId: string
  readonly contextWindow: number
  readonly capabilities: readonly string[]
}

/** Model catalog and quota returned by the bearer-authenticated Desktop endpoint. */
export interface DesktopModelCatalog {
  readonly quota: DesktopQuota
  readonly models: readonly DesktopModelView[]
  readonly refreshedAt: string
}

/** Quota and plan shown to a signed-in Desktop member. */
export interface DesktopBilling {
  readonly quota: DesktopQuota
  readonly planName: string
  readonly updatedAt: string
}

export interface DesktopModelsOptions {
  readonly now?: () => Date
}

function activeTeam(store: EnterpriseStore, session: EnterpriseRequestSession): TeamRecord {
  const teamId = session.user.teamId
  const team = teamId === undefined ? undefined : store.snapshot().teams.find(candidate => candidate.id === teamId)
  if (team === undefined) throw new HttpError(403, '当前账号尚未分配团队，请联系管理员', 'team_unavailable')
  if (team.status !== 'active') throw new HttpError(403, '当前团队已停用，请联系管理员', 'team_unavailable')
  return team
}

function quota(store: EnterpriseStore, session: EnterpriseRequestSession, team: TeamRecord, now: Date): DesktopQuota {
  const data = store.snapshot()
  const plan = data.plans.find(candidate => candidate.id === team.planId && candidate.status === 'active')
  if (plan === undefined) throw new HttpError(402, '当前团队没有可用的模型额度', 'quota_unavailable')
  const totalTokens = plan.monthlyCredits
  if (totalTokens <= 0) throw new HttpError(402, '当前团队没有可用的模型额度', 'quota_unavailable')

  const startsAt = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
  const endsAt = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1))
  const range = { teamId: team.id, from: startsAt.getTime(), to: endsAt.getTime() - 1, limit: 1 }
  const teamUsage = store.usageReport(range)
  const userUsage = store.usageReport({ ...range, userId: session.user.id })
  const usedTokens = teamUsage.summary.inputTokens + teamUsage.summary.outputTokens
  return {
    planName: plan.name,
    totalTokens,
    usedTokens,
    remainingTokens: Math.max(0, totalTokens - usedTokens),
    userTokens: userUsage.summary.inputTokens + userUsage.summary.outputTokens,
    cycleStartsAt: startsAt.toISOString(),
    cycleEndsAt: endsAt.toISOString(),
  }
}

function route(model: ModelRecord, channel: ChannelRecord): DesktopModelView {
  return {
    id: model.id,
    name: model.displayName,
    protocol: channel.wireProtocol,
    gatewayBasePath: `/enterprise/api/desktop/gateway/${model.id}`,
    upstreamModelId: model.name,
    contextWindow: model.contextWindow,
    capabilities: [...model.capabilities],
  }
}

/** Resolve active models and team quota for one re-authorized Desktop session. */
export class DesktopModels {
  private readonly now: () => Date

  /**
   * @param store - durable enterprise catalog and usage ledger.
   * @param options - clock used to select and describe the monthly quota cycle.
   */
  constructor(private readonly store: EnterpriseStore, options: DesktopModelsOptions = {}) {
    this.now = options.now ?? (() => new Date())
  }

  /**
   * List active models whose channel is active and report the current allowance.
   * @param session - Desktop bearer session re-authorized by the console.
   * @returns model routes without upstream URLs or credentials.
   */
  catalog(session: EnterpriseRequestSession): DesktopModelCatalog {
    if (!session.permissions.includes('workspace.use')) throw new HttpError(403, '当前角色无权使用企业工作台', 'forbidden')
    const now = this.now()
    const team = activeTeam(this.store, session)
    const data = this.store.snapshot()
    const models = data.models
      .filter(model => model.status === 'active')
      .flatMap((model) => {
        const channel = data.channels.find(candidate => candidate.id === model.channelId && candidate.status === 'active')
        return channel === undefined ? [] : [route(model, channel)]
      })
    if (models.length === 0) throw new HttpError(404, '当前团队没有可用的模型', 'models_unavailable')
    return { quota: quota(this.store, session, team, now), models, refreshedAt: now.toISOString() }
  }

  /**
   * Report the team allowance and member usage without exposing orders or prices.
   * @param session - Desktop bearer session re-authorized by the console.
   * @returns the current monthly quota and plan.
   */
  billing(session: EnterpriseRequestSession): DesktopBilling {
    if (!session.permissions.includes('workspace.use')) throw new HttpError(403, '当前角色无权使用企业工作台', 'forbidden')
    const now = this.now()
    const team = activeTeam(this.store, session)
    const current = quota(this.store, session, team, now)
    return { quota: current, planName: current.planName, updatedAt: now.toISOString() }
  }

  /**
   * Resolve one model and channel after repeating team, quota, model, and channel checks.
   * @param session - Desktop bearer session re-authorized by the console.
   * @param modelId - public Desktop model identifier.
   * @returns the route records plus the current allowance.
   */
  resolve(session: EnterpriseRequestSession, modelId: string): {
    readonly model: ModelRecord
    readonly channel: ChannelRecord
    readonly quota: DesktopQuota
  } {
    if (!session.permissions.includes('workspace.use')) throw new HttpError(403, '当前角色无权使用企业工作台', 'forbidden')
    const team = activeTeam(this.store, session)
    const currentQuota = quota(this.store, session, team, this.now())
    if (currentQuota.remainingTokens <= 0) throw new HttpError(402, '本月团队 Token 额度已用完', 'quota_exhausted')
    const data = this.store.snapshot()
    const model = data.models.find(candidate => candidate.id === modelId)
    if (model === undefined || model.status !== 'active') {
      throw new HttpError(409, '当前模型不可用', 'model_unavailable')
    }
    const channel = data.channels.find(candidate => candidate.id === model.channelId)
    if (channel === undefined || channel.status !== 'active') {
      throw new HttpError(409, '当前模型渠道不可用', 'channel_unavailable')
    }
    return { model, channel, quota: currentQuota }
  }
}
