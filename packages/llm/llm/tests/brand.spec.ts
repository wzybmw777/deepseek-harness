import { describe, expect, expectTypeOf, it } from 'vitest'
import { LlmRequestId } from '../src/brand.ts'

describe('LLM request identity', () => {
  it('brands a non-empty LLM request identity', () => {
    const value = LlmRequestId('req-a')

    expect(value).toBe('req-a')
    expectTypeOf(value).toEqualTypeOf<LlmRequestId>()
  })

  it('rejects an empty LLM request identity', () => {
    expect(() => LlmRequestId('')).toThrow('LLM request id must not be empty')
  })
})
