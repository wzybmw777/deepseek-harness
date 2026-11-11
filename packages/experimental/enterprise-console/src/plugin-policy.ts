/** Enterprise plugin policy projected into each tenant profile. */

import { mkdir, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { EnterpriseCatalog } from './types.ts'
import { BUILTIN_PLUGINS } from './plugin-catalog.ts'

const PACKAGE_NAME = /^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/u
/** Third-party bundles replaced by the first-party agent catalog. */
const RETIRED_BUNDLES: ReadonlySet<string> = new Set(['@michengai/dsh-agency-agents'])

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
  const stored = new Map(catalog.plugins.map(plugin => [plugin.packageName, plugin.enabled]))
  const builtinNames = new Set(BUILTIN_PLUGINS.map(plugin => plugin.packageName))
  return {
    managedBuiltins: [...builtinNames],
    enabledBuiltins: BUILTIN_PLUGINS
      .filter(plugin => stored.get(plugin.packageName) ?? plugin.defaultEnabled ?? false)
      .map(plugin => plugin.packageName),
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
 * Drop loader rows that mount a retired bundle. Profiles written by earlier
 * releases keep the row after its package disappears, which otherwise leaves a
 * dangling entry the loader has to skip.
 */
async function retireProfilePatch(profileDir: string): Promise<void> {
  const path = join(profileDir, 'cordis.patch.yml')
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    throw error
  }
  const lines = text.split('\n')
  const kept: string[] = []
  let index = 0
  while (index < lines.length) {
    const current = lines[index] ?? ''
    if (!current.startsWith('- ')) {
      kept.push(current)
      index += 1
      continue
    }
    let end = index + 1
    while (end < lines.length && !(lines[end] ?? '').startsWith('- ')) end += 1
    const retired = lines.slice(index, end).some((row) => {
      const match = /^ {2}name:\s*(.*)$/u.exec(row)
      if (match === null) return false
      return RETIRED_BUNDLES.has((match[1] ?? '').trim().replace(/^(["'])(.*)\1$/u, '$2'))
    })
    if (!retired) kept.push(...lines.slice(index, end))
    index = end
  }
  const next = kept.join('\n')
  if (next !== text) await writeFile(path, next, { mode: 0o600 })
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
    if (!previousNames.has(name) && !RETIRED_BUNDLES.has(name)) dependencies[name] = version
  }

  const nodeModules = join(profileDir, 'node_modules')
  for (const name of previousNames) await rm(join(nodeModules, name), { force: true })
  for (const name of RETIRED_BUNDLES) await rm(join(nodeModules, name), { recursive: true, force: true })
  await retireProfilePatch(profileDir)

  const currentBundles = (manifest.dsh?.profile?.bundles ?? []).filter(name => !RETIRED_BUNDLES.has(name))
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
