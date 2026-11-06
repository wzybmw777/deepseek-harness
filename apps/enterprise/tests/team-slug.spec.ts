import { describe, expect, it } from 'vitest'
import { deriveTeamSlug, normalizeTeamSlugInput, teamSlugError } from '../src/lib/team-slug.ts'

describe('team slugs', () => {
  it('derives a URL-safe slug from a Latin team name', () => {
    expect(deriveTeamSlug('  Acme  Team  ')).toBe('acme-team')
    expect(deriveTeamSlug('Café Ops')).toBe('cafe-ops')
    expect(deriveTeamSlug('1')).toBe('1')
  })

  it('leaves non-Latin names for the administrator to complete', () => {
    expect(deriveTeamSlug('测试团队')).toBe('')
  })

  it('keeps typed characters visible while normalizing case and whitespace', () => {
    expect(normalizeTeamSlugInput('ACME Team')).toBe('acme-team')
    expect(normalizeTeamSlugInput('测试')).toBe('测试')
  })

  it('reports invalid slugs without treating an empty field as a format error', () => {
    expect(teamSlugError('')).toBeUndefined()
    expect(teamSlugError('acme-team-1')).toBeUndefined()
    expect(teamSlugError('Acme')).toContain('小写字母')
    expect(teamSlugError('-acme')).toContain('小写字母')
    expect(teamSlugError('测试')).toContain('小写字母')
  })
})
