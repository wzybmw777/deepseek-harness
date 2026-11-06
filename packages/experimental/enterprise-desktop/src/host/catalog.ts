/** Fetch and validate the Desktop model catalog from the pinned enterprise cloud. */

import type { EnterpriseCloudTransport } from './cloud-transport.ts'
import type { EnterpriseDesktopCatalog, EnterpriseDesktopModel, EnterpriseDesktopQuota } from './model-route.ts'

/** Cloud path that returns the current model routes and team allowance. */
export const ENTERPRISE_MODELS_PATH = '/enterprise/api/desktop/models'

/** Invalid model catalog returned by the enterprise cloud. */
export class EnterpriseCatalogError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'EnterpriseCatalogError'
  }
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new EnterpriseCatalogError('enterprise model catalog must be an object')
  }
  return value as Record<string, unknown>
}

function text(value: Record<string, unknown>, field: string, maximum: number): string {
  const candidate = value[field]
  if (typeof candidate !== 'string' || candidate === '' || candidate.length > maximum) {
    throw new EnterpriseCatalogError(`enterprise model catalog field "${field}" is invalid`)
  }
  return candidate
}

function count(value: Record<string, unknown>, field: string): number {
  const candidate = value[field]
  if (typeof candidate !== 'number' || !Number.isSafeInteger(candidate) || candidate < 0) {
    throw new EnterpriseCatalogError(`enterprise model catalog field "${field}" is invalid`)
  }
  return candidate
}

function timestamp(value: Record<string, unknown>, field: string): string {
  const candidate = text(value, field, 64)
  if (!Number.isFinite(Date.parse(candidate))) {
    throw new EnterpriseCatalogError(`enterprise model catalog field "${field}" is invalid`)
  }
  return candidate
}

function quota(value: unknown): EnterpriseDesktopQuota {
  const candidate = record(value)
  return {
    planName: text(candidate, 'planName', 120),
    totalTokens: count(candidate, 'totalTokens'),
    usedTokens: count(candidate, 'usedTokens'),
    remainingTokens: count(candidate, 'remainingTokens'),
    userTokens: count(candidate, 'userTokens'),
    cycleStartsAt: timestamp(candidate, 'cycleStartsAt'),
    cycleEndsAt: timestamp(candidate, 'cycleEndsAt'),
  }
}

function model(value: unknown): EnterpriseDesktopModel {
  const candidate = record(value)
  const capabilities = candidate.capabilities
  if (!Array.isArray(capabilities) || capabilities.some(item => typeof item !== 'string' || item === '')) {
    throw new EnterpriseCatalogError('enterprise model capabilities are invalid')
  }
  return {
    id: text(candidate, 'id', 200),
    name: text(candidate, 'name', 200),
    protocol: text(candidate, 'protocol', 80),
    gatewayBasePath: text(candidate, 'gatewayBasePath', 2048),
    upstreamModelId: text(candidate, 'upstreamModelId', 200),
    contextWindow: count(candidate, 'contextWindow'),
    capabilities: [...capabilities],
  }
}

/**
 * Validate the cloud catalog before it reaches the LLM registry or a local route.
 * @param value - decoded JSON from the Desktop models endpoint.
 * @returns the validated catalog.
 */
export function parseEnterpriseDesktopCatalog(value: unknown): EnterpriseDesktopCatalog {
  const candidate = record(value)
  const models = candidate.models
  if (!Array.isArray(models)) throw new EnterpriseCatalogError('enterprise model catalog models must be an array')
  return {
    quota: quota(candidate.quota),
    models: models.map(model),
    refreshedAt: timestamp(candidate, 'refreshedAt'),
  }
}

/**
 * Read the model catalog through the bearer-authenticated cloud transport.
 * @param transport - same-origin transport that supplies the short-lived access token.
 * @returns the validated catalog.
 */
export async function fetchEnterpriseDesktopCatalog(transport: EnterpriseCloudTransport): Promise<EnterpriseDesktopCatalog> {
  const response = await transport.request({
    path: ENTERPRISE_MODELS_PATH,
    method: 'GET',
    headers: { accept: 'application/json' },
  })
  if (!response.ok) {
    let code = ''
    try {
      const failure = record(await response.json())
      const error = failure.error
      if (typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string') {
        code = ` (${error.code.slice(0, 80)})`
      }
    } catch {
      // The status still identifies the failure when the body is not JSON.
    }
    throw new EnterpriseCatalogError(`enterprise model catalog request failed with ${String(response.status)}${code}`)
  }
  let body: unknown
  try {
    body = await response.json()
  } catch (error) {
    throw new EnterpriseCatalogError('enterprise model catalog response is not JSON', { cause: error })
  }
  return parseEnterpriseDesktopCatalog(body)
}
