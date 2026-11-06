/** Filesystem ownership for the Electron-managed desktop installation. */

import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'

/** Server and user pair selecting one isolated enterprise Desktop profile. */
export interface DesktopProfileIdentity {
  readonly cloudBaseUrl: string
  readonly userId: string
}

/** Stable desktop installation paths under the shared Harness home. */
export interface DesktopPaths {
  readonly profile: string
  readonly lock: string
}

/**
 * Resolve every Electron-owned path without changing the shared data roots.
 * @param dshHome - Harness home shared with npm-installed dsh.
 * @returns immutable desktop path set.
 */
export function resolveDesktopPaths(dshHome: string = resolveDshHome()): DesktopPaths {
  return {
    profile: join(dshHome, 'profiles', 'desktop'),
    lock: join(dshHome, 'profiles', 'desktop', 'lock'),
  }
}

/**
 * Derive the opaque directory name shared by a cloud origin and user identity.
 * @param identity - enterprise server and user.
 * @returns lowercase SHA-256 over the normalized origin and user id.
 */
export function desktopProfileKey(identity: DesktopProfileIdentity): string {
  const url = new URL(identity.cloudBaseUrl)
  if ((url.protocol !== 'https:' && url.protocol !== 'http:') || url.username !== '' || url.password !== ''
    || url.search !== '' || url.hash !== '' || (url.pathname !== '' && url.pathname !== '/')) {
    throw new Error('desktop profile: cloud base URL must be an HTTP(S) origin')
  }
  if (identity.userId === '') throw new Error('desktop profile: user id must not be empty')
  return createHash('sha256').update(`${url.origin}\n${identity.userId}`, 'utf8').digest('hex')
}

/**
 * Resolve the private profile owned by one enterprise identity.
 * @param identity - enterprise server and user.
 * @param dshHome - Harness home shared with npm-installed dsh.
 * @returns profile and lock paths isolated from community and other enterprise identities.
 */
export function resolveEnterpriseDesktopPaths(
  identity: DesktopProfileIdentity,
  dshHome: string = resolveDshHome(),
): DesktopPaths {
  const profile = join(dshHome, 'profiles', 'enterprise', desktopProfileKey(identity))
  return { profile, lock: join(profile, 'lock') }
}
