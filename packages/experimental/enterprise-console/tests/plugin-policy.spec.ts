import { describe, expect, it } from 'vitest'
import { BUILTIN_PLUGINS } from '../src/plugin-catalog.ts'
import { tenantPluginPolicy } from '../src/plugin-policy.ts'
import type { PluginRecord } from '../src/types.ts'

function plugin(id: string, scope: PluginRecord['scope'], packageName: string): PluginRecord {
  return {
    id,
    scope,
    packageName,
    spec: packageName,
    description: '',
    enabled: true,
    createdAt: '2026-11-02T00:00:00.000Z',
    updatedAt: '2026-11-02T00:00:00.000Z',
  }
}

describe('tenant plugin policy', () => {
  it('ignores enterprise records that shadow owner-managed built-ins', () => {
    const builtin = BUILTIN_PLUGINS[0]
    if (builtin === undefined) throw new Error('test requires at least one built-in plugin')

    const policy = tenantPluginPolicy({ plugins: [plugin('shadow', 'enterprise', builtin.packageName)] }, '/plugins')

    expect(policy.enterprisePlugins).toEqual([])
  })

  it('includes enabled enterprise plugins', () => {
    const policy = tenantPluginPolicy({ plugins: [plugin('custom', 'enterprise', '@acme/dsh-reviewer')] }, '/plugins')

    expect(policy.enterprisePlugins).toEqual([
      { packageName: '@acme/dsh-reviewer', directory: '/plugins/node_modules/@acme/dsh-reviewer' },
    ])
  })
})
