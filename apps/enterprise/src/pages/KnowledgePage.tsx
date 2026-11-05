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
import type { KnowledgeArticle, KnowledgeSummary } from '../lib/types.ts'

interface KnowledgeFormState {
  title: string
  summary: string
  body: string
  tags: string
}

const EMPTY_FORM: KnowledgeFormState = { title: '', summary: '', body: '', tags: '' }

function formFromArticle(article: KnowledgeArticle): KnowledgeFormState {
  return {
    title: article.title,
    summary: article.summary,
    body: article.body,
    tags: article.tags.join(', '),
  }
}

export function KnowledgePage(): ReactNode {
  const { notify } = useToast()
  const { can } = useAuth()
  const canWrite = can('workspace.resources.write')
  const resourceTeam = useResourceTeam()
  const teamId = resourceTeam.teamId
  const [articles, setArticles] = useState<KnowledgeSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [editorOpen, setEditorOpen] = useState(false)
  const [editorLoading, setEditorLoading] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<KnowledgeFormState>(EMPTY_FORM)
  const [formError, setFormError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const load = useCallback(async (): Promise<void> => {
    if (teamId === undefined) return
    setLoading(true)
    setError(null)
    try {
      setArticles(await api.knowledge(teamId))
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '无法读取团队知识库')
    } finally {
      setLoading(false)
    }
  }, [teamId])

  useEffect(() => { void load() }, [load])

  useEffect(() => {
    setSearch('')
    setEditorOpen(false)
    setEditorLoading(false)
    setEditingId(null)
    setForm(EMPTY_FORM)
    setFormError(null)
  }, [teamId])

  const openCreate = (): void => {
    setEditingId(null)
    setForm(EMPTY_FORM)
    setFormError(null)
    setEditorOpen(true)
  }

  const openEdit = async (id: string): Promise<void> => {
    setEditingId(id)
    setEditorOpen(true)
    setEditorLoading(true)
    setFormError(null)
    try {
      setForm(formFromArticle(await api.knowledgeArticle(id, teamId)))
    } catch (caught) {
      setEditorOpen(false)
      notify(caught instanceof Error ? caught.message : '无法读取知识条目', 'error')
    } finally {
      setEditorLoading(false)
    }
  }

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    if (submitting || !canWrite) return
    setSubmitting(true)
    setFormError(null)
    const input = {
      title: form.title.trim(),
      summary: form.summary.trim(),
      body: form.body.trim(),
      tags: form.tags.split(',').map(tag => tag.trim()).filter(tag => tag !== ''),
    }
    try {
      if (editingId === null) await api.createKnowledge(input, teamId)
      else await api.updateKnowledge(editingId, input, teamId)
      setEditorOpen(false)
      notify(editingId === null ? '知识条目已创建，团队技能已更新' : '知识条目已更新，团队技能已同步', 'success')
      await load()
    } catch (caught) {
      setFormError(caught instanceof Error ? caught.message : '保存知识条目失败')
    } finally {
      setSubmitting(false)
    }
  }

  const remove = async (article: KnowledgeSummary): Promise<void> => {
    if (!window.confirm(`确认删除知识条目「${article.title}」？`)) return
    try {
      await api.deleteKnowledge(article.id, teamId)
      notify('知识条目已删除，团队技能已同步', 'success')
      await load()
    } catch (caught) {
      notify(caught instanceof Error ? caught.message : '删除知识条目失败', 'error')
    }
  }

  const term = search.trim().toLowerCase()
  const filtered = articles.filter(article => term === ''
    || article.title.toLowerCase().includes(term)
    || article.summary.toLowerCase().includes(term)
    || article.tags.some(tag => tag.toLowerCase().includes(term)))

  return (
    <div className="admin-page resource-page">
      <PageHeader
        description="沉淀团队政策、运行手册和背景知识，并让 Agent 按需加载。"
        group="团队资源"
        title="知识库"
        actions={(
          <>
            <ResourceTeamPicker onChange={resourceTeam.selectTeam} teams={resourceTeam.teams} value={teamId ?? ''} />
            {canWrite ? <Button icon="plus" onClick={openCreate} variant="primary">新建知识</Button> : null}
          </>
        )}
      />
      <InlineNotice title="自动生成团队技能">
        知识条目会同步生成名为 <code>team-knowledge</code> 的技能及参考文件。Agent 遇到团队流程、政策或内部背景问题时，可按需加载对应内容；无需手工维护提示词。
      </InlineNotice>
      <Card className="table-card resource-table-card" padded={false}>
        <div className="table-toolbar">
          <SearchField onChange={setSearch} placeholder="搜索标题、摘要或标签" value={search} />
          <span className="table-count">{filtered.length} 条知识</span>
        </div>
        <TableFrame>
          {loading ? <PageLoader label="正在读取团队知识库…" /> : error !== null ? (
            <ErrorPanel message={error} onRetry={() => { void load() }} />
          ) : filtered.length === 0 ? (
            <EmptyState
              description={term === '' ? '记录团队约定、排障步骤和业务背景，Agent 会在需要时查阅。' : '没有匹配当前关键词的知识条目。'}
              icon="models"
              title={term === '' ? '知识库还是空的' : '没有匹配的知识'}
              action={canWrite && term === '' ? <Button icon="plus" onClick={openCreate} size="small" variant="primary">新建知识</Button> : undefined}
            />
          ) : (
            <div className="table-scroll">
              <table className="data-table resource-table knowledge-table">
                <thead><tr><th>标题与摘要</th><th>标签</th><th>更新时间</th><th aria-label="操作" /></tr></thead>
                <tbody>
                  {filtered.map(article => (
                    <tr key={article.id}>
                      <td>
                        <button className="knowledge-title" onClick={() => { void openEdit(article.id) }} type="button">
                          <strong>{article.title}</strong>
                          <span>{article.summary}</span>
                        </button>
                      </td>
                      <td>
                        <div className="knowledge-tags">
                          {article.tags.length === 0 ? <span className="cell-secondary">无标签</span> : article.tags.slice(0, 3).map(tag => <Badge key={tag}>{tag}</Badge>)}
                          {article.tags.length > 3 ? <span className="cell-secondary">+{String(article.tags.length - 3)}</span> : null}
                        </div>
                      </td>
                      <td className="cell-nowrap">{formatDate(article.updatedAt)}</td>
                      <td>
                        <div className="row-actions">
                          <IconButton icon={canWrite ? 'edit' : 'eye'} label={canWrite ? '编辑' : '查看'} onClick={() => { void openEdit(article.id) }} />
                          {canWrite ? <IconButton className="is-danger" icon="trash" label="删除" onClick={() => { void remove(article) }} /> : null}
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
        description="保存后会立即写入团队知识库，并刷新 DSH 可发现的团队知识技能。"
        footer={canWrite ? (
          <>
            <Button onClick={() => { setEditorOpen(false) }}>取消</Button>
            <Button form="knowledge-form" loading={submitting} type="submit" variant="primary">{editingId === null ? '创建知识' : '保存修改'}</Button>
          </>
        ) : <Button onClick={() => { setEditorOpen(false) }}>关闭</Button>}
        onClose={() => { setEditorOpen(false) }}
        open={editorOpen}
        title={!canWrite ? '查看知识' : editingId === null ? '新建知识' : '编辑知识'}
        width={760}
      >
        {editorLoading ? <PageLoader label="正在读取知识条目…" /> : (
          <form id="knowledge-form" onSubmit={(event) => { void submit(event) }}>
            {formError === null ? null : <div className="form-error" role="alert"><Icon name="alert" size={15} />{formError}</div>}
            <Field htmlFor="knowledge-title" label="标题">
              <Input autoFocus disabled={!canWrite} id="knowledge-title" maxLength={200} onChange={(event) => { setForm(current => ({ ...current, title: event.target.value })) }} required value={form.title} />
            </Field>
            <Field htmlFor="knowledge-summary" label="摘要">
              <Input disabled={!canWrite} id="knowledge-summary" maxLength={1000} onChange={(event) => { setForm(current => ({ ...current, summary: event.target.value })) }} placeholder="一句话说明这条知识解决什么问题" required value={form.summary} />
            </Field>
            <Field hint="使用英文逗号分隔，最多 12 个标签" htmlFor="knowledge-tags" label="标签">
              <Input disabled={!canWrite} id="knowledge-tags" onChange={(event) => { setForm(current => ({ ...current, tags: event.target.value })) }} placeholder="运维, 安全, 客户支持" value={form.tags} />
            </Field>
            <Field htmlFor="knowledge-body" label="正文">
              <Textarea className="resource-form-textarea" disabled={!canWrite} id="knowledge-body" onChange={(event) => { setForm(current => ({ ...current, body: event.target.value })) }} placeholder="记录团队内部政策、操作步骤、注意事项和判定依据。" required rows={12} value={form.body} />
            </Field>
          </form>
        )}
      </Modal>
    </div>
  )
}
