import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
/** Workbench market operations share the authenticated enterprise transport. */
import { request } from './api.ts'
import { enterpriseApiPath } from './public-path.ts'

/** Public agent metadata; administrative prompts stay on the server. */
export interface MarketAgent {
  readonly id: string
  readonly title: string
  readonly description: string
  readonly category: string
  readonly output: 'pptx' | 'text' | 'video'
  readonly price: number
  readonly durationDays: number | null
  readonly entitlement: { readonly active: boolean; readonly expiresAt: string | null } | null
}

/** Allocated member points, including holds for requests still being settled. */
export interface PointsWallet {
  readonly balance: number
  readonly reserved: number
  readonly canPurchase: boolean
  readonly canRun: boolean
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
  readonly charged: number
  readonly createdAt: string
}

/** Read model used inside the workbench, excluding its administrative ledger. */
export interface MarketSnapshot {
  readonly agents: MarketAgent[]
  readonly wallet: PointsWallet
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

/** Restricted Feilian binding and the libraries currently accessible to the member. */
export interface FeilianStatus {
  readonly available: boolean
  readonly bound: boolean
  readonly account?: string
  readonly state: 'unavailable' | 'unbound' | 'connected' | 'reauth' | 'offline'
  readonly knowledgeBases: readonly { readonly id: string; readonly name: string }[]
  readonly registrationUrl?: string
  readonly enterpriseUrl?: string
}

/** Account-scoped requests used by native workbench components. */
export const workbenchProducts = {
  market: (): Promise<MarketSnapshot> => request('/product/market', { query: { view: 'catalog' } }),
  wallet: (): Promise<{ wallet: PointsWallet }> => request('/product/summary'),
  billing: (): Promise<PlanSummary> => request('/billing'),
  identity: (): Promise<ProductIdentity> => request('/session'),
  purchase: (agentId: string, key: string): Promise<unknown> => request('/product/purchase', { method: 'POST', body: { agentId, key } }),
  run: (agentId: string, input: string, key: string): Promise<MarketJob> => request('/product/jobs', { method: 'POST', body: { agentId, input, key } }),
  job: (jobId: string): Promise<MarketJob> => request(`/product/jobs/${encodeURIComponent(jobId)}`),
  feilian: (): Promise<FeilianStatus> => request('/product/feilian'),
  bindFeilian: (email: string, password: string, tenantSlug: string): Promise<unknown> => request('/product/feilian/bind', { method: 'POST', body: { email, password, tenantSlug } }),
  unbindFeilian: (): Promise<unknown> => request('/product/feilian/unbind', { method: 'POST' }),
  queryFeilian: (knowledgeBaseId: string, question: string): Promise<{ answer: string }> => request('/product/feilian/query', { method: 'POST', body: { knowledgeBaseId, question } }),
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
