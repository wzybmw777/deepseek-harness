import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { BUILTIN_PLUGINS } from '../src/plugin-catalog.ts'
import { applyTenantPluginPolicy, tenantPluginPolicy } from '../src/plugin-policy.ts'
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
      { packageName: '@acme/dsh-reviewer', directory: join('/plugins', 'node_modules', '@acme', 'dsh-reviewer') },
    ])
  })

  it('ships the agent hub enabled until an owner switches it off', () => {
    const shipped = tenantPluginPolicy({ plugins: [] }, '/plugins')
    expect(shipped.enabledBuiltins).toContain('@deepseek-ai/dsh-agent-hub-bundle')
    const record: PluginRecord = { ...plugin('hub', 'builtin', '@deepseek-ai/dsh-agent-hub-bundle'), enabled: false }
    const disabled = tenantPluginPolicy({ plugins: [record] }, '/plugins')
    expect(disabled.enabledBuiltins).not.toContain('@deepseek-ai/dsh-agent-hub-bundle')
  })

  it('retires the third-party expert bundle from a tenant profile', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'zhiliu-profile-'))
    try {
      const profile = join(directory, 'profile')
      await mkdir(join(profile, 'node_modules', '@michengai', 'dsh-agency-agents'), { recursive: true })
      await writeFile(join(profile, 'package.json'), JSON.stringify({
        dependencies: { '@michengai/dsh-agency-agents': '^1.2.21', '@acme/dsh-reviewer': '1.0.0' },
        dsh: { profile: { bundles: ['@michengai/dsh-agency-agents', '@acme/dsh-reviewer'] }, enterprisePlugins: [] },
      }))
      await writeFile(join(profile, 'cordis.patch.yml'), [
        '- id: agency-agents',
        '  name: "@michengai/dsh-agency-agents"',
        '  config:',
        '    enabled: []',
        '- id: ui-theme',
        '  name: "@deepseek-ai/dsh-client-ui-theme"',
        '',
      ].join('\n'))
      await applyTenantPluginPolicy(profile, { managedBuiltins: [], enabledBuiltins: [], enterprisePlugins: [] })
      const manifest = JSON.parse(await readFile(join(profile, 'package.json'), 'utf8')) as {
        dependencies: Record<string, string>
        dsh: { profile: { bundles: string[] } }
      }
      expect(manifest.dependencies).not.toHaveProperty('@michengai/dsh-agency-agents')
      expect(manifest.dependencies['@acme/dsh-reviewer']).toBe('1.0.0')
      expect(manifest.dsh.profile.bundles).toEqual(['@acme/dsh-reviewer'])
      expect(await readFile(join(profile, 'cordis.patch.yml'), 'utf8'))
        .toBe('- id: ui-theme\n  name: "@deepseek-ai/dsh-client-ui-theme"\n')
    } finally { await rm(directory, { recursive: true, force: true }) }
  })
})
