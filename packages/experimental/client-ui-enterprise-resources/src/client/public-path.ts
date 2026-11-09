/** Locate enterprise API requests beside the current tenant mount. */

/**
 * Resolve one enterprise endpoint under the tenant's deployment prefix.
 * @param path - API suffix beginning with a slash.
 * @returns same-origin endpoint; pages outside a tenant mount use the root deployment.
 */
export function enterpriseApiPath(path: string): string {
  const prefix = /^(.*?)\/t\/[a-z0-9][a-z0-9-]*\/harness(?:\/|$)/u.exec(window.location.pathname)?.[1] ?? ''
  return `${prefix}/enterprise/api${path}`
}

/** Resolve a console page beside the current tenant mount. @param path - enterprise-relative page. @returns same-origin page URL. */
export function enterprisePagePath(path: string): string {
  const prefix = /^(.*?)\/t\/[a-z0-9][a-z0-9-]*\/harness(?:\/|$)/u.exec(window.location.pathname)?.[1] ?? ''
  return `${prefix}/enterprise${path}`
}
