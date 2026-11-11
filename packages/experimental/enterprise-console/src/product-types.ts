/** Product records for the curated agent marketplace. */

/** Drawing used for an agent tile; the client owns the actual glyph. */
export type AgentIcon =
  | 'spark' | 'strategy' | 'operations' | 'brand' | 'growth' | 'marketing'
  | 'finance' | 'organization' | 'legal' | 'image' | 'video' | 'document'
  | 'chat' | 'knowledge'

/** Workbench surface: a curated agent, an imported expert persona, or an expert team. */
export type AgentKind = 'agent' | 'expert' | 'team'

/** One administrator-owned agent revision; prompts never appear in public views. */
export interface AgentProduct {
  readonly id: string
  readonly title: string
  readonly description: string
  readonly alias: string
  readonly kind: AgentKind
  readonly members: readonly string[]
  readonly group: string
  readonly category: string
  readonly icon: AgentIcon
  readonly tasks: string
  readonly materials: string
  readonly deliverables: string
  readonly example: string
  readonly disclaimer: string
  readonly sortOrder: number
  readonly recommended: boolean
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

/** One team member shown with a public team card. */
export interface AgentTeamMember {
  readonly id: string
  readonly title: string
}

/** Agent configuration with the caller's entitlement and no administrative content. */
export interface PublicAgent {
  readonly id: string
  readonly title: string
  readonly description: string
  readonly alias: string
  readonly group: string
  readonly category: string
  readonly icon: AgentIcon
  readonly tasks: string
  readonly materials: string
  readonly deliverables: string
  readonly example: string
  readonly disclaimer: string
  readonly sortOrder: number
  readonly recommended: boolean
  readonly output: AgentProduct['output']
  readonly kind: AgentProduct['kind']
  readonly members: readonly AgentTeamMember[]
  readonly teamUnlocked: boolean
  readonly entitlement: AgentEntitlement | null
}
