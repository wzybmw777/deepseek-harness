import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { Icon } from '../components/Icon.tsx'
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorPanel,
  Field,
  FormGrid,
  IconButton,
  Input,
  Modal,
  PageHeader,
  PageLoader,
  SearchField,
  Select,
  StatusBadge,
  TableFrame,
  Textarea,
} from '../components/ui.tsx'
import { useToast } from '../components/Toast.tsx'
import { api } from '../lib/api.ts'
import { useAuth } from '../lib/auth.tsx'
import { formatDate, formatNumber } from '../lib/format.ts'
import { deriveTeamSlug, normalizeTeamSlugInput, teamSlugError } from '../lib/team-slug.ts'
import type { Plan, Team } from '../lib/types.ts'

interface TeamFormState {
  name: string
  slug: string
  planId: string
  seatLimit: number
  status: 'active' | 'suspended'
  notes: string
}

const EMPTY_FORM: TeamFormState = {
  name: '',
  slug: '',
  planId: 'plan-starter',
  seatLimit: 10,
  status: 'active',
  notes: '',
}

export function TeamsPage(): ReactNode {
  const { can } = useAuth()
  const { notify } = useToast()
  const canWrite = can('teams.write')
  const [teams, setTeams] = useState<Team[]>([])
  const [plans, setPlans] = useState<Plan[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<Team | null>(null)
  const [form, setForm] = useState<TeamFormState>(EMPTY_FORM)
  const [slugTouched, setSlugTouched] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const load = (): void => {
    setLoading(true)
    setError(null)
    void Promise.all([api.teams(), api.plans()]).then(([teamList, planList]) => {
      setTeams(teamList)
      setPlans(planList)
    }).catch((caught: unknown) => {
      setError(caught instanceof Error ? caught.message : '无法读取团队数据')
    }).finally(() => { setLoading(false) })
  }

  useEffect(load, [])

  const openCreate = (): void => {
    setEditing(null)
    setForm({ ...EMPTY_FORM, planId: plans[0]?.id ?? '', seatLimit: plans[0]?.seatLimit ?? 10 })
    setSlugTouched(false)
    setFormError(null)
    setModalOpen(true)
  }

  const openEdit = (team: Team): void => {
    setEditing(team)
    setForm({ name: team.name, slug: team.slug, planId: team.planId, seatLimit: team.seatLimit, status: team.status, notes: team.notes })
    setSlugTouched(true)
    setFormError(null)
    setModalOpen(true)
  }

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    if (submitting) return
    if (teamSlugError(form.slug.trim()) !== undefined) return
    setSubmitting(true)
    setFormError(null)
    try {
      const input = { ...form, name: form.name.trim(), slug: form.slug.trim(), notes: form.notes.trim() }
      if (editing === null) await api.createTeam(input)
      else await api.updateTeam(editing.id, input)
      setModalOpen(false)
      notify(editing === null ? '团队已创建' : '团队已更新', 'success')
      load()
    } catch (caught) {
      setFormError(caught instanceof Error ? caught.message : '保存团队失败')
    } finally {
      setSubmitting(false)
    }
  }

  const remove = async (team: Team): Promise<void> => {
    if (!window.confirm(`确认删除团队「${team.name}」？`)) return
    try {
      await api.deleteTeam(team.id)
      notify('团队已删除', 'success')
      load()
    } catch (caught) {
      notify(caught instanceof Error ? caught.message : '删除团队失败', 'error')
    }
  }

  const filtered = teams.filter((team) => {
    const term = search.trim().toLowerCase()
    return term === '' || team.name.toLowerCase().includes(term) || team.slug.includes(term)
  })

  if (loading) return <PageLoader label="正在加载团队与席位…" />
  if (error !== null) return <ErrorPanel message={error} onRetry={load} />

  const currentSlugError = teamSlugError(form.slug.trim())

  return (
    <div className="admin-page">
      <PageHeader
        description="按企业团队分配套餐、席位和运行空间。"
        group="组织与权限"
        title="团队管理"
        actions={canWrite ? <Button icon="plus" onClick={openCreate} variant="primary">新建团队</Button> : undefined}
      />
      <Card className="table-card" padded={false}>
        <div className="table-toolbar">
          <SearchField onChange={setSearch} placeholder="搜索团队名称或标识" value={search} />
          <span className="table-count">{filtered.length} 个团队</span>
        </div>
        <TableFrame>
          {filtered.length === 0 ? (
            <EmptyState icon="teams" title="暂无团队" description="创建团队后即可分配套餐、成员与席位。" action={canWrite ? <Button icon="plus" onClick={openCreate} size="small" variant="primary">新建团队</Button> : undefined} />
          ) : (
            <div className="table-scroll">
              <table className="data-table">
                <thead><tr><th>团队</th><th>套餐</th><th>席位使用</th><th>状态</th><th>创建时间</th><th aria-label="操作" /></tr></thead>
                <tbody>
                  {filtered.map((team) => {
                    const ratio = Math.min(100, Math.round((team.memberCount / Math.max(1, team.seatLimit)) * 100))
                    return (
                      <tr key={team.id}>
                        <td><div className="team-cell"><span className="team-avatar">{team.name.slice(0, 1)}</span><div><strong>{team.name}</strong><span>/{team.slug}</span></div></div></td>
                        <td><Badge tone="info">{team.planName}</Badge></td>
                        <td><div className="capacity-cell"><div><span>{formatNumber(team.memberCount)} / {formatNumber(team.seatLimit)}</span><small>{ratio}%</small></div><div className="progress-track"><span className={ratio > 85 ? 'is-warning' : ''} style={{ width: `${String(ratio)}%` }} /></div></div></td>
                        <td><StatusBadge status={team.status} /></td>
                        <td><span className="cell-secondary">{formatDate(team.createdAt, false)}</span></td>
                        <td>{canWrite ? <div className="row-actions"><IconButton icon="edit" label="编辑团队" onClick={() => { openEdit(team) }} /><IconButton className="is-danger" icon="trash" label="删除团队" onClick={() => { void remove(team) }} /></div> : <span className="muted">只读</span>}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </TableFrame>
      </Card>

      <Modal
        description="团队标识用于内部路由与账单对账，只能使用小写字母、数字和连字符。"
        footer={<><Button onClick={() => { setModalOpen(false) }}>取消</Button><Button disabled={currentSlugError !== undefined} form="team-form" loading={submitting} type="submit" variant="primary">保存团队</Button></>}
        onClose={() => { setModalOpen(false) }}
        open={modalOpen}
        title={editing === null ? '新建企业团队' : '编辑团队'}
      >
        <form id="team-form" onSubmit={(event) => { void submit(event) }}>
          {formError === null ? null : <div className="form-error" role="alert"><Icon name="alert" size={15} />{formError}</div>}
          <FormGrid>
            <Field htmlFor="team-name" label="团队名称">
              <Input
                id="team-name"
                onChange={(event) => {
                  const name = event.target.value
                  setForm(current => ({ ...current, name, ...(slugTouched ? {} : { slug: deriveTeamSlug(name) }) }))
                }}
                required
                value={form.name}
              />
            </Field>
            <Field {...(currentSlugError === undefined ? {} : { error: currentSlugError })} hint="用于工作台访问地址，例如 acme-team" htmlFor="team-slug" label="团队标识">
              <Input
                aria-invalid={currentSlugError === undefined ? undefined : true}
                autoCapitalize="none"
                autoCorrect="off"
                id="team-slug"
                maxLength={80}
                onBlur={() => { setForm(current => ({ ...current, slug: current.slug.trim() })) }}
                onChange={(event) => {
                  const slug = normalizeTeamSlugInput(event.target.value)
                  setSlugTouched(slug !== '')
                  setForm(current => ({ ...current, slug }))
                }}
                required
                spellCheck={false}
                value={form.slug}
              />
            </Field>
            <Field htmlFor="team-plan" label="套餐">
              <Select id="team-plan" onChange={(event) => {
                const plan = plans.find(item => item.id === event.target.value)
                setForm(current => ({ ...current, planId: event.target.value, seatLimit: plan?.seatLimit ?? current.seatLimit }))
              }} value={form.planId}>
                {plans.map(plan => <option key={plan.id} value={plan.id}>{plan.name}</option>)}
              </Select>
            </Field>
            <Field htmlFor="team-seats" label="席位数"><Input id="team-seats" min={1} onChange={(event) => { setForm(current => ({ ...current, seatLimit: Number(event.target.value) })) }} required type="number" value={form.seatLimit} /></Field>
            <Field htmlFor="team-status" label="团队状态">
              <Select id="team-status" onChange={(event) => { setForm(current => ({ ...current, status: event.target.value as TeamFormState['status'] })) }} value={form.status}>
                <option value="active">正常</option>
                <option value="suspended">暂停</option>
              </Select>
            </Field>
            <Field className="field-span-2" htmlFor="team-notes" label="备注"><Textarea id="team-notes" onChange={(event) => { setForm(current => ({ ...current, notes: event.target.value })) }} rows={3} value={form.notes} /></Field>
          </FormGrid>
        </form>
      </Modal>
    </div>
  )
}
