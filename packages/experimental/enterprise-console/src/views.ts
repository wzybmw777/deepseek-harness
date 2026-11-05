/** Read-only projections from the durable catalog to console API records. */

import type {
  AuditRecord,
  ChannelView,
  DashboardView,
  EnterpriseCatalog,
  ModelView,
  OrderView,
  PlanView,
  PluginsView,
  RoleView,
  SessionView,
  TeamView,
  UsageAggregate,
  UsageRecord,
  UsageView,
  UserRecord,
  UserView,
} from './types.ts'
import { BUILTIN_PLUGINS, builtinPluginId } from './plugin-catalog.ts'

/** Resolve a user's effective permissions from its current role. */
export function permissionsFor(data: Readonly<EnterpriseCatalog>, user: UserRecord): string[] {
  return data.roles.find(role => role.id === user.roleId)?.permissions ?? []
}

/** Project a password-free user with denormalized role and team names. */
export function userView(data: Readonly<EnterpriseCatalog>, user: UserRecord): UserView {
  const roleName = data.roles.find(role => role.id === user.roleId)?.name ?? '未分配角色'
  const teamName = user.teamId === undefined ? undefined : data.teams.find(team => team.id === user.teamId)?.name
  const { passwordHash: _passwordHash, sessionVersion: _sessionVersion, ...visible } = user
  return { ...visible, roleName, ...(teamName === undefined ? {} : { teamName }) }
}

/** Project the signed-in user's session. */
export function sessionView(data: Readonly<EnterpriseCatalog>, user: UserRecord, harnessPath: string): SessionView {
  const team = user.teamId === undefined ? undefined : data.teams.find(candidate => candidate.id === user.teamId)
  return {
    user: userView(data, user),
    permissions: permissionsFor(data, user),
    settings: { ...data.settings },
    runtime: {
      isolated: true,
      harnessPath,
      ...(team === undefined ? {} : { tenant: { id: team.id, slug: team.slug, name: team.name } }),
    },
  }
}

/** Project a team with plan and seat usage. */
export function teamViews(data: Readonly<EnterpriseCatalog>): TeamView[] {
  return data.teams.map(team => ({
    ...team,
    planName: data.plans.find(plan => plan.id === team.planId)?.name ?? '未分配套餐',
    memberCount: data.users.filter(user => user.teamId === team.id).length,
  }))
}

/** Project roles with active member counts. */
export function roleViews(data: Readonly<EnterpriseCatalog>): RoleView[] {
  return data.roles.map(role => ({
    ...role,
    permissions: [...role.permissions],
    userCount: data.users.filter(user => user.roleId === role.id).length,
  }))
}

/** Project plans with attached team counts. */
export function planViews(data: Readonly<EnterpriseCatalog>): PlanView[] {
  return data.plans.map(plan => ({
    ...plan,
    features: [...plan.features],
    teamCount: data.teams.filter(team => team.planId === plan.id).length,
  }))
}

/** Project orders with plan and team names. */
export function orderViews(data: Readonly<EnterpriseCatalog>): OrderView[] {
  return [...data.orders]
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .map(order => ({
      ...order,
      teamName: data.teams.find(team => team.id === order.teamId)?.name ?? '已删除团队',
      planName: data.plans.find(plan => plan.id === order.planId)?.name ?? '已删除套餐',
    }))
}

/** Project channels without ever exposing credential ciphertext. */
export function channelViews(data: Readonly<EnterpriseCatalog>): ChannelView[] {
  return data.channels.map((channel) => {
    const { encryptedApiKey: _encryptedApiKey, ...visible } = channel
    return {
      ...visible,
      hasCredential: channel.encryptedApiKey !== '',
      modelCount: data.models.filter(model => model.channelId === channel.id).length,
    }
  })
}

/** Project models with channel names. */
export function modelViews(data: Readonly<EnterpriseCatalog>): ModelView[] {
  return data.models.map(model => ({
    ...model,
    capabilities: [...model.capabilities],
    channelName: data.channels.find(channel => channel.id === model.channelId)?.name ?? '已删除渠道',
  }))
}

/** Project built-in policy and enterprise-added bundles with the viewer's controls. */
export function pluginsView(
  data: Readonly<EnterpriseCatalog>,
  canWriteBuiltins: boolean,
  canWriteEnterprise: boolean,
): PluginsView {
  const records = new Map(data.plugins.map(plugin => [`${plugin.scope}:${plugin.packageName}`, plugin]))
  return {
    builtins: BUILTIN_PLUGINS.map((definition) => {
      const stored = records.get(`builtin:${definition.packageName}`)
      return {
        id: stored?.id ?? builtinPluginId(definition.packageName),
        scope: 'builtin',
        packageName: definition.packageName,
        label: definition.label,
        description: definition.description,
        ...(stored?.version === undefined ? {} : { version: stored.version }),
        enabled: stored?.enabled ?? false,
        manageable: canWriteBuiltins,
      }
    }),
    enterprise: data.plugins
      .filter(plugin => plugin.scope === 'enterprise')
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
      .map(plugin => ({
        id: plugin.id,
        scope: 'enterprise',
        packageName: plugin.packageName,
        label: plugin.packageName,
        description: plugin.description,
        ...(plugin.version === undefined ? {} : { version: plugin.version }),
        enabled: plugin.enabled,
        manageable: canWriteEnterprise,
      })),
  }
}

/** Project one usage row with joined display names. */
export function usageView(data: Readonly<EnterpriseCatalog>, usage: UsageRecord): UsageView {
  const userEmail = usage.userId === undefined ? undefined : data.users.find(user => user.id === usage.userId)?.email
  const channelName = usage.channelId === undefined ? undefined : data.channels.find(channel => channel.id === usage.channelId)?.name
  return {
    ...usage,
    teamName: data.teams.find(team => team.id === usage.teamId)?.name ?? '已删除团队',
    ...(userEmail === undefined ? {} : { userEmail }),
    modelName: usage.modelId === 'model-unattributed'
      ? '未识别模型'
      : data.models.find(model => model.id === usage.modelId)?.displayName ?? '已删除模型',
    ...(channelName === undefined ? {} : { channelName }),
  }
}

/** Build the dashboard projection from the catalog and SQLite usage aggregate. */
export function dashboardView(
  data: Readonly<EnterpriseCatalog>,
  usage: UsageAggregate,
  recentAudit: readonly AuditRecord[],
  days = 30,
): DashboardView {
  const windowDays = Math.max(1, Math.floor(days))
  const byDay = new Map<string, { requests: number; inputTokens: number; outputTokens: number; costCents: number }>()
  for (let offset = windowDays - 1; offset >= 0; offset -= 1) {
    const date = new Date(Date.now() - offset * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    byDay.set(date, { requests: 0, inputTokens: 0, outputTokens: 0, costCents: 0 })
  }
  for (const usageDay of usage.byDay) {
    const row = byDay.get(usageDay.date)
    if (row === undefined) continue
    row.requests += usageDay.requests
    row.inputTokens += usageDay.inputTokens
    row.outputTokens += usageDay.outputTokens
    row.costCents += usageDay.costCents
  }
  const monthlyRecurringRevenueCents = data.teams.reduce((total, team) => {
    if (team.status !== 'active') return total
    const plan = data.plans.find(candidate => candidate.id === team.planId)
    return total + (plan?.status === 'active' ? plan.monthlyPriceCents : 0)
  }, 0)
  return {
    stats: {
      users: data.users.length,
      activeUsers: data.users.filter(user => user.status === 'active').length,
      teams: data.teams.length,
      monthlyRecurringRevenueCents,
      pendingOrders: data.orders.filter(order => order.status === 'pending').length,
      channels: data.channels.length,
      models: data.models.length,
      requests: usage.totals.requests,
      inputTokens: usage.totals.inputTokens,
      outputTokens: usage.totals.outputTokens,
      costCents: usage.totals.costCents,
    },
    usageByDay: [...byDay.entries()].map(([date, row]) => ({ date, ...row })),
    modelUsage: usage.byModel
      .map(row => ({
        modelName: row.modelId === 'model-unattributed'
          ? '未识别模型'
          : data.models.find(model => model.id === row.modelId)?.displayName ?? '已删除模型',
        ...row,
      }))
      .sort((left, right) => right.requests - left.requests),
    teamUsage: usage.byTeam
      .map(row => ({
        teamName: data.teams.find(team => team.id === row.teamId)?.name ?? '已删除团队',
        ...row,
      }))
      .sort((left, right) => right.requests - left.requests),
    recentAudit: [...recentAudit],
  }
}
