import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { Icon } from '../components/Icon.tsx'
import { ResourceTeamPicker } from '../components/ResourceTeamPicker.tsx'
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorPanel,
  Field,
  IconButton,
  InlineNotice,
  Input,
  Modal,
  PageHeader,
  PageLoader,
  SearchField,
  TableFrame,
  Textarea,
} from '../components/ui.tsx'
import { useToast } from '../components/Toast.tsx'
import { api } from '../lib/api.ts'
import { useAuth } from '../lib/auth.tsx'
import { formatDate } from '../lib/format.ts'
import { useResourceTeam } from '../lib/resource-team.ts'
import type { TeamSkillSummary } from '../lib/types.ts'

interface SkillFormState {
  name: string
  description: string
  instructions: string
}

const EMPTY_FORM: SkillFormState = { name: '', description: '', instructions: '' }

export function SkillsPage(): ReactNode {
  const { notify } = useToast()
  const { can } = useAuth()
  const canWrite = can('workspace.resources.write')
  const resourceTeam = useResourceTeam()
  const teamId = resourceTeam.teamId
  const [skills, setSkills] = useState<TeamSkillSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [editorOpen, setEditorOpen] = useState(false)
  const [editorLoading, setEditorLoading] = useState(false)
  const [editingName, setEditingName] = useState<string | null>(null)
  const [managed, setManaged] = useState(false)
  const [form, setForm] = useState<SkillFormState>(EMPTY_FORM)
  const [formError, setFormError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const load = useCallback(async (): Promise<void> => {
    if (teamId === undefined) return
    setLoading(true)
    setError(null)
    try {
      setSkills(await api.resourceSkills(teamId))
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '无法读取团队技能')
    } finally {
      setLoading(false)
    }
  }, [teamId])

  useEffect(() => { void load() }, [load])

  useEffect(() => {
    setSearch('')
    setEditorOpen(false)
    setEditorLoading(false)
    setEditingName(null)
    setManaged(false)
    setForm(EMPTY_FORM)
    setFormError(null)
  }, [teamId])

  const openCreate = (): void => {
    setEditingName(null)
    setManaged(false)
    setForm(EMPTY_FORM)
    setFormError(null)
    setEditorOpen(true)
  }

  const openSkill = async (skill: TeamSkillSummary): Promise<void> => {
    setEditingName(skill.name)
    setManaged(skill.managedBy === 'knowledge')
    setEditorOpen(true)
    setEditorLoading(true)
    setFormError(null)
    try {
      const detail = await api.resourceSkill(skill.name, teamId)
      setForm({ name: detail.name, description: detail.description, instructions: detail.instructions })
    } catch (caught) {
      setEditorOpen(false)
      notify(caught instanceof Error ? caught.message : '无法读取技能', 'error')
    } finally {
      setEditorLoading(false)
    }
  }

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    if (submitting || managed || !canWrite) return
    setSubmitting(true)
    setFormError(null)
    try {
      if (editingName === null) {
        await api.createResourceSkill({
          name: form.name.trim(),
          description: form.description.trim(),
          instructions: form.instructions.trim(),
        }, teamId)
      } else {
        await api.updateResourceSkill(editingName, {
          description: form.description.trim(),
          instructions: form.instructions.trim(),
        }, teamId)
      }
      setEditorOpen(false)
      notify(editingName === null ? '技能已创建，DSH 会自动发现' : '技能已更新，DSH 会自动刷新', 'success')
      await load()
    } catch (caught) {
      setFormError(caught instanceof Error ? caught.message : '保存技能失败')
    } finally {
      setSubmitting(false)
    }
  }

  const remove = async (skill: TeamSkillSummary): Promise<void> => {
    if (!window.confirm(`确认删除技能「${skill.name}」？技能目录中的文件也会一并删除。`)) return
    try {
      await api.deleteResourceSkill(skill.name, teamId)
      notify('技能已删除，DSH 会自动刷新', 'success')
      await load()
    } catch (caught) {
      notify(caught instanceof Error ? caught.message : '删除技能失败', 'error')
    }
  }

  const term = search.trim().toLowerCase()
  const filtered = skills.filter(skill => term === ''
    || skill.name.toLowerCase().includes(term)
    || skill.description.toLowerCase().includes(term))

  return (
    <div className="admin-page resource-page">
      <PageHeader
        description="将团队工作方法写成技能，Agent 会在匹配任务时自动发现并按需加载。"
        group="团队资源"
        title="技能"
        actions={(
          <>
            <ResourceTeamPicker onChange={resourceTeam.selectTeam} teams={resourceTeam.teams} value={teamId ?? ''} />
            {canWrite ? <Button icon="plus" onClick={openCreate} variant="primary">新建技能</Button> : null}
          </>
        )}
      />
      <InlineNotice title="真实文件系统技能">
        用户技能写入团队 DSH Home 的 <code>skills/&lt;name&gt;/SKILL.md</code>，与内置技能一样经过 frontmatter 校验并由文件监听器发现。团队知识库自动生成的技能由系统维护，不能在这里修改。
      </InlineNotice>
      <Card className="table-card resource-table-card" padded={false}>
        <div className="table-toolbar">
          <SearchField onChange={setSearch} placeholder="搜索技能名称或描述" value={search} />
          <span className="table-count">{filtered.length} 个技能</span>
        </div>
        <TableFrame>
          {loading ? <PageLoader label="正在读取团队技能…" /> : error !== null ? (
            <ErrorPanel message={error} onRetry={() => { void load() }} />
          ) : filtered.length === 0 ? (
            <EmptyState
              description={term === '' ? '把重复出现的团队流程写成技能，让 Agent 在正确场景下自动加载。' : '没有匹配当前关键词的技能。'}
              icon="spark"
              title={term === '' ? '还没有团队技能' : '没有匹配的技能'}
              action={canWrite && term === '' ? <Button icon="plus" onClick={openCreate} size="small" variant="primary">新建技能</Button> : undefined}
            />
          ) : (
            <div className="table-scroll">
              <table className="data-table resource-table skills-table">
                <thead><tr><th>技能</th><th>来源</th><th>更新时间</th><th aria-label="操作" /></tr></thead>
                <tbody>
                  {filtered.map(skill => (
                    <tr key={skill.name}>
                      <td>
                        <button className="skill-title" onClick={() => { void openSkill(skill) }} type="button">
                          <span className="resource-entry-icon" data-kind="skill"><Icon name="spark" size={15} /></span>
                          <span className="resource-entry-copy"><strong>{skill.name}</strong><small>{skill.description}</small></span>
                        </button>
                      </td>
                      <td><Badge tone={skill.managedBy === 'knowledge' ? 'violet' : 'neutral'}>{skill.managedBy === 'knowledge' ? '知识库生成' : '团队编写'}</Badge></td>
                      <td className="cell-nowrap">{formatDate(skill.updatedAt)}</td>
                      <td>
                        <div className="row-actions">
                          <IconButton icon="eye" label="查看技能" onClick={() => { void openSkill(skill) }} />
                          {canWrite && skill.managedBy !== 'knowledge' ? <IconButton icon="edit" label="编辑技能" onClick={() => { void openSkill(skill) }} /> : null}
                          {canWrite && skill.managedBy !== 'knowledge' ? <IconButton className="is-danger" icon="trash" label="删除技能" onClick={() => { void remove(skill) }} /> : null}
                        </div>
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
        description={managed ? '该技能由团队知识库自动生成，请到知识库页面修改内容。' : '保存后会写入团队 DSH Home，下一次 Agent 请求即可发现。'}
        footer={managed || !canWrite ? <Button onClick={() => { setEditorOpen(false) }}>关闭</Button> : (
          <>
            <Button onClick={() => { setEditorOpen(false) }}>取消</Button>
            <Button form="skill-form" loading={submitting} type="submit" variant="primary">{editingName === null ? '创建技能' : '保存修改'}</Button>
          </>
        )}
        onClose={() => { setEditorOpen(false) }}
        open={editorOpen}
        title={!canWrite ? '查看技能' : editingName === null ? '新建技能' : managed ? '查看知识库技能' : '编辑技能'}
        width={780}
      >
        {editorLoading ? <PageLoader label="正在读取技能文件…" /> : (
          <form id="skill-form" onSubmit={(event) => { void submit(event) }}>
            {formError === null ? null : <div className="form-error" role="alert"><Icon name="alert" size={15} />{formError}</div>}
            <Field {...(managed ? {} : { hint: '只能使用小写字母、数字和短横线，例如 incident-runbook' })} htmlFor="skill-name" label="技能名称">
              <Input autoFocus={editingName === null} disabled={editingName !== null || managed || !canWrite} id="skill-name" maxLength={80} onChange={(event) => { setForm(current => ({ ...current, name: event.target.value })) }} pattern="[a-z0-9]+(?:-[a-z0-9]+)*" placeholder="incident-runbook" required value={form.name} />
            </Field>
            <Field htmlFor="skill-description" label="描述">
              <Input disabled={managed || !canWrite} id="skill-description" maxLength={500} onChange={(event) => { setForm(current => ({ ...current, description: event.target.value })) }} placeholder="说明这个技能解决什么问题，以及何时应该使用" required value={form.description} />
            </Field>
            <Field {...(managed ? {} : { hint: 'Markdown 正文。可写工作步骤、判断标准、输出格式和注意事项。' })} htmlFor="skill-instructions" label="技能正文">
              <Textarea className="resource-form-textarea" disabled={managed || !canWrite} id="skill-instructions" onChange={(event) => { setForm(current => ({ ...current, instructions: event.target.value })) }} placeholder={'# 工作步骤\n\n1. ...'} required rows={14} value={form.instructions} />
            </Field>
          </form>
        )}
      </Modal>
    </div>
  )
}
