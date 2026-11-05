/** Durable enterprise console records and their public projections. */

export type UserStatus = 'active' | 'disabled'
export type TeamStatus = 'active' | 'suspended'
export type PlanStatus = 'active' | 'archived'
export type OrderStatus = 'pending' | 'paid' | 'rejected'
export type ChannelStatus = 'active' | 'disabled'
export type ChannelWireProtocol = 'openai-chat' | 'openai-responses' | 'anthropic-messages'
export type DesktopGatewayStatus = 'started' | 'completed' | 'failed' | 'usage_missing'
export type CatalogStatus = 'active' | 'disabled'
export type BillingCycle = 'monthly' | 'annual'
export type PluginScope = 'builtin' | 'enterprise'

export interface UserRecord {
  readonly id: string
  email: string
  phone?: string
  name: string
  passwordHash: string
  roleId: string
  teamId?: string
  status: UserStatus
  sessionVersion: number
  createdAt: string
  lastLoginAt?: string
}

export interface TeamRecord {
  readonly id: string
  name: string
  slug: string
  planId: string
  status: TeamStatus
  seatLimit: number
  notes: string
  createdAt: string
}

export interface RoleRecord {
  readonly id: string
  name: string
  description: string
  permissions: string[]
  system: boolean
  createdAt: string
}

export interface PlanRecord {
  readonly id: string
  name: string
  code: string
  monthlyPriceCents: number
  annualPriceCents: number
  seatLimit: number
  monthlyCredits: number
  features: string[]
  status: PlanStatus
  createdAt: string
}

export interface OrderRecord {
  readonly id: string
  number: string
  teamId: string
  planId: string
  amountCents: number
  billingCycle: BillingCycle
  status: OrderStatus
  reference: string
  createdAt: string
  reviewedAt?: string
  reviewedBy?: string
}

export interface ChannelRecord {
  readonly id: string
  name: string
  provider: string
  baseUrl: string
  encryptedApiKey: string
  wireProtocol: ChannelWireProtocol
  priority: number
  status: ChannelStatus
  createdAt: string
  updatedAt: string
}

export interface ModelRecord {
  readonly id: string
  name: string
  displayName: string
  channelId: string
  inputPricePerMillionCents: number
  outputPricePerMillionCents: number
  contextWindow: number
  capabilities: string[]
  status: CatalogStatus
  createdAt: string
}

export interface UsageRecord {
  readonly id: string
  /** Stable external attempt identity used to deduplicate metered retries. */
  externalId?: string
  teamId: string
  userId?: string
  modelId: string
  channelId?: string
  requests: number
  inputTokens: number
  outputTokens: number
  costCents: number
  recordedAt: string
}

export interface AuditRecord {
  readonly id: string
  actorId?: string
  actorEmail: string
  action: string
  targetType: string
  targetId?: string
  summary: string
  ip: string
  createdAt: string
  metadata?: Record<string, string | number | boolean | null>
}

export interface SettingsRecord {
  registrationEnabled: boolean
  defaultRoleId: string
  defaultTeamId: string
  defaultPlanId: string
  sessionMaxAgeDays: number
  supportEmail: string
  brandName: string
}

/** One desktop installation authorized to refresh an enterprise access grant. */
export interface DesktopDeviceRecord {
  readonly id: string
  readonly userId: string
  readonly refreshSecretHash: string
  readonly userSessionVersion: number
  readonly createdAt: string
  lastUsedAt: string
  revokedAt?: string
}

/** Durable state for one model-gateway request identity. */
export interface DesktopGatewayAttemptRecord {
  readonly id: string
  readonly requestId: string
  readonly teamId: string
  readonly userId: string
  readonly modelId: string
  readonly channelId: string
  readonly sessionId?: string
  status: DesktopGatewayStatus
  inputTokens: number
  outputTokens: number
  readonly startedAt: string
  finishedAt?: string
}

/** Identity and policy payload delivered to an authenticated desktop Host. */
export interface DesktopBootstrap {
  readonly apiVersion: 1
  readonly cloudBaseUrl: string
  readonly profileKey: string
  readonly accessExpiresAt: string
  readonly user: { readonly id: string; readonly email: string; readonly name: string; readonly roleId: string }
  readonly team: { readonly id: string; readonly name: string; readonly slug: string }
  readonly minimumClientVersion: string
  readonly policy: {
    readonly consumerAnalytics: false
    readonly crashReports: 'enterprise-support'
    readonly supportEmail: string
  }
  readonly endpoints: {
    readonly bootstrap: '/enterprise/api/desktop/bootstrap'
    readonly models: '/enterprise/api/desktop/models'
    readonly resources: '/enterprise/api/desktop/resources'
    readonly sessions: '/enterprise/api/desktop/sessions'
    readonly plugins: '/enterprise/api/desktop/plugins'
    readonly billing: '/enterprise/api/desktop/billing'
  }
}

/** Short-lived desktop session returned by login and token rotation. */
export interface DesktopAuthGrant {
  readonly deviceId: string
  readonly accessToken: string
  readonly accessExpiresAt: string
  readonly refreshToken: string
  readonly refreshExpiresAt: string
  readonly bootstrap: DesktopBootstrap
}

/** One enterprise-wide plugin policy or enterprise-added bundle. */
export interface PluginRecord {
  readonly id: string
  scope: PluginScope
  packageName: string
  spec: string
  version?: string
  description: string
  enabled: boolean
  createdAt: string
  updatedAt: string
}

/** Durable administration catalog excluding append-only usage and audit history. */
export interface EnterpriseCatalog {
  version: 1
  users: UserRecord[]
  teams: TeamRecord[]
  roles: RoleRecord[]
  plans: PlanRecord[]
  orders: OrderRecord[]
  channels: ChannelRecord[]
  models: ModelRecord[]
  plugins: PluginRecord[]
  settings: SettingsRecord
}

/** Catalog plus the append-only records a write transaction may add. */
export interface EnterpriseData extends EnterpriseCatalog {
  usage: UsageRecord[]
  audit: AuditRecord[]
}

/** Aggregated usage for one dashboard window. */
export interface UsageAggregate {
  readonly totals: {
    readonly requests: number
    readonly inputTokens: number
    readonly outputTokens: number
    readonly costCents: number
  }
  readonly byDay: Array<{
    readonly date: string
    readonly requests: number
    readonly inputTokens: number
    readonly outputTokens: number
    readonly costCents: number
  }>
  readonly byModel: Array<{
    readonly modelId: string
    readonly requests: number
    readonly tokens: number
    readonly costCents: number
  }>
  readonly byTeam: Array<{
    readonly teamId: string
    readonly requests: number
    readonly costCents: number
  }>
}

export interface UserView extends Omit<UserRecord, 'passwordHash' | 'sessionVersion'> {
  readonly roleName: string
  readonly teamName?: string
}

export interface TeamView extends TeamRecord {
  readonly planName: string
  readonly memberCount: number
}

export interface RoleView extends RoleRecord {
  readonly userCount: number
}

export interface PlanView extends PlanRecord {
  readonly teamCount: number
}

export interface OrderView extends OrderRecord {
  readonly teamName: string
  readonly planName: string
}

export interface ChannelView extends Omit<ChannelRecord, 'encryptedApiKey'> {
  readonly hasCredential: boolean
  readonly modelCount: number
}

export interface ModelView extends ModelRecord {
  readonly channelName: string
}

/** One plugin policy row shown in the enterprise console. */
export interface PluginView {
  readonly id: string
  readonly scope: PluginScope
  readonly packageName: string
  readonly label: string
  readonly description: string
  readonly version?: string
  readonly enabled: boolean
  readonly manageable: boolean
}

/** Enterprise plugin policy grouped by ownership. */
export interface PluginsView {
  readonly builtins: PluginView[]
  readonly enterprise: PluginView[]
}

export interface UsageView extends UsageRecord {
  readonly teamName: string
  readonly userEmail?: string
  readonly modelName: string
  readonly channelName?: string
}

/** Current team allowance and the signed-in member's usage for one billing month. */
export interface BillingOverview {
  readonly team: {
    readonly id: string
    readonly name: string
    readonly slug: string
    readonly status: TeamStatus
    readonly seatLimit: number
    readonly memberCount: number
  }
  readonly plan?: PlanView
  readonly cycle: {
    readonly startsAt: string
    readonly endsAt: string
  }
  readonly quota: {
    readonly totalTokens: number
    readonly usedTokens: number
    readonly remainingTokens: number
    readonly userTokens: number
    readonly requests: number
    readonly userRequests: number
    readonly costCents: number
    readonly percentUsed: number
  }
  readonly plans: PlanView[]
  readonly orders: OrderView[]
  readonly canPurchase: boolean
}

export interface SessionView {
  readonly user: UserView
  readonly permissions: string[]
  readonly settings: SettingsRecord
  readonly runtime: {
    readonly isolated: true
    readonly harnessPath: string
    readonly tenant?: {
      readonly id: string
      readonly slug: string
      readonly name: string
    }
  }
}

export interface DashboardView {
  readonly stats: {
    readonly users: number
    readonly activeUsers: number
    readonly teams: number
    readonly monthlyRecurringRevenueCents: number
    readonly pendingOrders: number
    readonly channels: number
    readonly models: number
    readonly requests: number
    readonly inputTokens: number
    readonly outputTokens: number
    readonly costCents: number
  }
  readonly usageByDay: Array<{
    readonly date: string
    readonly requests: number
    readonly inputTokens: number
    readonly outputTokens: number
    readonly costCents: number
  }>
  readonly modelUsage: Array<{
    readonly modelId: string
    readonly modelName: string
    readonly requests: number
    readonly tokens: number
    readonly costCents: number
  }>
  readonly teamUsage: Array<{
    readonly teamId: string
    readonly teamName: string
    readonly requests: number
    readonly costCents: number
  }>
  readonly recentAudit: AuditRecord[]
}

/** Permission to maintain the team-shared files, knowledge, and skills. */
export const RESOURCE_WRITE_PERMISSION = 'workspace.resources.write'

/** Permission to submit a self-service plan order for the member's own team. */
export const BILLING_PURCHASE_PERMISSION = 'billing.purchase'

/** Permission to control the built-in plugin set shared by every enterprise tenant. */
export const BUILTIN_PLUGIN_WRITE_PERMISSION = 'plugins.builtin.write'

/** Permission to add and manage enterprise-only plugin bundles. */
export const ENTERPRISE_PLUGIN_WRITE_PERMISSION = 'plugins.enterprise.write'

/** Every permission understood by the administration API. */
export const PERMISSIONS = [
  'workspace.use',
  RESOURCE_WRITE_PERMISSION,
  BILLING_PURCHASE_PERMISSION,
  BUILTIN_PLUGIN_WRITE_PERMISSION,
  ENTERPRISE_PLUGIN_WRITE_PERMISSION,
  'dashboard.read',
  'users.read',
  'users.write',
  'teams.read',
  'teams.write',
  'roles.read',
  'roles.write',
  'plans.read',
  'plans.write',
  'orders.read',
  'orders.write',
  'channels.read',
  'channels.write',
  'models.read',
  'models.write',
  'usage.read',
  'usage.write',
  'audit.read',
  'settings.read',
  'settings.write',
] as const

export type Permission = typeof PERMISSIONS[number]
