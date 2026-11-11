/** Paid-plan capabilities that decide which catalog entries a team may unlock. */

import type { PlanRecord } from './types.ts'

/** Effective agent access for one team's plan. */
export interface PlanAgentAccess {
  readonly planCode: string
  readonly planName: string
  /** Distinct agents the team may unlock; null means unlimited. */
  readonly agentLimit: number | null
  /** Whether the expert teams are included. */
  readonly teams: boolean
}

const CAPABILITIES: Readonly<Record<string, { readonly agentLimit: number | null; readonly teams: boolean }>> = {
  team: { agentLimit: 10, teams: false },
  business: { agentLimit: null, teams: false },
  enterprise: { agentLimit: null, teams: true },
}

/**
 * Resolve the shipped plan capability by its stable code.
 * @param plan - the team's assigned plan, if any.
 * @returns effective limits; an unknown plan falls back to the team edition.
 */
export function planAgentAccess(plan: PlanRecord | undefined): PlanAgentAccess {
  const capability = plan === undefined ? undefined : CAPABILITIES[plan.code]
  return {
    planCode: plan?.code ?? 'unknown',
    planName: plan?.name ?? '未分配套餐',
    agentLimit: capability === undefined ? 10 : capability.agentLimit,
    teams: capability === undefined ? false : capability.teams,
  }
}
