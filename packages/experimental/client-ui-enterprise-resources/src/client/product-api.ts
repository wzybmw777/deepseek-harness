import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
/** Workbench market operations share the authenticated enterprise transport. */
import { request } from './api.ts'
import { enterpriseApiPath } from './public-path.ts'

/** Public agent metadata; administrative prompts stay on the server. */
export type AgentIcon =
  | 'spark' | 'strategy' | 'operations' | 'brand' | 'growth' | 'marketing'
  | 'finance' | 'organization' | 'legal' | 'image' | 'video' | 'document'
  | 'chat' | 'knowledge'

/** Workbench surface: a curated agent, an imported expert persona, or an expert team. */
export type AgentKind = 'agent' | 'expert' | 'team'

/** One member listed on an expert team card. */
export interface MarketTeamMember {
  readonly id: string
  readonly title: string
}

export interface MarketAgent {
  readonly id: string
  readonly title: string
  readonly description: string
  readonly kind: AgentKind
  readonly members: readonly MarketTeamMember[]
  readonly alias?: string
  readonly group?: string
  readonly category: string
  readonly icon?: AgentIcon
  readonly tasks?: string
  readonly materials?: string
  readonly deliverables?: string
  readonly example?: string
  readonly disclaimer?: string
  readonly sortOrder?: number
  readonly recommended?: boolean
  readonly output: 'pptx' | 'text' | 'video'
  readonly teamUnlocked: boolean
  readonly entitlement: { readonly active: boolean; readonly expiresAt: string | null } | null
}

/** Paid-plan capability that decides which catalog entries a team may unlock. */
export interface PlanAccess {
  readonly planCode: string
  readonly planName: string
  readonly agentLimit: number | null
  readonly teams: boolean
  readonly unlocked: number
}

/** A member's durable task and downloadable result. */
export interface MarketJob {
  readonly id: string
  readonly agentId: string
  readonly title: string
  readonly state: 'queued' | 'running' | 'completed' | 'failed' | 'interrupted'
  readonly input: string
  readonly result: string | null
  readonly error: string | null
  readonly artifact: string | null
  readonly createdAt: string
}

/** Read model used inside the workbench, excluding administrative configuration. */
export interface MarketSnapshot {
  readonly agents: MarketAgent[]
  readonly access: PlanAccess
  readonly jobs: MarketJob[]
}

/** The existing monthly subscription meter remains distinct from points. */
export interface PlanSummary {
  readonly plan?: { readonly name: string }
  readonly cycle: { readonly startsAt: string; readonly endsAt: string }
  readonly quota: { readonly percentUsed: number }
}

/** Narrow identity required to scope unresolved browser operations. */
export interface ProductIdentity {
  readonly user: { readonly id: string; readonly teamId?: string }
  readonly permissions: string[]
}

/** Account-scoped requests used by native workbench components. */
export const workbenchProducts = {
  market: (): Promise<MarketSnapshot> => request('/product/market', { query: { view: 'catalog' } }),
  summary: (): Promise<{ access: PlanAccess }> => request('/product/summary'),
  billing: (): Promise<PlanSummary> => request('/billing'),
  identity: (): Promise<ProductIdentity> => request('/session'),
  purchase: (agentId: string, key: string): Promise<unknown> => request('/product/purchase', { method: 'POST', body: { agentId, key } }),
  run: (agentId: string, input: string, key: string): Promise<MarketJob> => request('/product/jobs', { method: 'POST', body: { agentId, input, key } }),
  job: (jobId: string): Promise<MarketJob> => request(`/product/jobs/${encodeURIComponent(jobId)}`),
  download: (jobId: string): string => enterpriseApiPath(`/product/jobs/${encodeURIComponent(jobId)}/download`),
}

/**
 * Retain a request identity until its outcome is known, without persisting user materials.
 * @param owner - verified member.
 * @param action - purchase or execution.
 * @param payload - fields identifying the operation.
 * @returns retry identity and settlement callback.
 */
export async function marketTransaction(owner: ProductIdentity['user'], action: 'purchase' | 'run', payload: unknown): Promise<{ key: string; complete: () => void }> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(payload)))
  const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
  const storageKey = `zhiliu.product.${owner.teamId ?? ''}:${owner.id}:${action}.${hash}`
  let key = sessionStorage.getItem(storageKey)
  if (key === null) { key = randomUUID(); sessionStorage.setItem(storageKey, key) }
  return { key, complete: () => { sessionStorage.removeItem(storageKey) } }
}
