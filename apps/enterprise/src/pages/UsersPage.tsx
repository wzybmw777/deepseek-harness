import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { Icon } from '../components/Icon.tsx'
import {
  Avatar,
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
} from '../components/ui.tsx'
import { useToast } from '../components/Toast.tsx'
import { api } from '../lib/api.ts'
import { useAuth } from '../lib/auth.tsx'
import { formatDate, formatRelative } from '../lib/format.ts'
import type { Role, Team, User } from '../lib/types.ts'

interface UserFormState {
  email: string
  phone: string
  name: string
  roleId: string
  teamId: string
  status: 'active' | 'disabled'
  password: string
}

const EMPTY_FORM: UserFormState = {
  email: '',
  phone: '',
  name: '',
  roleId: 'role-member',
  teamId: '',
  status: 'active',
  password: '',
}

export function UsersPage(): ReactNode {
  const { can, session } = useAuth()
  const { notify } = useToast()
  const isOwner = session?.user.roleId === 'role-owner'
  const isAdministrator = session?.user.roleId === 'role-admin'
  const canWrite = can('users.write') && (isOwner || isAdministrator)
  const [users, setUsers] = useState<User[]>([])
  const [roles, setRoles] = useState<Role[]>([])
  const [teams, setTeams] = useState<Team[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [teamFilter, setTeamFilter] = useState('all')
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<User | null>(null)
  const [form, setForm] = useState<UserFormState>(EMPTY_FORM)
  const [formError, setFormError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [credential, setCredential] = useState<{ email: string; phone?: string; password: string } | null>(null)

  const load = (): void => {
    setLoading(true)
    setError(null)
    void Promise.all([api.users(), api.roles(), api.teams()]).then(([userList, roleList, teamList]) => {
      setUsers(userList)
      setRoles(roleList)
      setTeams(teamList)
    }).catch((caught: unknown) => {
      setError(caught instanceof Error ? caught.message : '无法读取用户数据')
    }).finally(() => { setLoading(false) })
  }

  useEffect(load, [])

  const assignableRoles = roles.filter(role => isOwner || (isAdministrator && role.id === 'role-member'))
  const canManageUser = (user: User): boolean => isOwner
    || (isAdministrator && user.roleId === 'role-member')

  const openCreate = (): void => {
    setEditing(null)
    setForm({ ...EMPTY_FORM, roleId: assignableRoles.find(role => role.id === 'role-member')?.id ?? assignableRoles[0]?.id ?? '', teamId: teams[0]?.id ?? '' })
    setFormError(null)
    setModalOpen(true)
  }

  const openEdit = (user: User): void => {
    setEditing(user)
    setForm({
      email: user.email,
      phone: user.phone ?? '',
      name: user.name,
      roleId: user.roleId,
      teamId: user.teamId ?? '',
      status: user.status,
      password: '',
    })
    setFormError(null)
    setModalOpen(true)
  }

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    if (submitting) return
    setSubmitting(true)
    setFormError(null)
    try {
      if (editing === null) {
        const result = await api.createUser({
          email: form.email,
          ...(form.phone === '' ? {} : { phone: form.phone }),
          name: form.name,
          roleId: form.roleId,
          ...(form.teamId === '' ? {} : { teamId: form.teamId }),
          status: form.status,
          ...(form.password === '' ? {} : { password: form.password }),
        })
        setModalOpen(false)
        if (result.temporaryPassword !== undefined) {
          setCredential({
            email: result.user.email,
            ...(result.user.phone === undefined ? {} : { phone: result.user.phone }),
            password: result.temporaryPassword,
          })
        }
        notify('用户已创建', 'success')
      } else {
        await api.updateUser(editing.id, {
          email: form.email,
          phone: form.phone,
          name: form.name,
          roleId: form.roleId,
          teamId: form.teamId,
          status: form.status,
          ...(form.password === '' ? {} : { password: form.password }),
        })
        setModalOpen(false)
        notify('用户信息已更新', 'success')
      }
      load()
    } catch (caught) {
      setFormError(caught instanceof Error ? caught.message : '保存用户失败')
    } finally {
      setSubmitting(false)
    }
  }

  const toggleStatus = async (user: User): Promise<void> => {
    try {
      await api.updateUser(user.id, { status: user.status === 'active' ? 'disabled' : 'active' })
      notify(user.status === 'active' ? '用户已停用' : '用户已启用', 'success')
      load()
    } catch (caught) {
      notify(caught instanceof Error ? caught.message : '更新状态失败', 'error')
    }
  }

  const remove = async (user: User): Promise<void> => {
    if (!window.confirm(`确认删除用户 ${user.email}？该用户将立即失去访问权限。`)) return
    try {
      await api.deleteUser(user.id)
      notify('用户已删除', 'success')
      load()
    } catch (caught) {
      notify(caught instanceof Error ? caught.message : '删除用户失败', 'error')
    }
  }

  const filtered = users.filter((user) => {
    const term = search.trim().toLowerCase()
    const matchesSearch = term === '' || user.name.toLowerCase().includes(term) || user.email.toLowerCase().includes(term)
      || (user.phone?.includes(term) ?? false)
    const matchesStatus = statusFilter === 'all' || user.status === statusFilter
    const matchesTeam = teamFilter === 'all' || user.teamId === teamFilter
    return matchesSearch && matchesStatus && matchesTeam
  })

  if (loading) return <PageLoader label="正在加载组织成员…" />
  if (error !== null) return <ErrorPanel message={error} onRetry={load} />

  return (
    <div className="admin-page">
      <PageHeader
        description="统一管理企业身份、角色与团队席位。"
        group="组织与权限"
        title="用户管理"
        actions={canWrite ? <Button icon="plus" onClick={openCreate} variant="primary">添加用户</Button> : undefined}
      />

      <Card className="table-card" padded={false}>
        <div className="table-toolbar">
          <div className="table-toolbar-leading">
            <SearchField onChange={setSearch} placeholder="搜索姓名、邮箱或手机号" value={search} />
            <Select aria-label="按状态筛选" onChange={(event) => { setStatusFilter(event.target.value) }} value={statusFilter}>
              <option value="all">全部状态</option>
              <option value="active">正常</option>
              <option value="disabled">已停用</option>
            </Select>
            <Select aria-label="按团队筛选" onChange={(event) => { setTeamFilter(event.target.value) }} value={teamFilter}>
              <option value="all">全部团队</option>
              {teams.map(team => <option key={team.id} value={team.id}>{team.name}</option>)}
            </Select>
          </div>
          <span className="table-count">{filtered.length} 位成员</span>
        </div>
        <TableFrame>
          {filtered.length === 0 ? (
            <EmptyState icon="users" title="没有匹配的用户" description="调整筛选条件，或添加一位新的企业成员。" action={canWrite ? <Button icon="plus" onClick={openCreate} size="small" variant="primary">添加用户</Button> : undefined} />
          ) : (
            <div className="table-scroll">
              <table className="data-table">
                <thead><tr><th>成员</th><th>角色</th><th>团队</th><th>状态</th><th>最近登录</th><th>创建时间</th><th aria-label="操作" /></tr></thead>
                <tbody>
                  {filtered.map(user => (
                    <tr key={user.id}>
                      <td>
                        <div className="identity-cell">
                          <Avatar name={user.name} />
                          <div>
                            <strong>{user.name}</strong>
                            <span>{user.email}</span>
                            {user.phone === undefined ? null : <span>{user.phone}</span>}
                          </div>
                        </div>
                      </td>
                      <td><Badge tone={user.roleId === 'role-owner' ? 'violet' : user.roleId === 'role-admin' ? 'info' : 'neutral'}>{user.roleName}</Badge></td>
                      <td>{user.teamName ?? <span className="muted">未分配</span>}</td>
                      <td><StatusBadge status={user.status} /></td>
                      <td><span className="cell-secondary">{formatRelative(user.lastLoginAt)}</span></td>
                      <td><span className="cell-secondary">{formatDate(user.createdAt, false)}</span></td>
                      <td>
                        {canWrite && canManageUser(user) ? (
                          <div className="row-actions">
                            <IconButton icon="edit" label="编辑用户" onClick={() => { openEdit(user) }} />
                            <IconButton icon={user.status === 'active' ? 'eye-off' : 'eye'} label={user.status === 'active' ? '停用用户' : '启用用户'} onClick={() => { void toggleStatus(user) }} />
                            <IconButton className="is-danger" icon="trash" label="删除用户" onClick={() => { void remove(user) }} />
                          </div>
                        ) : <span className="muted">只读</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </TableFrame>
      </Card>

      <Modal
        description={editing === null ? '创建账号后可复制临时密码发送给成员。' : '修改身份信息；密码留空则保持不变。'}
        footer={<><Button onClick={() => { setModalOpen(false) }}>取消</Button><Button form="user-form" loading={submitting} type="submit" variant="primary">保存用户</Button></>}
        onClose={() => { setModalOpen(false) }}
        open={modalOpen}
        title={editing === null ? '添加企业成员' : '编辑企业成员'}
      >
        <form id="user-form" onSubmit={(event) => { void submit(event) }}>
          {formError === null ? null : <div className="form-error" role="alert"><Icon name="alert" size={15} />{formError}</div>}
          <FormGrid>
            <Field htmlFor="user-name" label="姓名"><Input id="user-name" onChange={(event) => { setForm(current => ({ ...current, name: event.target.value })) }} required value={form.name} /></Field>
            <Field htmlFor="user-email" label="企业邮箱"><Input id="user-email" onChange={(event) => { setForm(current => ({ ...current, email: event.target.value })) }} required type="email" value={form.email} /></Field>
            <Field hint="可选，用于手机号登录" htmlFor="user-phone" label="手机号"><Input autoComplete="tel" id="user-phone" inputMode="tel" onChange={(event) => { setForm(current => ({ ...current, phone: event.target.value })) }} placeholder="例如 13800138000" value={form.phone} /></Field>
            <Field htmlFor="user-role" label="角色">
              <Select id="user-role" onChange={(event) => { setForm(current => ({ ...current, roleId: event.target.value })) }} value={form.roleId}>
                {assignableRoles.map(role => <option key={role.id} value={role.id}>{role.name}</option>)}
              </Select>
            </Field>
            <Field htmlFor="user-team" label="团队">
              <Select id="user-team" onChange={(event) => { setForm(current => ({ ...current, teamId: event.target.value })) }} value={form.teamId}>
                <option value="">未分配团队</option>
                {teams.map(team => <option key={team.id} value={team.id}>{team.name}</option>)}
              </Select>
            </Field>
            <Field htmlFor="user-status" label="账号状态">
              <Select id="user-status" onChange={(event) => { setForm(current => ({ ...current, status: event.target.value as UserFormState['status'] })) }} value={form.status}>
                <option value="active">正常</option>
                <option value="disabled">停用</option>
              </Select>
            </Field>
            <Field hint={editing === null ? '留空则自动生成临时密码' : '留空则不修改密码'} htmlFor="user-password" label={editing === null ? '初始密码' : '重置密码'}>
              <Input autoComplete="new-password" id="user-password" minLength={editing === null ? undefined : 10} onChange={(event) => { setForm(current => ({ ...current, password: event.target.value })) }} placeholder="至少 10 个字符" type="password" value={form.password} />
            </Field>
          </FormGrid>
        </form>
      </Modal>

      <Modal
        footer={<><Button onClick={() => { void navigator.clipboard.writeText(`邮箱：${credential?.email ?? ''}${credential?.phone === undefined ? '' : `\n手机号：${credential.phone}`}\n临时密码：${credential?.password ?? ''}`); notify('账号信息已复制', 'success') }}>复制账号信息</Button><Button onClick={() => { setCredential(null) }} variant="primary">我已保存</Button></>}
        onClose={() => { setCredential(null) }}
        open={credential !== null}
        title="成员账号已创建"
      >
        <div className="credential-result">
          <span className="credential-result-icon"><Icon name="key" size={22} /></span>
          <p>临时密码只显示一次。请通过安全渠道发送给成员，并要求首次登录后修改密码。</p>
          <dl>
            <div><dt>邮箱</dt><dd>{credential?.email}</dd></div>
            {credential?.phone === undefined ? null : <div><dt>手机号</dt><dd>{credential.phone}</dd></div>}
            <div><dt>临时密码</dt><dd><code>{credential?.password}</code></dd></div>
          </dl>
        </div>
      </Modal>
    </div>
  )
}
