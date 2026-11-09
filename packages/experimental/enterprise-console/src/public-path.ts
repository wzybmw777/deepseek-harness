/** Deployment path validation shared by the enterprise gateway and tenant runtime. */

/**
 * Validate an empty root mount or slash-separated URL path segments without a trailing slash.
 * @param value - configured public prefix, such as `/preview`.
 * @returns the validated prefix; an empty string keeps root deployment.
 */
export function resolvePublicPathPrefix(value: string): string {
  if (value !== '' && !/^\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/u.test(value)) {
    throw new Error('enterprise-console: publicPathPrefix must be empty or a slash-separated path without a trailing slash')
  }
  return value
}
