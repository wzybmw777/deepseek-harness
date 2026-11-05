/** Installed application values that select the enterprise Desktop control plane. */

/** Validated enterprise release identity consumed by the Electron shell. */
export interface DesktopEnterpriseRelease {
  readonly cloudOrigin: string
}

function httpsOrigin(value: unknown, field: string): string {
  if (typeof value !== 'string') throw new Error(`desktop enterprise: ${field} is required`)
  const url = new URL(value)
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== '' || url.search !== ''
    || url.hash !== '' || (url.pathname !== '' && url.pathname !== '/')) {
    throw new Error(`desktop enterprise: ${field} must be an HTTPS origin`)
  }
  return url.origin
}

/**
 * Read the sealed enterprise cloud origin, or select development mode from the environment.
 * @param manifest - installed application manifest.
 * @param environment - process environment; ignored for packaged enterprise builds.
 * @param packaged - whether this process is running from an installed application.
 * @returns the enterprise cloud origin, or undefined for a community build.
 */
export function desktopEnterpriseRelease(
  manifest: unknown,
  environment: NodeJS.ProcessEnv,
  packaged: boolean,
): DesktopEnterpriseRelease | undefined {
  if (typeof manifest !== 'object' || manifest === null || Array.isArray(manifest)) {
    throw new Error('desktop enterprise: application manifest is invalid')
  }
  const candidate = manifest as Record<string, unknown>
  if (candidate.dshDesktopBuildFlavor === 'enterprise') {
    return Object.freeze({ cloudOrigin: httpsOrigin(candidate.dshEnterpriseCloudOrigin, 'dshEnterpriseCloudOrigin') })
  }
  if (candidate.dshDesktopBuildFlavor !== undefined && candidate.dshDesktopBuildFlavor !== 'community') {
    throw new Error('desktop enterprise: unsupported build flavor')
  }
  if (packaged) return undefined
  const developmentOrigin = environment.DSH_ENTERPRISE_CLOUD_ORIGIN
  if (developmentOrigin === undefined || developmentOrigin === '') return undefined
  const url = new URL(developmentOrigin)
  if ((url.protocol !== 'https:' && url.protocol !== 'http:') || url.username !== '' || url.password !== ''
    || url.search !== '' || url.hash !== '' || (url.pathname !== '' && url.pathname !== '/')) {
    throw new Error('desktop enterprise: DSH_ENTERPRISE_CLOUD_ORIGIN must be an HTTP(S) origin')
  }
  return Object.freeze({ cloudOrigin: url.origin })
}
