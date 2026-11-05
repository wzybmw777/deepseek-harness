import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from './api.ts'
import { useAuth } from './auth.tsx'
import { navigate, queryValue, useLocation } from './router.tsx'
import type { TeamStatus } from './types.ts'

const STORAGE_KEY = 'enterprise.resourceTeamId'

export interface ResourceTeamOption {
  id: string
  name: string
  slug: string
  status: TeamStatus
}

export interface ResourceTeamState {
  teams: ResourceTeamOption[]
  teamId?: string
  team?: ResourceTeamOption
  loading: boolean
  canSwitch: boolean
  selectTeam: (teamId: string) => void
}

/**
 * Pick a valid resource team, preferring the URL, then the last selection, then the user's own team.
 * @param teams - teams available to the signed-in user.
 * @param requested - team id from the current URL.
 * @param stored - last team id saved in this browser.
 * @param own - the signed-in user's team id.
 * @returns the matching team id, or the first available team.
 */
export function resolveResourceTeamId(
  teams: readonly ResourceTeamOption[],
  requested: string | undefined,
  stored: string | undefined,
  own: string | undefined,
): string | undefined {
  const available = new Set(teams.map(team => team.id))
  for (const candidate of [requested, stored, own]) {
    if (candidate !== undefined && available.has(candidate)) return candidate
  }
  return teams[0]?.id
}

export function useResourceTeam(): ResourceTeamState {
  const { session, can } = useAuth()
  const location = useLocation()
  const canSwitch = can('teams.read')
  const ownTeam = useMemo<ResourceTeamOption | undefined>(() => session?.runtime.tenant === undefined ? undefined : ({
    id: session.runtime.tenant.id,
    name: session.runtime.tenant.name,
    slug: session.runtime.tenant.slug,
    status: 'active',
  }), [session?.runtime.tenant])
  const [remoteTeams, setRemoteTeams] = useState<ResourceTeamOption[] | null>(null)
  const [teamId, setTeamId] = useState<string | undefined>(() => canSwitch ? undefined : ownTeam?.id)

  useEffect(() => {
    if (!canSwitch) {
      setRemoteTeams(null)
      return
    }
    let active = true
    void api.teams()
      .then((teams) => {
        if (active) setRemoteTeams(teams.map(team => ({ id: team.id, name: team.name, slug: team.slug, status: team.status })))
      })
      .catch(() => {
        if (active) setRemoteTeams(ownTeam === undefined ? [] : [ownTeam])
      })
    return () => { active = false }
  }, [canSwitch, ownTeam])

  const teams = canSwitch ? remoteTeams ?? [] : ownTeam === undefined ? [] : [ownTeam]
  const ready = !canSwitch || remoteTeams !== null

  useEffect(() => {
    if (!ready) return
    const next = resolveResourceTeamId(
      teams,
      queryValue(location.search, 'team'),
      window.localStorage.getItem(STORAGE_KEY) ?? undefined,
      ownTeam?.id,
    )
    setTeamId(current => current === next ? current : next)
  }, [location.search, ownTeam?.id, ready, teams])

  const selectTeam = useCallback((next: string): void => {
    setTeamId(next)
    window.localStorage.setItem(STORAGE_KEY, next)
    const params = new URLSearchParams(location.search)
    params.set('team', next)
    navigate(`${location.pathname}?${params.toString()}`, { replace: true })
  }, [location.pathname, location.search])

  const team = teams.find(candidate => candidate.id === teamId)
  return {
    teams,
    ...(teamId === undefined ? {} : { teamId }),
    ...(team === undefined ? {} : { team }),
    loading: !ready,
    canSwitch,
    selectTeam,
  }
}
