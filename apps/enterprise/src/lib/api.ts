import { publicPath } from './public-path.ts'
import type {
  Audit,
  BillingCycle,
  BillingOverview,
  Channel,
  Dashboard,
  KnowledgeArticle,
  KnowledgeInput,
  KnowledgeSummary,
  Model,
  Order,
  Plan,
  PluginsView,
  PublicConfig,
  Role,
  Session,
  Settings,
  Team,
  TeamFileEntry,
  TeamFileListing,
  TeamSkill,
  TeamSkillInput,
  TeamSkillSummary,
  TeamTextFile,
  UsageResponse,
  User,
  UserCreateResult,
} from './types.ts'

const API_ROOT = publicPath('/enterprise/api')

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'
  body?: Record<string, unknown>
  query?: Record<string, string | number | undefined>
}

/**
 * Send a same-origin console request.
 * @param path - API-relative path.
 * @param options - method and input.
 * @returns parsed response or typed API error.
 */
export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const url = new URL(`${API_ROOT}${path}`, window.location.origin)
  for (const [key, value] of Object.entries(options.query ?? {})) {
    if (value !== undefined && value !== '') url.searchParams.set(key, String(value))
  }
  const init: RequestInit = {
    method: options.method ?? 'GET',
    credentials: 'same-origin',
  }
  if (options.body !== undefined) {
    init.headers = { 'content-type': 'application/json' }
    init.body = JSON.stringify(options.body)
  }
  const response = await fetch(url, init)
  return await parseResponse<T>(response, path)
}

async function parseResponse<T>(response: Response, path: string): Promise<T> {
  if (response.status === 204) return undefined as T
  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    throw new ApiError(response.ok ? '服务器返回了无法解析的响应' : `请求失败（${String(response.status)}）`, response.status, 'invalid_response')
  }
  if (!response.ok) {
    const error = (payload as { error?: { message?: unknown; code?: unknown } }).error
    const message = typeof error?.message === 'string' ? error.message : `请求失败（${String(response.status)}）`
    const code = typeof error?.code === 'string' ? error.code : 'request_failed'
    if (response.status === 401 && path !== '/login' && !path.startsWith('/auth/')) {
      window.dispatchEvent(new Event('enterprise:unauthorized'))
    }
    throw new ApiError(message, response.status, code)
  }
  return payload as T
}

export interface UserInput {
  email: string
  phone?: string
  name: string
  roleId: string
  teamId?: string
  status?: 'active' | 'disabled'
  password?: string
}

export interface TeamInput {
  name: string
  slug: string
  planId: string
  seatLimit: number
  status?: 'active' | 'suspended'
  notes?: string
}

export interface RoleInput {
  name: string
  description?: string
  permissions: string[]
}

export interface PlanInput {
  name: string
  code: string
  monthlyPriceCents: number
  annualPriceCents: number
  seatLimit: number
  monthlyCredits: number
  features: string[]
  status?: 'active' | 'archived'
}

export interface ChannelInput {
  name: string
  provider: string
  baseUrl: string
  apiKey?: string
  priority: number
  status?: 'active' | 'disabled'
}

export interface ModelInput {
  name: string
  displayName: string
  channelId: string
  inputPricePerMillionCents: number
  outputPricePerMillionCents: number
  contextWindow: number
  capabilities: string[]
  status?: 'active' | 'disabled'
}

export interface UsageInput {
  teamId: string
  userId?: string
  modelId: string
  channelId?: string
  requests: number
  inputTokens: number
  outputTokens: number
  recordedAt?: string
}

export interface RegisterInput {
  identifier: string
  code: string
  name: string
  password: string
  email?: string
  phone?: string
}

export const api = {
  publicConfig: () => request<PublicConfig>('/public-config'),
  session: () => request<Session>('/session'),
  login: (identifier: string, password: string) => request<Session>('/login', {
    method: 'POST',
    body: { identifier, password },
  }),
  requestVerificationCode: (identifier: string, purpose: 'login' | 'register') => request<{
    ok: true
    expiresInSeconds: number
    retryAfterSeconds: number
  }>('/auth/verification-code', { method: 'POST', body: { identifier, purpose } }),
  loginWithCode: (identifier: string, code: string) => request<Session>('/auth/login/code', {
    method: 'POST',
    body: { identifier, code },
  }),
  register: (input: RegisterInput) => request<Session>('/auth/register', { method: 'POST', body: { ...input } }),
  logout: () => request<{ ok: true }>('/logout', { method: 'POST' }),
  changePassword: (currentPassword: string, newPassword: string) => request<{ ok: true }>('/session/password', {
    method: 'POST',
    body: { currentPassword, newPassword },
  }),
  dashboard: () => request<Dashboard>('/dashboard'),
  users: () => request<User[]>('/users'),
  createUser: (input: UserInput) => request<UserCreateResult>('/users', { method: 'POST', body: { ...input } }),
  updateUser: (id: string, input: Partial<UserInput>) => request<User>(`/users/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: { ...input },
  }),
  deleteUser: (id: string) => request<{ ok: true }>(`/users/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  teams: () => request<Team[]>('/teams'),
  createTeam: (input: TeamInput) => request<Team>('/teams', { method: 'POST', body: { ...input } }),
  updateTeam: (id: string, input: Partial<TeamInput>) => request<Team>(`/teams/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: { ...input },
  }),
  deleteTeam: (id: string) => request<{ ok: true }>(`/teams/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  roles: () => request<Role[]>('/roles'),
  createRole: (input: RoleInput) => request<Role>('/roles', { method: 'POST', body: { ...input } }),
  updateRole: (id: string, input: Partial<RoleInput>) => request<Role>(`/roles/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: { ...input },
  }),
  deleteRole: (id: string) => request<{ ok: true }>(`/roles/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  plans: () => request<Plan[]>('/plans'),
  createPlan: (input: PlanInput) => request<Plan>('/plans', { method: 'POST', body: { ...input } }),
  updatePlan: (id: string, input: Partial<PlanInput>) => request<Plan>(`/plans/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: { ...input },
  }),
  deletePlan: (id: string) => request<{ ok: true }>(`/plans/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  orders: () => request<Order[]>('/orders'),
  billing: () => request<BillingOverview>('/billing'),
  createBillingOrder: (input: { planId: string; billingCycle: BillingCycle; reference?: string }) => request<Order>('/billing/orders', {
    method: 'POST',
    body: { ...input },
  }),
  createOrder: (input: { teamId: string; planId: string; billingCycle: BillingCycle; reference?: string }) => request<Order>('/orders', {
    method: 'POST',
    body: { ...input },
  }),
  reviewOrder: (id: string, action: 'approve' | 'reject') => request<Order>(`/orders/${encodeURIComponent(id)}/${action}`, {
    method: 'POST',
    body: {},
  }),
  channels: () => request<Channel[]>('/channels'),
  createChannel: (input: ChannelInput) => request<Channel>('/channels', { method: 'POST', body: { ...input } }),
  updateChannel: (id: string, input: Partial<ChannelInput>) => request<Channel>(`/channels/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: { ...input },
  }),
  deleteChannel: (id: string) => request<{ ok: true }>(`/channels/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  models: () => request<Model[]>('/models'),
  createModel: (input: ModelInput) => request<Model>('/models', { method: 'POST', body: { ...input } }),
  updateModel: (id: string, input: Partial<ModelInput>) => request<Model>(`/models/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: { ...input },
  }),
  deleteModel: (id: string) => request<{ ok: true }>(`/models/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  plugins: () => request<PluginsView>('/plugins'),
  addBuiltinPlugin: (packageName: string) => request<PluginsView>('/plugins/builtin', { method: 'POST', body: { packageName } }),
  addPlugin: (spec: string) => request<PluginsView>('/plugins', { method: 'POST', body: { spec } }),
  setPluginEnabled: (id: string, enabled: boolean) => request<PluginsView>(`/plugins/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: { enabled },
  }),
  removePlugin: (id: string) => request<PluginsView>(`/plugins/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  usage: (query: { teamId?: string; modelId?: string; from?: string; to?: string; limit?: number } = {}) => request<UsageResponse>('/usage', { query }),
  recordUsage: (input: UsageInput) => request<unknown>('/usage/record', { method: 'POST', body: { ...input } }),
  audit: (query: { actor?: string; action?: string; from?: string; to?: string; limit?: number } = {}) => request<Audit[]>('/audit', { query }),
  settings: () => request<Settings>('/settings'),
  updateSettings: (input: Partial<Settings>) => request<Settings>('/settings', { method: 'PATCH', body: { ...input } }),
  resourceFiles: (path = '', teamId?: string) => request<TeamFileListing>('/resources/files', { query: { path, teamId } }),
  resourceFileContent: (path: string, teamId?: string) => request<TeamTextFile>('/resources/files/content', { query: { path, teamId } }),
  updateResourceFileContent: (path: string, content: string, teamId?: string) => request<TeamFileEntry>('/resources/files/content', {
    method: 'PATCH',
    body: { path, content },
    query: { teamId },
  }),
  createResourceDirectory: (path: string, teamId?: string) => request<TeamFileEntry>('/resources/files/directory', {
    method: 'POST',
    body: { path },
    query: { teamId },
  }),
  renameResourceFile: (path: string, name: string, teamId?: string) => request<TeamFileEntry>('/resources/files', {
    method: 'PATCH',
    body: { path, name },
    query: { teamId },
  }),
  deleteResourceFile: (path: string, teamId?: string) => request<{ ok: true }>('/resources/files', {
    method: 'DELETE',
    query: { path, teamId },
  }),
  resourceSkills: (teamId?: string) => request<TeamSkillSummary[]>('/resources/skills', { query: { teamId } }),
  resourceSkill: (name: string, teamId?: string) => request<TeamSkill>(
    `/resources/skills/${encodeURIComponent(name)}`,
    { query: { teamId } },
  ),
  createResourceSkill: (input: TeamSkillInput, teamId?: string) => request<TeamSkill>('/resources/skills', {
    method: 'POST',
    body: { ...input },
    query: { teamId },
  }),
  updateResourceSkill: (name: string, input: Omit<TeamSkillInput, 'name'>, teamId?: string) => request<TeamSkill>(
    `/resources/skills/${encodeURIComponent(name)}`,
    { method: 'PATCH', body: { ...input }, query: { teamId } },
  ),
  deleteResourceSkill: (name: string, teamId?: string) => request<{ ok: true }>(`/resources/skills/${encodeURIComponent(name)}`, {
    method: 'DELETE',
    query: { teamId },
  }),
  knowledge: (teamId?: string) => request<KnowledgeSummary[]>('/resources/knowledge', { query: { teamId } }),
  knowledgeArticle: (id: string, teamId?: string) => request<KnowledgeArticle>(
    `/resources/knowledge/${encodeURIComponent(id)}`,
    { query: { teamId } },
  ),
  createKnowledge: (input: KnowledgeInput, teamId?: string) => request<KnowledgeArticle>('/resources/knowledge', {
    method: 'POST',
    body: { ...input },
    query: { teamId },
  }),
  updateKnowledge: (id: string, input: KnowledgeInput, teamId?: string) => request<KnowledgeArticle>(
    `/resources/knowledge/${encodeURIComponent(id)}`,
    { method: 'PATCH', body: { ...input }, query: { teamId } },
  ),
  deleteKnowledge: (id: string, teamId?: string) => request<{ ok: true }>(`/resources/knowledge/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    query: { teamId },
  }),
}

export async function uploadResourceFile(directory: string, file: File, teamId?: string): Promise<TeamFileEntry> {
  const url = new URL(`${API_ROOT}/resources/files/upload`, window.location.origin)
  url.searchParams.set('path', directory)
  url.searchParams.set('name', file.name)
  if (teamId !== undefined) url.searchParams.set('teamId', teamId)
  const response = await fetch(url, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': file.type || 'application/octet-stream' },
    body: file,
  })
  return await parseResponse<TeamFileEntry>(response, '/resources/files/upload')
}

export function resourceFileDownloadUrl(path: string, teamId?: string): string {
  const url = new URL(`${API_ROOT}/resources/files/download`, window.location.origin)
  url.searchParams.set('path', path)
  if (teamId !== undefined) url.searchParams.set('teamId', teamId)
  return `${url.pathname}${url.search}`
}
