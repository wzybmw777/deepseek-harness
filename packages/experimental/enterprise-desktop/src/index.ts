export * from './host/index.ts'

/**
 * Loader entry for the Desktop profile. Route installation needs the catalog and
 * bootstrap service, so the Host app installs them after boot; this row exists
 * to publish the package's browser bundle to the client module graph.
 */
export function apply(): void {}
