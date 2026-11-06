import type { ReactNode } from 'react'
import type { ResourceTeamOption } from '../lib/resource-team.ts'
import { Icon } from './Icon.tsx'
import { Select } from './ui.tsx'

export function ResourceTeamPicker({ teams, value, onChange }: {
  teams: readonly ResourceTeamOption[]
  value: string
  onChange: (teamId: string) => void
}): ReactNode {
  if (teams.length < 2 || value === '') return null
  return (
    <label className="resource-team-picker">
      <Icon name="teams" size={15} />
      <span className="sr-only">选择团队</span>
      <Select
        aria-label="选择团队"
        className="resource-team-select"
        onChange={(event) => { onChange(event.target.value) }}
        value={value}
      >
        {teams.map(team => <option key={team.id} value={team.id}>{team.name}</option>)}
      </Select>
    </label>
  )
}
