/** Deployment-provided remote Browser endpoint embedded before the Client boots. */

/** Global bootstrap written by an enterprise shell. */
export interface RemoteBrowserBootstrap {
  /** Absolute same-origin API prefix, without a trailing slash. */
  readonly endpoint: string
}

/**
 * Read the optional remote browser endpoint.
 * @returns a validated absolute path, or undefined when this deployment keeps Web iframe navigation.
 */
export function browserRemoteEndpoint(): string | undefined {
  const value = (globalThis as { readonly __DSH_SIDEBAR_BROWSER_REMOTE__?: unknown }).__DSH_SIDEBAR_BROWSER_REMOTE__
  if (typeof value !== 'object' || value === null || !('endpoint' in value)) return undefined
  const endpoint = (value as { readonly endpoint?: unknown }).endpoint
  if (typeof endpoint !== 'string' || !endpoint.startsWith('/') || endpoint.startsWith('//')
    || endpoint.length > 512 || /[\s?#]/u.test(endpoint)) return undefined
  const normalized = endpoint.replace(/\/+$/u, '')
  return normalized === '' ? undefined : normalized
}
