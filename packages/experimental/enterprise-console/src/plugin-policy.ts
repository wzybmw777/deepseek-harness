/** Enterprise plugin policy projected into each tenant profile. */

import { mkdir, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { EnterpriseCatalog } from './types.ts'
import { BUILTIN_PLUGINS } from './plugin-catalog.ts'

const PACKAGE_NAME = /^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/u

/** One enterprise plugin package resolved from the shared read-only plugin root. */
export interface TenantPluginPackage {
  readonly packageName: string
  readonly directory: string
}

/** Plugin layers that every tenant profile must load before its container starts. */
export interface TenantPluginPolicy {
  readonly managedBuiltins: readonly string[]
  readonly enabledBuiltins: readonly string[]
  readonly enterprisePlugins: readonly TenantPluginPackage[]
}

interface ProfileManifest {
  dependencies?: Record<string, string>
  dsh?: {
    profile?: { bundles?: string[] }
    enterprisePlugins?: string[]
    [key: string]: unknown
  }
  [key: string]: unknown
}

/** Build the tenant policy from durable records and the shared plugin installation. */
export function tenantPluginPolicy(catalog: Pick<EnterpriseCatalog, 'plugins'>, pluginRoot: string): TenantPluginPolicy {
  const enabled = new Set(catalog.plugins.filter(plugin => plugin.enabled).map(plugin => plugin.packageName))
  const builtinNames = new Set(BUILTIN_PLUGINS.map(plugin => plugin.packageName))
  return {
    managedBuiltins: [...builtinNames],
    enabledBuiltins: BUILTIN_PLUGINS.filter(plugin => enabled.has(plugin.packageName)).map(plugin => plugin.packageName),
    enterprisePlugins: catalog.plugins
      .filter(plugin => plugin.scope === 'enterprise' && plugin.enabled && !builtinNames.has(plugin.packageName))
      .map(plugin => ({ packageName: plugin.packageName, directory: join(pluginRoot, 'node_modules', plugin.packageName) })),
  }
}

function packageName(value: string): string {
  if (!PACKAGE_NAME.test(value)) throw new Error(`enterprise plugin policy: invalid package name ${JSON.stringify(value)}`)
  return value
}

async function writeManifest(path: string, manifest: ProfileManifest): Promise<void> {
  const temporary = `${path}.enterprise-tmp`
  await writeFile(temporary, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 })
  await rename(temporary, path)
}

/**
 * Replace the enterprise-owned layers in one tenant profile while leaving its
 * other selected bundles and dependencies intact.
 * @param profileDir - writable profile directory inside the tenant home.
 * @param policy - enabled built-in and enterprise plugin layers.
 */
export async function applyTenantPluginPolicy(profileDir: string, policy: TenantPluginPolicy): Promise<void> {
  const manifestPath = join(profileDir, 'package.json')
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as ProfileManifest
  const previousNames = new Set((manifest.dsh?.enterprisePlugins ?? []).map(packageName))
  const dependencies: Record<string, string> = {}
  for (const [name, version] of Object.entries(manifest.dependencies ?? {})) {
    if (!previousNames.has(name)) dependencies[name] = version
  }

  const nodeModules = join(profileDir, 'node_modules')
  for (const name of previousNames) await rm(join(nodeModules, name), { force: true })

  const currentBundles = manifest.dsh?.profile?.bundles ?? []
  const managedBuiltins = new Set(policy.managedBuiltins)
  const enterpriseNames: string[] = []
  for (const plugin of policy.enterprisePlugins) {
    const name = packageName(plugin.packageName)
    const link = join(nodeModules, name)
    await mkdir(dirname(link), { recursive: true, mode: 0o700 })
    await rm(link, { force: true })
    await symlink(plugin.directory, link, 'dir')
    dependencies[name] = `file:${plugin.directory}`
    enterpriseNames.push(name)
  }

  const bundles = [
    ...currentBundles.filter(name => !managedBuiltins.has(name) && !enterpriseNames.includes(name)),
    ...policy.enabledBuiltins,
    ...enterpriseNames,
  ]
  await writeManifest(manifestPath, {
    ...manifest,
    dependencies,
    dsh: {
      ...manifest.dsh,
      profile: { ...manifest.dsh?.profile, bundles },
      enterprisePlugins: enterpriseNames,
    },
  })
}
