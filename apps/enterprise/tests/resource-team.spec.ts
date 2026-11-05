// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { resolveResourceTeamId, type ResourceTeamOption } from '../src/lib/resource-team.ts'

const teams: ResourceTeamOption[] = [
  { id: 'team-a', name: 'Team A', slug: 'team-a', status: 'active' },
  { id: 'team-b', name: 'Team B', slug: 'team-b', status: 'suspended' },
]

describe('resource team selection', () => {
  it('prefers a valid URL team, then the stored team, then the signed-in team', () => {
    expect(resolveResourceTeamId(teams, 'team-b', 'team-a', 'team-a')).toBe('team-b')
    expect(resolveResourceTeamId(teams, 'missing', 'team-b', 'team-a')).toBe('team-b')
    expect(resolveResourceTeamId(teams, undefined, 'missing', 'team-a')).toBe('team-a')
  })

  it('falls back to the first available team when no remembered team is valid', () => {
    expect(resolveResourceTeamId(teams, 'missing', 'missing', 'missing')).toBe('team-a')
    expect(resolveResourceTeamId([], 'team-a', 'team-b', undefined)).toBeUndefined()
  })
})
