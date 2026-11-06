import { describe, expect, it } from 'vitest'
import { EnterpriseCatalogError, parseEnterpriseDesktopCatalog } from '../src/host/catalog.ts'

function catalog(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    quota: {
      planName: '团队版',
      totalTokens: 5_000_000,
      usedTokens: 1_660,
      remainingTokens: 4_998_340,
      userTokens: 1_500,
      cycleStartsAt: '2026-11-01T00:00:00.000Z',
      cycleEndsAt: '2026-12-01T00:00:00.000Z',
    },
    models: [{
      id: 'model-a',
      name: 'Model A',
      protocol: 'openai-chat',
      gatewayBasePath: '/enterprise/api/desktop/gateway/model-a',
      upstreamModelId: 'upstream-a',
      contextWindow: 64_000,
      capabilities: ['text', 'image'],
    }],
    refreshedAt: '2026-11-04T00:00:00.000Z',
    ...overrides,
  }
}

describe('enterprise Desktop model catalog', () => {
  it('accepts the catalog fields the Host routes consume', () => {
    expect(parseEnterpriseDesktopCatalog(catalog())).toMatchObject({
      quota: { remainingTokens: 4_998_340 },
      models: [{ id: 'model-a', gatewayBasePath: '/enterprise/api/desktop/gateway/model-a' }],
    })
  })

  it('rejects malformed model entries before they reach the LLM registry', () => {
    expect(() => parseEnterpriseDesktopCatalog(catalog({
      models: [{ id: 'model-a', name: '', protocol: 'openai-chat' }],
    }))).toThrow(EnterpriseCatalogError)
  })
})
