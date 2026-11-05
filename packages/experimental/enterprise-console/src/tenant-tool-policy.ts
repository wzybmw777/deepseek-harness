/** Enterprise tenant policy for agent-facing tool management. */

import type { Context } from '@deepseek-ai/cordis'
import type { ToolExecution } from '@deepseek-ai/dsh-tools'

/** Cordis plugin name used by tenant loader diagnostics. */
export const name = 'enterprise-tenant-tool-policy'

/** The tool registry required before the policy can register its guard. */
export const inject = ['tools']

/** The profile-management capability reserved for the enterprise console. */
const PLUGIN_MANAGEMENT_TOOL = 'plugin_manager'

/** Model-facing refusal for tenant plugin management attempts. */
const DENIAL = 'Plugin management is available only in the enterprise console.'

/** The part of a tenant context this policy needs. */
export interface TenantToolPolicyContext {
  /** Tool registry receiving the monotonic guard. */
  readonly tools: Pick<Context['tools'], 'guard'>
}

/**
 * Refuse agent-side profile management in an enterprise tenant.
 * @param execution - tool execution presented to the guard.
 * @returns the denial reason for plugin management, otherwise undefined.
 */
export function denyPluginManagement(execution: Pick<ToolExecution, 'name'>): string | undefined {
  return execution.name === PLUGIN_MANAGEMENT_TOOL ? DENIAL : undefined
}

/**
 * Register the tenant's monotonic tool guard.
 * @param ctx - tenant plugin context carrying the tool registry.
 */
export function apply(ctx: TenantToolPolicyContext): void {
  ctx.tools.guard(denyPluginManagement)
}
