/** URL mount selected by the enterprise Vite build. */
export const PUBLIC_PATH_PREFIX = import.meta.env.BASE_URL.replace(/\/enterprise\/$/u, '')

/** Return a deployment-relative path without its public mount. */
export function internalPath(path: string): string {
  return PUBLIC_PATH_PREFIX !== '' && (path === PUBLIC_PATH_PREFIX || path.startsWith(`${PUBLIC_PATH_PREFIX}/`))
    ? path.slice(PUBLIC_PATH_PREFIX.length) || '/' : path
}

/** Mount an origin-relative URL once; preserve absolute and protocol-relative URLs. */
export function publicPath(path: string): string {
  if (!path.startsWith('/') || path.startsWith('//')) return path
  return `${PUBLIC_PATH_PREFIX}${internalPath(path)}`
}
