/** Typed client for points and curated agents. */
import { request } from './api.ts'
import { publicPath } from './public-path.ts'

export interface Agent {
  id: string; title: string; description: string; category: string; output: 'pptx' | 'text' | 'video'; price: number;
  durationDays: number | null; entitlement: { active: boolean; expiresAt: string | null } | null
}
export interface ManagedAgent extends Omit<Agent, 'entitlement'> {
  executor: 'ppt-master' | 'text' | 'video'; published: boolean; modelId: string; systemPrompt: string; skill: string; revision: number
}
export interface Wallet { balance: number; reserved: number; canPurchase: boolean; canRun: boolean }
export interface Job {
  id: string; agentId: string; title: string; state: 'queued' | 'running' | 'completed' | 'failed' | 'interrupted';
  input: string; result: string | null; error: string | null; artifact: string | null; charged: number; createdAt: string
}
export interface Market { agents: Agent[]; wallet: Wallet; jobs: Job[]; ledger: Array<{ id: string; kind: string; delta: number; note: string; createdAt: string }> }
export interface Member { id: string; name: string; teamId: string; teamName: string; wallet: Wallet }
export interface ProductReview { id: string; jobId: string; userId: string; teamId: string; reserved: number }
export interface ProductAdmin { agents: ManagedAgent[]; rates: { input: number; output: number } | null; models: Array<{ id: string; name: string }>; members: Member[]; reviews: ProductReview[] }
export interface FeilianStatus {
  available: boolean; bound: boolean; account?: string; state: 'unavailable' | 'unbound' | 'connected' | 'reauth' | 'offline';
  knowledgeBases: Array<{ id: string; name: string }>; registrationUrl?: string; enterpriseUrl?: string
}

/** Points and market operations; request keys survive uncertain client outcomes. */
export const productApi = {
  market: () => request<Market>('/product/market'),
  admin: () => request<ProductAdmin>('/product/admin/catalog'),
  save: (agent: ManagedAgent) => request<ManagedAgent>('/product/admin/agents', { method: 'POST', body: { ...agent } }),
  rates: (input: number, output: number) => request('/product/admin/rates', { method: 'POST', body: { input, output } }),
  policy: (member: Member, canPurchase: boolean, canRun: boolean) => request('/product/admin/wallet', { method: 'POST', body: { teamId: member.teamId, userId: member.id, canPurchase, canRun } }),
  credit: (member: Member, points: number, key: string, note: string) => request('/product/admin/credit', { method: 'POST', body: { teamId: member.teamId, userId: member.id, points, key, note } }),
  grant: (member: Member, agentId: string, expiresAt: string | null, revoke: boolean) => request('/product/admin/entitlement', { method: 'POST', body: { teamId: member.teamId, userId: member.id, agentId, expiresAt, revoke } }),
  reconcile: (id: string, inputTokens: number, outputTokens: number, note: string) => request('/product/admin/reconcile', { method: 'POST', body: { id, inputTokens, outputTokens, note } }),
  purchase: (agentId: string, key: string) => request('/product/purchase', { method: 'POST', body: { agentId, key } }),
  run: (agentId: string, input: string, key: string) => request<Job>('/product/jobs', { method: 'POST', body: { agentId, input, key } }),
  download: (jobId: string) => publicPath(`/enterprise/api/product/jobs/${encodeURIComponent(jobId)}/download`),
  feilian: () => request<FeilianStatus>('/product/feilian'),
  bindFeilian: (email: string, password: string, tenantSlug: string) => request('/product/feilian/bind', { method: 'POST', body: { email, password, tenantSlug } }),
  unbindFeilian: () => request('/product/feilian/unbind', { method: 'POST', body: {} }),
  queryFeilian: (knowledgeBaseId: string, question: string) => request<{ answer: string }>('/product/feilian/query', { method: 'POST', body: { knowledgeBaseId, question } }),
}
