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
  Input,
  Modal,
  PageHeader,
  PageLoader,
  Select,
  StatusBadge,
  TableFrame,
  Textarea,
} from '../components/ui.tsx'
import { useToast } from '../components/Toast.tsx'
import { api } from '../lib/api.ts'
import { useAuth } from '../lib/auth.tsx'
import { formatCompactNumber, formatCurrency, formatNumber } from '../lib/format.ts'
import type { Plan } from '../lib/types.ts'

interface PlanFormState {
  name: string
  code: string
  monthlyPrice: string
  annualPrice: string
  seatLimit: number
  monthlyCredits: number
  features: string
  status: 'active' | 'archived'
}

const EMPTY_FORM: PlanFormState = {
  name: '',
  code: '',
  monthlyPrice: '299.00',
  annualPrice: '2990.00',
  seatLimit: 10,
  monthlyCredits: 5_000_000,
  features: '',
  status: 'active',
}

export function PlansPage(): ReactNode {
  const { can } = useAuth()
  const { notify } = useToast()
  const canWrite = can('plans.write')
  const [plans, setPlans] = useState<Plan[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<Plan | null>(null)
  const [form, setForm] = useState<PlanFormState>(EMPTY_FORM)
  const [formError, setFormError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const load = (): void => {
    setLoading(true)
    setError(null)
    void api.plans().then(setPlans).catch((caught: unknown) => {
      setError(caught instanceof Error ? caught.message : '无法读取套餐数据')
    }).finally(() => { setLoading(false) })
  }

  useEffect(load, [])

  const openCreate = (): void => {
    setEditing(null)
    setForm(EMPTY_FORM)
    setFormError(null)
    setModalOpen(true)
  }

  const openEdit = (plan: Plan): void => {
    setEditing(plan)
    setForm({
      name: plan.name,
      code: plan.code,
      monthlyPrice: (plan.monthlyPriceCents / 100).toFixed(2),
      annualPrice: (plan.annualPriceCents / 100).toFixed(2),
      seatLimit: plan.seatLimit,
      monthlyCredits: plan.monthlyCredits,
      features: plan.features.join('\n'),
      status: plan.status,
    })
    setFormError(null)
    setModalOpen(true)
  }

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    if (submitting) return
    setSubmitting(true)
    setFormError(null)
    const payload = {
      name: form.name,
      code: form.code,
      monthlyPriceCents: Math.round(Number(form.monthlyPrice) * 100),
      annualPriceCents: Math.round(Number(form.annualPrice) * 100),
      seatLimit: form.seatLimit,
      monthlyCredits: form.monthlyCredits,
      features: form.features.split(/\n|,/u).map(item => item.trim()).filter(Boolean),
      status: form.status,
    }
    try {
      if (editing === null) await api.createPlan(payload)
      else await api.updatePlan(editing.id, payload)
      setModalOpen(false)
      notify(editing === null ? '套餐已创建' : '套餐已更新', 'success')
      load()
    } catch (caught) {
      setFormError(caught instanceof Error ? caught.message : '保存套餐失败')
    } finally {
      setSubmitting(false)
    }
  }

  const remove = async (plan: Plan): Promise<void> => {
    if (!window.confirm(`确认删除套餐「${plan.name}」？`)) return
    try {
      await api.deletePlan(plan.id)
      notify('套餐已删除', 'success')
      load()
    } catch (caught) {
      notify(caught instanceof Error ? caught.message : '删除套餐失败', 'error')
    }
  }

  if (loading) return <PageLoader label="正在加载套餐目录…" />
  if (error !== null) return <ErrorPanel message={error} onRetry={load} />

  return (
    <div className="admin-page">
      <PageHeader
        description="定义企业席位、额度和计费价格，并将套餐分配给团队。"
        group="套餐与计费"
        title="套餐管理"
        actions={canWrite ? <Button icon="plus" onClick={openCreate} variant="primary">新建套餐</Button> : undefined}
      />
      <div className="plan-summary-row">
        <div><span>在售套餐</span><strong>{plans.filter(plan => plan.status === 'active').length}</strong></div>
        <div><span>覆盖团队</span><strong>{plans.reduce((total, plan) => total + plan.teamCount, 0)}</strong></div>
        <div><span>最高席位</span><strong>{formatNumber(Math.max(0, ...plans.map(plan => plan.seatLimit)))}</strong></div>
        <div><span>最大月度额度</span><strong>{formatCompactNumber(Math.max(0, ...plans.map(plan => plan.monthlyCredits)))}</strong></div>
      </div>
      <Card className="table-card" padded={false}>
        <TableFrame>
          {plans.length === 0 ? (
            <EmptyState icon="plans" title="暂无套餐" description="创建团队版、商业版或企业版套餐。" />
          ) : (
            <div className="table-scroll">
              <table className="data-table plan-table">
                <thead><tr><th>套餐</th><th>定价</th><th>席位 / 额度</th><th>覆盖团队</th><th>状态</th><th aria-label="操作" /></tr></thead>
                <tbody>
                  {plans.map(plan => (
                    <tr key={plan.id}>
                      <td><div className="plan-cell"><span className="plan-monogram">{plan.name.slice(0, 1)}</span><div><strong>{plan.name}</strong><span>{plan.code}</span></div></div></td>
                      <td><div className="price-cell"><strong>{formatCurrency(plan.monthlyPriceCents)}<small>/月</small></strong><span>{formatCurrency(plan.annualPriceCents)} /年</span></div></td>
                      <td><div className="quota-cell"><span>{formatNumber(plan.seatLimit)} 席位</span><span>{formatCompactNumber(plan.monthlyCredits)} 月度额度</span></div></td>
                      <td><Badge tone={plan.teamCount > 0 ? 'info' : 'neutral'}>{plan.teamCount} 个团队</Badge></td>
                      <td><StatusBadge status={plan.status} /></td>
                      <td>{canWrite ? <div className="row-actions"><Button onClick={() => { openEdit(plan) }} size="small" variant="ghost">编辑</Button><Button onClick={() => { void remove(plan) }} size="small" variant="ghost">删除</Button></div> : <span className="muted">只读</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </TableFrame>
      </Card>
      <Modal
        description="价格以人民币计价。套餐归档后不影响已分配团队，但不再用于新订单。"
        footer={<><Button onClick={() => { setModalOpen(false) }}>取消</Button><Button form="plan-form" loading={submitting} type="submit" variant="primary">保存套餐</Button></>}
        onClose={() => { setModalOpen(false) }}
        open={modalOpen}
        title={editing === null ? '新建企业套餐' : '编辑企业套餐'}
        width={720}
      >
        <form id="plan-form" onSubmit={(event) => { void submit(event) }}>
          {formError === null ? null : <div className="form-error" role="alert"><Icon name="alert" size={15} />{formError}</div>}
          <FormGrid>
            <Field htmlFor="plan-name" label="套餐名称"><Input id="plan-name" onChange={(event) => { setForm(current => ({ ...current, name: event.target.value })) }} required value={form.name} /></Field>
            <Field htmlFor="plan-code" label="套餐编码"><Input id="plan-code" onChange={(event) => { setForm(current => ({ ...current, code: event.target.value.toLowerCase().replace(/[^a-z0-9_-]/gu, '') })) }} required value={form.code} /></Field>
            <Field htmlFor="plan-monthly" label="月付价格（元）"><Input id="plan-monthly" min={0} onChange={(event) => { setForm(current => ({ ...current, monthlyPrice: event.target.value })) }} required step="0.01" type="number" value={form.monthlyPrice} /></Field>
            <Field htmlFor="plan-annual" label="年付价格（元）"><Input id="plan-annual" min={0} onChange={(event) => { setForm(current => ({ ...current, annualPrice: event.target.value })) }} required step="0.01" type="number" value={form.annualPrice} /></Field>
            <Field htmlFor="plan-seats" label="包含席位"><Input id="plan-seats" min={1} onChange={(event) => { setForm(current => ({ ...current, seatLimit: Number(event.target.value) })) }} required type="number" value={form.seatLimit} /></Field>
            <Field htmlFor="plan-credits" label="月度额度（Tokens）"><Input id="plan-credits" min={0} onChange={(event) => { setForm(current => ({ ...current, monthlyCredits: Number(event.target.value) })) }} required type="number" value={form.monthlyCredits} /></Field>
            <Field htmlFor="plan-status" label="套餐状态"><Select id="plan-status" onChange={(event) => { setForm(current => ({ ...current, status: event.target.value as PlanFormState['status'] })) }} value={form.status}><option value="active">在售</option><option value="archived">归档</option></Select></Field>
            <Field className="field-span-2" hint="每行一项，也可以用逗号分隔" htmlFor="plan-features" label="套餐特性"><Textarea id="plan-features" onChange={(event) => { setForm(current => ({ ...current, features: event.target.value })) }} rows={4} value={form.features} /></Field>
          </FormGrid>
        </form>
      </Modal>
    </div>
  )
}
