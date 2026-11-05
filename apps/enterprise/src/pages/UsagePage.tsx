import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { Icon } from '../components/Icon.tsx'
import {
  Button,
  Card,
  EmptyState,
  ErrorPanel,
  Field,
  FormGrid,
  Input,
  Modal,
  PageHeader,
  PageLoader,
  Select,
  TableFrame,
} from '../components/ui.tsx'
import { useToast } from '../components/Toast.tsx'
import { api } from '../lib/api.ts'
import { useAuth } from '../lib/auth.tsx'
import { downloadText, formatCompactNumber, formatCurrency, formatDate, formatNumber } from '../lib/format.ts'
import type { Model, Team, UsageResponse } from '../lib/types.ts'

interface UsageFormState {
  teamId: string
  modelId: string
  requests: number
  inputTokens: number
  outputTokens: number
  recordedAt: string
}

function localDateTimeValue(): string {
  const now = new Date()
  const offset = now.getTimezoneOffset() * 60_000
  return new Date(now.getTime() - offset).toISOString().slice(0, 16)
}

export function UsagePage(): ReactNode {
  const { can } = useAuth()
  const { notify } = useToast()
  const [usage, setUsage] = useState<UsageResponse | null>(null)
  const [teams, setTeams] = useState<Team[]>([])
  const [models, setModels] = useState<Model[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [teamId, setTeamId] = useState('')
  const [modelId, setModelId] = useState('')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [form, setForm] = useState<UsageFormState>({ teamId: '', modelId: '', requests: 1, inputTokens: 0, outputTokens: 0, recordedAt: localDateTimeValue() })
  const [formError, setFormError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    void Promise.all([api.teams(), api.models()]).then(([teamList, modelList]) => {
      setTeams(teamList)
      setModels(modelList)
    }).catch(() => {
      // Filters gracefully degrade to the unfiltered usage ledger when metadata is unavailable.
    })
  }, [])

  useEffect(() => {
    let active = true
    setLoading(true)
    setError(null)
    const from = fromDate === '' ? undefined : new Date(`${fromDate}T00:00:00`).toISOString()
    const to = toDate === '' ? undefined : new Date(`${toDate}T23:59:59.999`).toISOString()
    void api.usage({
      ...(teamId === '' ? {} : { teamId }),
      ...(modelId === '' ? {} : { modelId }),
      ...(from === undefined ? {} : { from }),
      ...(to === undefined ? {} : { to }),
      limit: 500,
    }).then((value) => {
      if (active) setUsage(value)
    }).catch((caught: unknown) => {
      if (active) setError(caught instanceof Error ? caught.message : '无法读取用量数据')
    }).finally(() => {
      if (active) setLoading(false)
    })
    return () => { active = false }
  }, [fromDate, modelId, teamId, toDate])

  const openRecord = (): void => {
    setForm({ teamId: teams[0]?.id ?? '', modelId: models[0]?.id ?? '', requests: 1, inputTokens: 0, outputTokens: 0, recordedAt: localDateTimeValue() })
    setFormError(null)
    setModalOpen(true)
  }

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    if (submitting) return
    setSubmitting(true)
    setFormError(null)
    try {
      await api.recordUsage({
        teamId: form.teamId,
        modelId: form.modelId,
        requests: form.requests,
        inputTokens: form.inputTokens,
        outputTokens: form.outputTokens,
        recordedAt: new Date(form.recordedAt).toISOString(),
      })
      setModalOpen(false)
      notify('用量记录已写入账本', 'success')
      const refresh = await api.usage({
        ...(teamId === '' ? {} : { teamId }),
        ...(modelId === '' ? {} : { modelId }),
        limit: 500,
      })
      setUsage(refresh)
    } catch (caught) {
      setFormError(caught instanceof Error ? caught.message : '写入用量失败')
    } finally {
      setSubmitting(false)
    }
  }

  const exportCsv = (): void => {
    if (usage === null) return
    const rows = [
      ['时间', '团队', '用户', '模型', '渠道', '请求数', '输入 Tokens', '输出 Tokens', '成本（元）'],
      ...usage.records.map(record => [
        record.recordedAt,
        record.teamName,
        record.userEmail ?? '',
        record.modelName,
        record.channelName ?? '',
        String(record.requests),
        String(record.inputTokens),
        String(record.outputTokens),
        (record.costCents / 100).toFixed(2),
      ]),
    ]
    const csv = rows.map(row => row.map(cell => `"${cell.replaceAll('"', '""')}"`).join(',')).join('\n')
    downloadText(`enterprise-usage-${new Date().toISOString().slice(0, 10)}.csv`, `\ufeff${csv}`)
  }

  if (loading && usage === null) return <PageLoader label="正在聚合用量账本…" />
  if (error !== null && usage === null) return <ErrorPanel message={error} onRetry={() => { window.location.reload() }} />
  if (usage === null) return null

  return (
    <div className="admin-page">
      <PageHeader
        description="按团队、模型和时间窗口核对模型请求、Token 与内部成本。"
        group="模型与供给"
        title="用量统计"
        actions={<><Button icon="download" onClick={exportCsv} size="small">导出 CSV</Button>{can('usage.write') ? <Button icon="plus" onClick={openRecord} size="small" variant="primary">录入用量</Button> : null}</>}
      />

      <div className="usage-summary-grid">
        <div className="usage-summary-card"><span className="usage-summary-icon"><Icon name="activity" size={18} /></span><div><span>请求总量</span><strong>{formatNumber(usage.summary.requests)}</strong></div></div>
        <div className="usage-summary-card"><span className="usage-summary-icon"><Icon name="arrow-right" size={18} /></span><div><span>输入 Tokens</span><strong>{formatCompactNumber(usage.summary.inputTokens)}</strong></div></div>
        <div className="usage-summary-card"><span className="usage-summary-icon"><Icon name="arrow-left" size={18} /></span><div><span>输出 Tokens</span><strong>{formatCompactNumber(usage.summary.outputTokens)}</strong></div></div>
        <div className="usage-summary-card is-accent"><span className="usage-summary-icon"><Icon name="plans" size={18} /></span><div><span>计量成本</span><strong>{formatCurrency(usage.summary.costCents)}</strong></div></div>
      </div>

      <Card className="table-card" padded={false}>
        <div className="table-toolbar usage-toolbar">
          <div className="table-toolbar-leading">
            <Select aria-label="按团队筛选" onChange={(event) => { setTeamId(event.target.value) }} value={teamId}><option value="">全部团队</option>{teams.map(team => <option key={team.id} value={team.id}>{team.name}</option>)}</Select>
            <Select aria-label="按模型筛选" onChange={(event) => { setModelId(event.target.value) }} value={modelId}><option value="">全部模型</option>{models.map(model => <option key={model.id} value={model.id}>{model.displayName}</option>)}</Select>
            <Input aria-label="开始日期" onChange={(event) => { setFromDate(event.target.value) }} type="date" value={fromDate} />
            <span className="date-separator">至</span>
            <Input aria-label="结束日期" onChange={(event) => { setToDate(event.target.value) }} type="date" value={toDate} />
          </div>
          <span className="table-count">{usage.records.length} 条记录</span>
        </div>
        <TableFrame footer={<><span>成本按模型目录价格估算，并随每次记录固化。</span><span>最多显示最近 500 条</span></>}>
          {usage.records.length === 0 ? (
            <EmptyState
              icon="usage"
              title="暂无用量记录"
              description="当前企业用量账本为空。可由计量程序调用用量接口回传，或使用“录入用量”验证账本流程。"
              action={can('usage.write') ? <Button icon="plus" onClick={openRecord} size="small" variant="primary">录入第一条用量</Button> : undefined}
            />
          ) : (
            <div className="table-scroll">
              <table className="data-table usage-table">
                <thead>
                  <tr><th>记录时间</th><th>团队 / 用户</th><th>模型 / 渠道</th><th>请求</th><th>输入 Tokens</th><th>输出 Tokens</th><th>成本</th></tr>
                </thead>
                <tbody>
                  {usage.records.map(record => (
                    <tr key={record.id}>
                      <td><span className="cell-secondary">{formatDate(record.recordedAt)}</span></td>
                      <td><div className="usage-target"><strong>{record.teamName}</strong><span>{record.userEmail ?? '团队共享用量'}</span></div></td>
                      <td><div className="usage-target"><strong>{record.modelName}</strong><span>{record.channelName ?? '—'}</span></div></td>
                      <td><span className="cell-number">{formatNumber(record.requests)}</span></td>
                      <td><span className="token-value input-token">{formatNumber(record.inputTokens)}</span></td>
                      <td><span className="token-value output-token">{formatNumber(record.outputTokens)}</span></td>
                      <td><strong className="amount-cell">{formatCurrency(record.costCents)}</strong></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </TableFrame>
      </Card>

      <Modal
        description="此接口用于上游计量服务回传或财务补录。成本将按当前模型价格自动计算。"
        footer={<><Button onClick={() => { setModalOpen(false) }}>取消</Button><Button form="usage-form" loading={submitting} type="submit" variant="primary">写入账本</Button></>}
        onClose={() => { setModalOpen(false) }}
        open={modalOpen}
        title="录入模型用量"
      >
        <form id="usage-form" onSubmit={(event) => { void submit(event) }}>
          {formError === null ? null : <div className="form-error" role="alert"><Icon name="alert" size={15} />{formError}</div>}
          <FormGrid>
            <Field htmlFor="usage-team" label="团队"><Select id="usage-team" onChange={(event) => { setForm(current => ({ ...current, teamId: event.target.value })) }} required value={form.teamId}><option value="">选择团队</option>{teams.map(team => <option key={team.id} value={team.id}>{team.name}</option>)}</Select></Field>
            <Field htmlFor="usage-model" label="模型"><Select id="usage-model" onChange={(event) => { setForm(current => ({ ...current, modelId: event.target.value })) }} required value={form.modelId}><option value="">选择模型</option>{models.map(model => <option key={model.id} value={model.id}>{model.displayName}</option>)}</Select></Field>
            <Field htmlFor="usage-requests" label="请求数"><Input id="usage-requests" min={1} onChange={(event) => { setForm(current => ({ ...current, requests: Number(event.target.value) })) }} required type="number" value={form.requests} /></Field>
            <Field htmlFor="usage-time" label="记录时间"><Input id="usage-time" onChange={(event) => { setForm(current => ({ ...current, recordedAt: event.target.value })) }} required type="datetime-local" value={form.recordedAt} /></Field>
            <Field htmlFor="usage-input" label="输入 Tokens"><Input id="usage-input" min={0} onChange={(event) => { setForm(current => ({ ...current, inputTokens: Number(event.target.value) })) }} required type="number" value={form.inputTokens} /></Field>
            <Field htmlFor="usage-output" label="输出 Tokens"><Input id="usage-output" min={0} onChange={(event) => { setForm(current => ({ ...current, outputTokens: Number(event.target.value) })) }} required type="number" value={form.outputTokens} /></Field>
          </FormGrid>
        </form>
      </Modal>
    </div>
  )
}
