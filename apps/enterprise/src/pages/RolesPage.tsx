import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { Icon } from '../components/Icon.tsx'
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorPanel,
  Field,
  Input,
  Modal,
  PageHeader,
  PageLoader,
  TableFrame,
  Textarea,
} from '../components/ui.tsx'
import { useToast } from '../components/Toast.tsx'
import { api } from '../lib/api.ts'
import { useAuth } from '../lib/auth.tsx'
import { PERMISSION_GROUPS, PERMISSION_LABELS } from '../lib/navigation.ts'
import type { Role } from '../lib/types.ts'

interface RoleFormState {
  name: string
  description: string
  permissions: string[]
}

const EMPTY_FORM: RoleFormState = { name: '', description: '', permissions: ['workspace.use'] }

export function RolesPage(): ReactNode {
  const { can, session } = useAuth()
  const { notify } = useToast()
  const canWrite = can('roles.write') && session?.user.roleId === 'role-owner'
  const [roles, setRoles] = useState<Role[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<Role | null>(null)
  const [form, setForm] = useState<RoleFormState>(EMPTY_FORM)
  const [formError, setFormError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const load = (): void => {
    setLoading(true)
    setError(null)
    void api.roles().then(setRoles).catch((caught: unknown) => {
      setError(caught instanceof Error ? caught.message : '无法读取角色数据')
    }).finally(() => { setLoading(false) })
  }

  useEffect(load, [])

  const openCreate = (): void => {
    setEditing(null)
    setForm({ ...EMPTY_FORM, permissions: ['workspace.use'] })
    setFormError(null)
    setModalOpen(true)
  }

  const openEdit = (role: Role): void => {
    setEditing(role)
    setForm({ name: role.name, description: role.description, permissions: [...role.permissions] })
    setFormError(null)
    setModalOpen(true)
  }

  const togglePermission = (permission: string, checked: boolean): void => {
    setForm(current => ({
      ...current,
      permissions: checked
        ? [...new Set([...current.permissions, permission])]
        : current.permissions.filter(item => item !== permission),
    }))
  }

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    if (submitting) return
    setSubmitting(true)
    setFormError(null)
    try {
      if (editing === null) await api.createRole(form)
      else await api.updateRole(editing.id, {
        name: form.name,
        description: form.description,
        permissions: form.permissions,
      })
      setModalOpen(false)
      notify(editing === null ? '角色已创建' : '角色权限已更新', 'success')
      load()
    } catch (caught) {
      setFormError(caught instanceof Error ? caught.message : '保存角色失败')
    } finally {
      setSubmitting(false)
    }
  }

  const remove = async (role: Role): Promise<void> => {
    if (!window.confirm(`确认删除角色「${role.name}」？`)) return
    try {
      await api.deleteRole(role.id)
      notify('角色已删除', 'success')
      load()
    } catch (caught) {
      notify(caught instanceof Error ? caught.message : '删除角色失败', 'error')
    }
  }

  if (loading) return <PageLoader label="正在加载角色权限…" />
  if (error !== null) return <ErrorPanel message={error} onRetry={load} />

  return (
    <div className="admin-page">
      <PageHeader
        description="所有者由系统内置；仅所有者可管理角色与管理员分配。"
        group="组织与权限"
        title="角色权限"
        actions={canWrite ? <Button icon="plus" onClick={openCreate} variant="primary">新建角色</Button> : undefined}
      />
      <Card className="table-card" padded={false}>
        <TableFrame>
          {roles.length === 0 ? (
            <EmptyState icon="roles" title="暂无角色" description="创建第一个角色并分配管理权限。" />
          ) : (
            <div className="table-scroll">
              <table className="data-table role-table">
                <thead><tr><th>角色</th><th>权限范围</th><th>成员</th><th>类型</th><th aria-label="操作" /></tr></thead>
                <tbody>
                  {roles.map(role => (
                    <tr key={role.id}>
                      <td><div className="role-cell"><span className={`role-icon role-${role.id}`}><Icon name={role.id === 'role-owner' ? 'shield' : role.id === 'role-admin' ? 'key' : 'users'} size={16} /></span><div><strong>{role.name}</strong><span>{role.description || '暂无说明'}</span></div></div></td>
                      <td><div className="permission-tags">{role.permissions.slice(0, 4).map(permission => <Badge key={permission} tone="neutral">{PERMISSION_LABELS[permission] ?? permission}</Badge>)}{role.permissions.length > 4 ? <Badge tone="info">+{role.permissions.length - 4}</Badge> : null}</div></td>
                      <td><span className="cell-number">{role.userCount}</span></td>
                      <td>{role.system ? <Badge tone="violet">系统角色</Badge> : <Badge tone="neutral">自定义</Badge>}</td>
                      <td>{canWrite && role.id !== 'role-owner' ? <div className="row-actions"><Button onClick={() => { openEdit(role) }} size="small" variant="ghost">编辑</Button>{role.system ? null : <Button onClick={() => { void remove(role) }} size="small" variant="ghost">删除</Button>}</div> : <span className="muted">{canWrite ? '内置' : '只读'}</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </TableFrame>
      </Card>

      <Modal
        description="勾选该角色可以执行的管理操作。进入 AI 工作台需要至少保留「进入 AI 工作台」权限。"
        footer={<><Button onClick={() => { setModalOpen(false) }}>取消</Button><Button form="role-form" loading={submitting} type="submit" variant="primary">保存角色</Button></>}
        onClose={() => { setModalOpen(false) }}
        open={modalOpen}
        title={editing === null ? '新建角色' : '编辑角色'}
        width={760}
      >
        <form id="role-form" onSubmit={(event) => { void submit(event) }}>
          {formError === null ? null : <div className="form-error" role="alert"><Icon name="alert" size={15} />{formError}</div>}
          <div className="form-grid form-grid-two">
            <Field htmlFor="role-name" label="角色名称"><Input id="role-name" onChange={(event) => { setForm(current => ({ ...current, name: event.target.value })) }} required value={form.name} /></Field>
            <Field htmlFor="role-description" label="角色说明"><Input id="role-description" onChange={(event) => { setForm(current => ({ ...current, description: event.target.value })) }} value={form.description} /></Field>
          </div>
          <div className="permission-editor">
            <div className="permission-editor-heading"><strong>权限范围</strong><span>{form.permissions.length} / {Object.keys(PERMISSION_LABELS).length} 项已选择</span></div>
            <div className="permission-groups">
              {PERMISSION_GROUPS.map(group => (
                <div className="permission-group" key={group.label}>
                  <h4>{group.label}</h4>
                  <div>
                    {group.permissions.map(permission => (
                      <label className="permission-option" key={permission}>
                        <input
                          checked={form.permissions.includes(permission)}
                          onChange={(event) => { togglePermission(permission, event.target.checked) }}
                          type="checkbox"
                        />
                        <span className="permission-check"><Icon name="check" size={12} /></span>
                        <span>{PERMISSION_LABELS[permission] ?? permission}</span>
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
          <Field className="visually-hidden" htmlFor="role-description-text" label="角色说明文本"><Textarea id="role-description-text" value={form.description} readOnly /></Field>
        </form>
      </Modal>
    </div>
  )
}
