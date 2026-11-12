/** Typed client for plan-based agent access and the curated catalog. */
import { request } from './api.ts'
import { publicPath } from './public-path.ts'

export type AgentIcon =
  | 'spark' | 'strategy' | 'operations' | 'brand' | 'growth' | 'marketing'
  | 'finance' | 'organization' | 'legal' | 'image' | 'video' | 'document'
  | 'chat' | 'knowledge'
export interface Agent {
  id: string; title: string; description: string; alias: string; group: string; category: string; icon: AgentIcon;
  tasks: string; materials: string; deliverables: string; example: string; disclaimer: string;
  sortOrder: number; recommended: boolean; output: 'pptx' | 'text' | 'video';
  kind: 'agent' | 'expert' | 'team'; members: Array<{ id: string; title: string }>;
  teamUnlocked: boolean;
  entitlement: { active: boolean; expiresAt: string | null } | null
}
export interface ManagedAgent extends Omit<Agent, 'entitlement' | 'members' | 'teamUnlocked'> {
  executor: 'ppt-master' | 'text' | 'video'; published: boolean; modelId: string; systemPrompt: string; skill: string; revision: number;
  members: string[]
}
export interface Job {
  id: string; agentId: string; title: string; state: 'queued' | 'running' | 'completed' | 'failed' | 'interrupted';
  input: string; result: string | null; error: string | null; artifact: string | null; createdAt: string
}
/** Paid-plan capability that decides which catalog entries a team may unlock. */
export interface PlanAccess {
  planCode: string; planName: string; agentLimit: number | null; teams: boolean; unlocked: number
}
export interface Market { agents: Agent[]; access: PlanAccess; jobs: Job[] }
export interface Member { id: string; name: string; teamId: string; teamName: string }
/** One team's paid-plan capability and current unlock count. */
export interface TeamAccess extends PlanAccess { id: string; name: string }
export interface ProductAdmin { agents: ManagedAgent[]; models: Array<{ id: string; name: string }>; members: Member[]; teams: TeamAccess[] }
/** Market operations; request keys survive uncertain client outcomes. */
export const productApi = {
  market: () => request<Market>('/product/market'),
  admin: () => request<ProductAdmin>('/product/admin/catalog'),
  save: (agent: ManagedAgent) => request<ManagedAgent>('/product/admin/agents', { method: 'POST', body: { ...agent } }),
  grant: (member: Member, agentId: string, expiresAt: string | null, revoke: boolean) => request('/product/admin/entitlement', { method: 'POST', body: { teamId: member.teamId, userId: member.id, agentId, expiresAt, revoke } }),
  purchase: (agentId: string, key: string) => request('/product/purchase', { method: 'POST', body: { agentId, key } }),
  run: (agentId: string, input: string, key: string) => request<Job>('/product/jobs', { method: 'POST', body: { agentId, input, key } }),
  download: (jobId: string) => publicPath(`/enterprise/api/product/jobs/${encodeURIComponent(jobId)}/download`),
}
