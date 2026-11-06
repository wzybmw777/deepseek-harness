/** Public path grammar shared by the launch API and the tenant gateway. */

/** Browser-facing root for every tenant Harness mount. */
export const TENANT_ROOT = '/t'

const SLUG = /^[a-z0-9][a-z0-9-]*$/u

/** One tenant URL split into its public mount and the prefix-free Harness path. */
export interface TenantRoute {
  /** Validated team slug from the public URL. */
  readonly slug: string
  /** Public Harness mount, always ending in `/`. */
  readonly mount: string
  /** Path the tenant DSH process receives; `/` for the mount root. */
  readonly upstreamPath: string
}

/**
 * Public Harness mount for one team slug.
 * @param slug - validated team slug.
 * @returns the mount with its trailing slash.
 */
export function tenantHarnessPath(slug: string): string {
  if (!SLUG.test(slug)) throw new Error(`enterprise tenant: invalid team slug ${JSON.stringify(slug)}`)
  return `${TENANT_ROOT}/${slug}/harness/`
}

/**
 * Parse a browser-facing tenant path without decoding it.
 * @param pathname - absolute request pathname.
 * @returns the tenant route, or undefined when the path is outside a Harness mount.
 */
export function parseTenantRoute(pathname: string): TenantRoute | undefined {
  const root = `${TENANT_ROOT}/`
  if (!pathname.startsWith(root)) return undefined
  const rest = pathname.slice(root.length)
  const separator = rest.indexOf('/')
  if (separator <= 0) return undefined
  const slug = rest.slice(0, separator)
  const harness = rest.slice(separator)
  if (!SLUG.test(slug) || harness !== '/harness' && !harness.startsWith('/harness/')) return undefined
  const mount = `${root}${slug}/harness/`
  const suffix = pathname.slice(root.length + slug.length + '/harness'.length)
  return {
    slug,
    mount,
    upstreamPath: suffix === '' ? '/' : suffix,
  }
}
