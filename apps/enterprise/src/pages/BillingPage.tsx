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
import { api } from '../lib/api.ts'
import { formatCompactNumber, formatCurrency, formatDate, formatNumber } from '../lib/format.ts'
import type { BillingCycle, BillingOverview, Plan } from '../lib/types.ts'

export function BillingPage(): ReactNode {
  const [billing, setBilling] = useState<BillingOverview | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<Plan | null>(null)
  const [billingCycle, setBillingCycle] = useState<BillingCycle>('monthly')
  const [reference, setReference] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const load = (): void => {
    setLoading(true)
    setError(null)
    void api.billing().then(setBilling).catch((caught: unknown) => {
      setError(caught instanceof Error ? caught.message : '无法读取套餐额度')
    }).finally(() => { setLoading(false) })
  }

  useEffect(load, [])

  const openPurchase = (plan: Plan): void => {
    setSelected(plan)
    setSuccess(null)
    setBillingCycle('monthly')
    setReference('')
    setFormError(null)
  }

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    if (selected === null || submitting) return
    setSubmitting(true)
    setFormError(null)
    try {
      await api.createBillingOrder({
        planId: selected.id,
        billingCycle,
        ...(reference.trim() === '' ? {} : { reference: reference.trim() }),
      })
      setSelected(null)
      setSuccess('订单已提交，待管理员确认收款。')
      load()
    } catch (caught) {
      setFormError(caught instanceof Error ? caught.message : '提交订单失败')
    } finally {
      setSubmitting(false)
    }
  }

  if (loading && billing === null) return <PageLoader label="正在读取套餐额度…" />
  if (error !== null && billing === null) return <ErrorPanel message={error} onRetry={load} />
  if (billing === null) return null

  const pendingOrder = billing.orders.find(order => order.status === 'pending')
  const quota = billing.quota
  const progressTone = quota.percentUsed >= 90 ? 'is-danger' : quota.percentUsed >= 70 ? 'is-warning' : ''
  const estimatedAmount = selected === null
    ? 0
    : billingCycle === 'annual' ? selected.annualPriceCents : selected.monthlyPriceCents
  const cycleEndsAt = new Date(Date.parse(billing.cycle.endsAt) - 1).toISOString()

  return (
    <div className="admin-page billing-page">
      <PageHeader
        actions={<Button icon="activity" onClick={load} size="small">刷新</Button>}
        group="账户与服务"
        title="套餐与额度"
      />

      <div className="billing-overview">
        <Card className="billing-plan-summary">
          <div className="billing-plan-head">
            <div>
              <span className="billing-eyebrow">当前套餐</span>
              <h2>{billing.plan?.name ?? '未分配套餐'}</h2>
              <p>{billing.team.name} · {formatNumber(billing.team.memberCount)} / {formatNumber(billing.team.seatLimit)} 席位</p>
            </div>
            <Badge tone={billing.team.status === 'active' ? 'success' : 'warning'} dot>
              {billing.team.status === 'active' ? '服务中' : '已停用'}
            </Badge>
          </div>
          <div className="billing-cycle-row">
            <span>本计费月</span>
            <strong>
              {formatDate(billing.cycle.startsAt, false)}
              {' — '}
              {formatDate(cycleEndsAt, false)}
            </strong>
          </div>
        </Card>

        <Card className="billing-quota-summary">
          <div className="billing-quota-head">
            <div>
              <span className="billing-eyebrow">本月可用额度</span>
              <strong>{formatCompactNumber(quota.remainingTokens)}</strong>
              <span className="billing-quota-total">共 {formatCompactNumber(quota.totalTokens)} Tokens</span>
            </div>
            <span className="billing-quota-percent">{quota.percentUsed.toFixed(0)}%</span>
          </div>
          <div aria-label={`本月额度已使用 ${String(quota.percentUsed)}%`} className="progress-track billing-progress" role="progressbar" aria-valuemax={100} aria-valuemin={0} aria-valuenow={quota.percentUsed}>
            <span className={progressTone} style={{ width: `${Math.min(100, quota.percentUsed)}%` }} />
          </div>
          <div className="billing-quota-foot">
            <span>已用 {formatCompactNumber(quota.usedTokens)}</span>
            <span>我的用量 {formatCompactNumber(quota.userTokens)}</span>
          </div>
        </Card>
      </div>

      <div className="billing-stats">
        <div><span>剩余额度</span><strong>{formatCompactNumber(quota.remainingTokens)}</strong><small>团队共享</small></div>
        <div><span>本月请求</span><strong>{formatNumber(quota.requests)}</strong><small>我的 {formatNumber(quota.userRequests)} 次</small></div>
        <div><span>我的 Token</span><strong>{formatCompactNumber(quota.userTokens)}</strong><small>本计费月</small></div>
        <div><span>计量成本</span><strong>{formatCurrency(quota.costCents)}</strong><small>按模型价格估算</small></div>
      </div>

      {success === null ? null : (
        <div className="billing-notice is-success" role="status">
          <Icon name="check" size={16} />
          <span>{success}</span>
        </div>
      )}

      {pendingOrder === undefined ? null : (
        <div className="billing-pending" role="status">
          <Icon name="orders" size={16} />
          <span>订单 {pendingOrder.number} 待确认收款。</span>
        </div>
      )}

      <div className="billing-section-head">
        <div><h2>套餐</h2></div>
        {billing.canPurchase ? null : <Badge tone="neutral">仅所有者可购买</Badge>}
      </div>
      <div className="billing-plan-grid">
        {billing.plans.map((plan) => {
          const current = plan.id === billing.plan?.id
          return (
            <Card className={`billing-offer ${current ? 'is-current' : ''}`} key={plan.id}>
              <div className="billing-offer-head">
                <div><span className="billing-eyebrow">{plan.code}</span><h3>{plan.name}</h3></div>
                {current ? <Badge tone="violet">当前套餐</Badge> : null}
              </div>
              <div className="billing-offer-price">
                <strong>{formatCurrency(plan.monthlyPriceCents)}</strong><span>/ 月</span>
              </div>
              <div className="billing-offer-meta">
                <div><span>月度额度</span><strong>{formatCompactNumber(plan.monthlyCredits)}</strong></div>
                <div><span>席位</span><strong>{formatNumber(plan.seatLimit)}</strong></div>
              </div>
              <ul>
                {plan.features.slice(0, 4).map(feature => <li key={feature}><Icon name="check" size={13} />{feature}</li>)}
              </ul>
              <Button
                disabled={!billing.canPurchase || pendingOrder !== undefined}
                onClick={() => { openPurchase(plan) }}
                variant={current ? 'secondary' : 'primary'}
              >
                {pendingOrder !== undefined ? '等待确认' : current ? '续费' : '选择套餐'}
              </Button>
            </Card>
          )
        })}
      </div>

      <Card className="table-card billing-orders" padded={false}>
        <div className="billing-orders-head">
          <div><h2>订单</h2></div>
        </div>
        <TableFrame>
          {billing.orders.length === 0 ? (
            <EmptyState icon="orders" title="暂无订单" description="选择套餐后，订单会显示在这里。" />
          ) : (
            <div className="table-scroll">
              <table className="data-table">
                <thead><tr><th>订单号</th><th>套餐</th><th>周期</th><th>金额</th><th>状态</th><th>创建时间</th></tr></thead>
                <tbody>
                  {billing.orders.map(order => (
                    <tr key={order.id}>
                      <td><strong>{order.number}</strong></td>
                      <td>{order.planName}</td>
                      <td><Badge tone={order.billingCycle === 'annual' ? 'violet' : 'neutral'}>{order.billingCycle === 'annual' ? '年付' : '月付'}</Badge></td>
                      <td><strong className="amount-cell">{formatCurrency(order.amountCents)}</strong></td>
                      <td><StatusBadge status={order.status} /></td>
                      <td><span className="cell-secondary">{formatDate(order.createdAt)}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </TableFrame>
      </Card>

      <Modal
        footer={<><Button onClick={() => { setSelected(null) }}>取消</Button><Button form="billing-order-form" loading={submitting} type="submit" variant="primary">提交订单</Button></>}
        onClose={() => { setSelected(null) }}
        open={selected !== null}
        title={selected === null ? '购买套餐' : `购买 ${selected.name}`}
      >
        <form id="billing-order-form" onSubmit={(event) => { void submit(event) }}>
          {formError === null ? null : <div className="form-error" role="alert"><Icon name="alert" size={15} />{formError}</div>}
          <FormGrid>
            <Field htmlFor="billing-cycle" label="计费周期">
              <Select id="billing-cycle" onChange={(event) => { setBillingCycle(event.target.value as BillingCycle) }} value={billingCycle}>
                <option value="monthly">月付</option>
                <option value="annual">年付</option>
              </Select>
            </Field>
            <Field htmlFor="billing-reference" label="支付参考号">
              <Input id="billing-reference" onChange={(event) => { setReference(event.target.value) }} placeholder="选填" value={reference} />
            </Field>
          </FormGrid>
          <div className="order-estimate"><span>订单金额</span><strong>{formatCurrency(estimatedAmount)}</strong><small>以提交时的套餐价格为准</small></div>
        </form>
      </Modal>
    </div>
  )
}
