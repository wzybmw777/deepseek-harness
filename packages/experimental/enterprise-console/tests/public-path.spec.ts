import { describe, expect, it } from 'vitest'
import { resolvePublicPathPrefix } from '../src/public-path.ts'

describe('enterprise public path prefix', () => {
  it.each(['', '/preview', '/branch/ui-v2'])('accepts a root mount or path segments: %s', (value) => {
    expect(resolvePublicPathPrefix(value)).toBe(value)
  })
  it.each(['/', '//host', '/preview/', '/..', '/a/../b', '/a?b', '/a#b', '/a\\b'])('rejects ambiguous mounts: %s', (value) => {
    expect(() => resolvePublicPathPrefix(value)).toThrow('publicPathPrefix')
  })
})
