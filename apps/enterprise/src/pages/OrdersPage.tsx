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
} from '../components/ui.tsx'
import { useToast } from '../components/Toast.tsx'
import { api } from '../lib/api.ts'
import { useAuth } from '../lib/auth.tsx'
import { formatCurrency, formatDate } from '../lib/format.ts'
import type { BillingCycle, Order, Plan, Team } from '../lib/types.ts'

interface OrderFormState {
  teamId: string
  planId: string
  billingCycle: BillingCycle
  reference: string
}

const EMPTY_FORM: OrderFormState = { teamId: '', planId: '', billingCycle: 'monthly', reference: '' }

export function OrdersPage(): ReactNode {
  const { can } = useAuth()
  const { notify } = useToast()
  const canWrite = can('orders.write')
  const [orders, setOrders] = useState<Order[]>([])
  const [teams, setTeams] = useState<Team[]>([])
  const [plans, setPlans] = useState<Plan[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState('all')
  const [modalOpen, setModalOpen] = useState(false)
  const [form, setForm] = useState<OrderFormState>(EMPTY_FORM)
  const [formError, setFormError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const load = (): void => {
    setLoading(true)
    setError(null)
    void Promise.all([api.orders(), api.teams(), api.plans()]).then(([orderList, teamList, planList]) => {
      setOrders(orderList)
      setTeams(teamList)
      setPlans(planList)
    }).catch((caught: unknown) => {
      setError(caught instanceof Error ? caught.message : '无法读取订单数据')
    }).finally(() => { setLoading(false) })
  }

  useEffect(load, [])

  const openCreate = (): void => {
    setForm({ ...EMPTY_FORM, teamId: teams[0]?.id ?? '', planId: plans[0]?.id ?? '' })
    setFormError(null)
    setModalOpen(true)
  }

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    if (submitting) return
    setSubmitting(true)
    setFormError(null)
    try {
      await api.createOrder(form)
      setModalOpen(false)
      notify('订单已创建，等待确认收款', 'success')
      load()
    } catch (caught) {
      setFormError(caught instanceof Error ? caught.message : '创建订单失败')
    } finally {
      setSubmitting(false)
    }
  }

  const review = async (order: Order, action: 'approve' | 'reject'): Promise<void> => {
    if (!window.confirm(`确认${action === 'approve' ? '通过' : '拒绝'}订单 ${order.number}？`)) return
    try {
      await api.reviewOrder(order.id, action)
      notify(action === 'approve' ? '订单已确认并更新团队套餐' : '订单已拒绝', 'success')
      load()
    } catch (caught) {
      notify(caught instanceof Error ? caught.message : '处理订单失败', 'error')
    }
  }

  const filtered = statusFilter === 'all' ? orders : orders.filter(order => order.status === statusFilter)
  const pending = orders.filter(order => order.status === 'pending')
  const paidTotal = orders.filter(order => order.status === 'paid').reduce((total, order) => total + order.amountCents, 0)
  const selectedPlan = plans.find(plan => plan.id === form.planId)
  const estimatedAmount = selectedPlan === undefined ? 0 : form.billingCycle === 'annual' ? selectedPlan.annualPriceCents : selectedPlan.monthlyPriceCents

  if (loading) return <PageLoader label="正在加载订单账本…" />
  if (error !== null) return <ErrorPanel message={error} onRetry={load} />

  return (
    <div className="admin-page">
      <PageHeader
        description="管理企业套餐的线下收款、订单审核与生效流程。"
        group="套餐与计费"
        title="订单管理"
        actions={canWrite ? <Button icon="plus" onClick={openCreate} variant="primary">创建订单</Button> : undefined}
      />
      <div className="order-summary-row">
        <div className="order-summary-primary"><span>待处理订单</span><strong>{pending.length}</strong><small>需要财务或管理员确认</small></div>
        <div><span>已确认收入</span><strong>{formatCurrency(paidTotal)}</strong></div>
        <div><span>订单总数</span><strong>{orders.length}</strong></div>
        <div><span>年付订单</span><strong>{orders.filter(order => order.billingCycle === 'annual').length}</strong></div>
      </div>
      <Card className="table-card" padded={false}>
        <div className="table-toolbar">
          <Select aria-label="按订单状态筛选" onChange={(event) => { setStatusFilter(event.target.value) }} value={statusFilter}>
            <option value="all">全部订单</option>
            <option value="pending">待确认</option>
            <option value="paid">已支付</option>
            <option value="rejected">已拒绝</option>
          </Select>
          <span className="table-count">{filtered.length} 笔订单</span>
        </div>
        <TableFrame>
          {filtered.length === 0 ? (
            <EmptyState icon="orders" title="没有匹配的订单" description="创建新的套餐订单，或调整当前筛选条件。" action={canWrite ? <Button icon="plus" onClick={openCreate} size="small" variant="primary">创建订单</Button> : undefined} />
          ) : (
            <div className="table-scroll">
              <table className="data-table order-table">
                <thead><tr><th>订单号</th><th>团队 / 套餐</th><th>计费周期</th><th>金额</th><th>状态</th><th>创建时间</th><th aria-label="操作" /></tr></thead>
                <tbody>
                  {filtered.map(order => (
                    <tr key={order.id}>
                      <td><div className="order-number"><strong>{order.number}</strong>{order.reference === '' ? null : <span>参考 {order.reference}</span>}</div></td>
                      <td><div className="order-target"><strong>{order.teamName}</strong><span>{order.planName}</span></div></td>
                      <td><Badge tone={order.billingCycle === 'annual' ? 'violet' : 'neutral'}>{order.billingCycle === 'annual' ? '年付' : '月付'}</Badge></td>
                      <td><strong className="amount-cell">{formatCurrency(order.amountCents)}</strong></td>
                      <td><StatusBadge status={order.status} /></td>
                      <td><span className="cell-secondary">{formatDate(order.createdAt)}</span></td>
                      <td>{canWrite && order.status === 'pending' ? <div className="row-actions"><Button onClick={() => { void review(order, 'approve') }} size="small" variant="primary">确认收款</Button><Button onClick={() => { void review(order, 'reject') }} size="small" variant="ghost">拒绝</Button></div> : order.reviewedAt === undefined ? <span className="muted">—</span> : <span className="cell-secondary">{formatDate(order.reviewedAt, false)}</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </TableFrame>
      </Card>
      <Modal
        description="创建一笔待确认订单。确认收款后，团队会自动切换到对应套餐并扩展席位。"
        footer={<><Button onClick={() => { setModalOpen(false) }}>取消</Button><Button form="order-form" loading={submitting} type="submit" variant="primary">创建订单</Button></>}
        onClose={() => { setModalOpen(false) }}
        open={modalOpen}
        title="创建套餐订单"
      >
        <form id="order-form" onSubmit={(event) => { void submit(event) }}>
          {formError === null ? null : <div className="form-error" role="alert"><Icon name="alert" size={15} />{formError}</div>}
          <FormGrid>
            <Field htmlFor="order-team" label="目标团队">
              <Select id="order-team" onChange={(event) => { setForm(current => ({ ...current, teamId: event.target.value })) }} required value={form.teamId}>
                <option value="">选择团队</option>
                {teams.map(team => <option key={team.id} value={team.id}>{team.name}</option>)}
              </Select>
            </Field>
            <Field htmlFor="order-plan" label="套餐">
              <Select id="order-plan" onChange={(event) => { setForm(current => ({ ...current, planId: event.target.value })) }} required value={form.planId}>
                <option value="">选择套餐</option>
                {plans.filter(plan => plan.status === 'active').map(plan => <option key={plan.id} value={plan.id}>{plan.name}</option>)}
              </Select>
            </Field>
            <Field htmlFor="order-cycle" label="计费周期">
              <Select id="order-cycle" onChange={(event) => { setForm(current => ({ ...current, billingCycle: event.target.value as BillingCycle })) }} value={form.billingCycle}>
                <option value="monthly">月付</option>
                <option value="annual">年付</option>
              </Select>
            </Field>
            <Field htmlFor="order-reference" label="支付参考号"><Input id="order-reference" onChange={(event) => { setForm(current => ({ ...current, reference: event.target.value })) }} placeholder="银行流水 / 合同编号" value={form.reference} /></Field>
          </FormGrid>
          <div className="order-estimate"><span>订单金额</span><strong>{formatCurrency(estimatedAmount)}</strong><small>实际金额以创建时的套餐价格为准</small></div>
        </form>
      </Modal>
    </div>
  )
}
