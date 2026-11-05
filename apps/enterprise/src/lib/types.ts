export type UserStatus = 'active' | 'disabled'
export type TeamStatus = 'active' | 'suspended'
export type PlanStatus = 'active' | 'archived'
export type OrderStatus = 'pending' | 'paid' | 'rejected'
export type ChannelStatus = 'active' | 'disabled'
export type BillingCycle = 'monthly' | 'annual'

export interface User {
  id: string
  email: string
  phone?: string
  name: string
  roleId: string
  roleName: string
  teamId?: string
  teamName?: string
  status: UserStatus
  createdAt: string
  lastLoginAt?: string
}

export interface Team {
  id: string
  name: string
  slug: string
  planId: string
  planName: string
  status: TeamStatus
  seatLimit: number
  memberCount: number
  notes: string
  createdAt: string
}

export interface Role {
  id: string
  name: string
  description: string
  permissions: string[]
  system: boolean
  userCount: number
  createdAt: string
}

export interface Plan {
  id: string
  name: string
  code: string
  monthlyPriceCents: number
  annualPriceCents: number
  seatLimit: number
  monthlyCredits: number
  features: string[]
  status: PlanStatus
  teamCount: number
  createdAt: string
}

export interface Order {
  id: string
  number: string
  teamId: string
  teamName: string
  planId: string
  planName: string
  amountCents: number
  billingCycle: BillingCycle
  status: OrderStatus
  reference: string
  createdAt: string
  reviewedAt?: string
  reviewedBy?: string
}

export interface Channel {
  id: string
  name: string
  provider: string
  baseUrl: string
  hasCredential: boolean
  priority: number
  status: ChannelStatus
  modelCount: number
  createdAt: string
  updatedAt: string
}

export interface Model {
  id: string
  name: string
  displayName: string
  channelId: string
  channelName: string
  inputPricePerMillionCents: number
  outputPricePerMillionCents: number
  contextWindow: number
  capabilities: string[]
  status: 'active' | 'disabled'
  createdAt: string
}

export interface PluginView {
  id: string
  scope: 'builtin' | 'enterprise'
  packageName: string
  label: string
  description: string
  version?: string
  enabled: boolean
  manageable: boolean
}

export interface PluginsView {
  builtins: PluginView[]
  enterprise: PluginView[]
}

export interface Usage {
  id: string
  teamId: string
  teamName: string
  userId?: string
  userEmail?: string
  modelId: string
  modelName: string
  channelId?: string
  channelName?: string
  requests: number
  inputTokens: number
  outputTokens: number
  costCents: number
  recordedAt: string
}

export interface UsageResponse {
  summary: {
    requests: number
    inputTokens: number
    outputTokens: number
    costCents: number
  }
  records: Usage[]
}

export interface BillingOverview {
  team: {
    id: string
    name: string
    slug: string
    status: TeamStatus
    seatLimit: number
    memberCount: number
  }
  plan?: Plan
  cycle: {
    startsAt: string
    endsAt: string
  }
  quota: {
    totalTokens: number
    usedTokens: number
    remainingTokens: number
    userTokens: number
    requests: number
    userRequests: number
    costCents: number
    percentUsed: number
  }
  plans: Plan[]
  orders: Order[]
  canPurchase: boolean
}

export interface Audit {
  id: string
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

export interface Settings {
  registrationEnabled: boolean
  defaultRoleId: string
  defaultTeamId: string
  defaultPlanId: string
  sessionMaxAgeDays: number
  supportEmail: string
  brandName: string
}

export interface Session {
  user: User
  permissions: string[]
  settings: Settings
  runtime: {
    isolated: true
    harnessPath: string
    tenant?: {
      id: string
      slug: string
      name: string
    }
  }
}

export interface Dashboard {
  stats: {
    users: number
    activeUsers: number
    teams: number
    monthlyRecurringRevenueCents: number
    pendingOrders: number
    channels: number
    models: number
    requests: number
    inputTokens: number
    outputTokens: number
    costCents: number
  }
  usageByDay: Array<{
    date: string
    requests: number
    inputTokens: number
    outputTokens: number
    costCents: number
  }>
  modelUsage: Array<{
    modelId: string
    modelName: string
    requests: number
    tokens: number
    costCents: number
  }>
  teamUsage: Array<{
    teamId: string
    teamName: string
    requests: number
    costCents: number
  }>
  recentAudit: Audit[]
}

export interface PublicConfig {
  brandName: string
  registrationEnabled: boolean
  supportEmail: string
  verificationEnabled: boolean
}

export interface UserCreateResult {
  user: User
  temporaryPassword?: string
}

export interface TeamFileEntry {
  name: string
  path: string
  kind: 'file' | 'directory'
  size: number
  modifiedAt: string
  editable: boolean
}

export interface TeamFileListing {
  directory: string
  parent: string | null
  entries: TeamFileEntry[]
}

export interface TeamTextFile {
  path: string
  name: string
  size: number
  modifiedAt: string
  content: string
  editable: true
}

export interface TeamSkillSummary {
  name: string
  description: string
  whenToUse?: string
  managedBy: 'user' | 'knowledge'
  updatedAt: string
}

export interface TeamSkill extends TeamSkillSummary {
  instructions: string
}

export interface TeamSkillInput {
  name: string
  description: string
  instructions: string
}

export interface KnowledgeSummary {
  id: string
  title: string
  summary: string
  tags: string[]
  createdAt: string
  updatedAt: string
}

export interface KnowledgeArticle extends KnowledgeSummary {
  body: string
}

export interface KnowledgeInput {
  title: string
  summary: string
  body: string
  tags: string[]
}
