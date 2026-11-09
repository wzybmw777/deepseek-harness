/** Product records for the points wallet and curated agent marketplace. */

/** One administrator-owned agent revision; prompts never appear in public views. */
export interface AgentProduct {
  readonly id: string
  readonly title: string
  readonly description: string
  readonly category: string
  readonly output: 'pptx' | 'text' | 'video'
  readonly executor: 'ppt-master' | 'text' | 'video'
  readonly price: number
  readonly durationDays: number | null
  readonly published: boolean
  readonly modelId: string
  readonly systemPrompt: string
  readonly skill: string
  readonly revision: number
}

/** Per-member spending policy; no implicit team wallet or entitlement sharing. */
export interface PointsWallet {
  readonly teamId: string
  readonly userId: string
  readonly balance: number
  readonly reserved: number
  readonly canPurchase: boolean
  readonly canRun: boolean
}

/** Runtime rates in points per million provider-reported tokens. */
export interface PointsRates {
  readonly input: number
  readonly output: number
}

/** Current purchased or explicitly assigned right to invoke an agent. */
export interface AgentEntitlement {
  readonly agentId: string
  readonly expiresAt: string | null
  readonly active: boolean
}

/** Durable task progress and artifact metadata, excluding prompts and provider details. */
export interface AgentJob {
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

/** Agent configuration with the caller's entitlement and no administrative content. */
export interface PublicAgent {
  readonly id: string
  readonly title: string
  readonly description: string
  readonly category: string
  readonly output: AgentProduct['output']
  readonly price: number
  readonly durationDays: number | null
  readonly entitlement: AgentEntitlement | null
}
