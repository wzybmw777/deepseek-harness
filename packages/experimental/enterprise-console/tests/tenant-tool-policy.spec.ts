import { describe, expect, it } from 'vitest'
import {
  apply,
  denyPluginManagement,
  inject,
  name,
  type TenantToolPolicyContext,
} from '../src/tenant-tool-policy.ts'

describe('enterprise tenant tool policy', () => {
  it('identifies the tenant policy plugin', () => {
    expect(name).toBe('enterprise-tenant-tool-policy')
    expect(inject).toEqual(['tools'])
  })

  it('denies only the agent-facing plugin management tool', () => {
    expect(denyPluginManagement({ name: 'plugin_manager' })).toBe(
      'Plugin management is available only in the enterprise console.',
    )
    expect(denyPluginManagement({ name: 'bash' })).toBeUndefined()
  })

  it('registers the guard through the tenant tool registry', () => {
    const guards: Parameters<TenantToolPolicyContext['tools']['guard']>[0][] = []
    const disposer = (): void => {}
    apply({
      tools: {
        guard(guard) {
          guards.push(guard)
          return disposer
        },
      },
    })
    expect(guards).toEqual([denyPluginManagement])
  })
})
