import { useEffect, useState, type ReactNode } from 'react'
import { Icon, type IconName } from '../components/Icon.tsx'
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorPanel,
  PageHeader,
  PageLoader,
  SectionTitle,
} from '../components/ui.tsx'
import { api } from '../lib/api.ts'
import { formatCompactNumber, formatCurrency, formatDate, formatDay, formatNumber } from '../lib/format.ts'
import type { Dashboard } from '../lib/types.ts'

function StatCard({ icon, label, value, change, tone = 'default' }: {
  icon: IconName
  label: string
  value: string
  change: string
  tone?: 'default' | 'accent' | 'warm'
}): ReactNode {
  return (
    <Card className={`stat-card stat-${tone}`} padded={false}>
      <div className="stat-card-top"><span className="stat-icon"><Icon name={icon} size={17} /></span><span className="stat-kicker">{label}</span></div>
      <strong className="stat-value">{value}</strong>
      <span className="stat-change">{change}</span>
    </Card>
  )
}

function UsageChart({ dashboard }: { dashboard: Dashboard }): ReactNode {
  const points = dashboard.usageByDay.slice(-30)
  const max = Math.max(1, ...points.map(point => point.requests))
  if (dashboard.stats.requests === 0) {
    return <EmptyState icon="usage" title="尚无用量记录" description="模型请求回传到企业用量账本后，这里会展示请求趋势与成本。" />
  }
  return (
    <div className="usage-chart">
      <div className="chart-y-axis"><span>{formatCompactNumber(max)}</span><span>{formatCompactNumber(max / 2)}</span><span>0</span></div>
      <div className="chart-plot">
        <div className="chart-grid-lines" aria-hidden="true"><span /><span /><span /></div>
        <div className="chart-bars">
          {points.map((point) => {
            const height = Math.max(2, (point.requests / max) * 100)
            return (
              <div className="chart-column" key={point.date} title={`${point.date} · ${formatNumber(point.requests)} 次请求 · ${formatCurrency(point.costCents)}`}>
                <span className="chart-bar" style={{ height: `${String(height)}%` }} />
                <small>{formatDay(point.date)}</small>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

const ACTION_LABELS: Record<string, string> = {
  'auth.login': '登录',
  'auth.logout': '退出',
  'auth.password_change': '修改密码',
  'workspace.launch': '启动工作台',
  'user.create': '创建用户',
  'user.update': '更新用户',
  'user.delete': '删除用户',
  'team.create': '创建团队',
  'team.update': '更新团队',
  'team.delete': '删除团队',
  'role.create': '创建角色',
  'role.update': '更新角色',
  'role.delete': '删除角色',
  'plan.create': '创建套餐',
  'plan.update': '更新套餐',
  'plan.delete': '删除套餐',
  'order.create': '创建订单',
  'order.approve': '确认订单',
  'order.reject': '拒绝订单',
  'channel.create': '创建渠道',
  'channel.update': '更新渠道',
  'channel.delete': '删除渠道',
  'model.create': '创建模型',
  'model.update': '更新模型',
  'model.delete': '删除模型',
  'usage.record': '记录用量',
  'settings.update': '更新设置',
  'system.bootstrap': '系统初始化',
}

export function DashboardPage(): ReactNode {
  const [dashboard, setDashboard] = useState<Dashboard | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const load = (): void => {
    setLoading(true)
    setError(null)
    void api.dashboard().then(setDashboard).catch((caught: unknown) => {
      setError(caught instanceof Error ? caught.message : '无法读取运行总览')
    }).finally(() => { setLoading(false) })
  }

  useEffect(load, [])

  if (loading && dashboard === null) return <PageLoader label="正在汇总企业运行数据…" />
  if (error !== null && dashboard === null) return <ErrorPanel message={error} onRetry={load} />
  if (dashboard === null) return null
  const totalModelRequests = Math.max(1, dashboard.modelUsage.reduce((total, item) => total + item.requests, 0))

  return (
    <div className="admin-page">
      <PageHeader
        description="聚合组织、用量、模型供给与商业化状态。"
        group="运营监控"
        title="运行总览"
        actions={<><Button icon="activity" onClick={load} size="small">刷新数据</Button><Button icon="arrow-right" onClick={() => { window.location.assign('/enterprise/api/harness/launch') }} size="small" variant="primary">进入工作台</Button></>}
      />

      <div className="stat-grid">
        <StatCard icon="users" label="组织成员" value={formatNumber(dashboard.stats.users)} change={`${String(dashboard.stats.activeUsers)} 位成员处于启用状态`} />
        <StatCard icon="plans" label="月度经常性收入" tone="accent" value={formatCurrency(dashboard.stats.monthlyRecurringRevenueCents)} change={`${String(dashboard.stats.teams)} 个团队纳入计费`} />
        <StatCard icon="usage" label="近 30 天请求" tone="warm" value={formatCompactNumber(dashboard.stats.requests)} change={`${formatCompactNumber(dashboard.stats.inputTokens + dashboard.stats.outputTokens)} Tokens 已计量`} />
        <StatCard icon="channels" label="模型供给" value={String(dashboard.stats.models)} change={`${String(dashboard.stats.channels)} 个渠道 · ${String(dashboard.stats.pendingOrders)} 笔订单待处理`} />
      </div>

      <div className="dashboard-grid dashboard-grid-main">
        <Card className="chart-card">
          <SectionTitle
            description="最近 30 天模型请求量"
            title="请求趋势"
            actions={<span className="chart-total"><strong>{formatCompactNumber(dashboard.stats.requests)}</strong><small>请求</small></span>}
          />
          <UsageChart dashboard={dashboard} />
          <div className="chart-legend-row">
            <span><i className="legend-dot legend-primary" />请求量</span>
            <span><Icon name="activity" size={13} />成本 {formatCurrency(dashboard.stats.costCents)}</span>
          </div>
        </Card>

        <Card className="health-card">
          <SectionTitle description="当前部署与治理状态" title="系统状态" />
          <div className="health-score">
            <span className="health-ring"><strong>OK</strong></span>
            <div><h3>企业控制面正常</h3><p>身份、权限、持久化与审计服务运行中。</p></div>
          </div>
          <div className="health-list">
            <div><span><i className="signal-dot" />管理 API</span><strong>在线</strong></div>
            <div><span><i className="signal-dot" />持久化存储</span><strong>已连接</strong></div>
            <div><span><i className="signal-dot" />Harness 入口</span><strong>受保护</strong></div>
            <div><span><i className="signal-dot" />租户进程隔离</span><Badge tone="success">已启用</Badge></div>
          </div>
          <div className="health-note"><Icon name="shield" size={15} /><span>所有管理写操作均写入审计日志。</span></div>
        </Card>
      </div>

      <div className="dashboard-grid dashboard-grid-secondary">
        <Card>
          <SectionTitle description="按请求量排序" title="模型使用分布" actions={<Badge tone="neutral">{String(dashboard.modelUsage.length)} 个模型</Badge>} />
          {dashboard.modelUsage.length === 0 ? (
            <EmptyState icon="models" title="暂无模型用量" description="模型渠道完成计量回传后会自动出现在这里。" />
          ) : (
            <div className="distribution-list">
              {dashboard.modelUsage.slice(0, 5).map((item, index) => (
                <div className="distribution-row" key={item.modelId}>
                  <span className="distribution-rank">{String(index + 1).padStart(2, '0')}</span>
                  <div className="distribution-main">
                    <div><strong>{item.modelName}</strong><span>{formatCompactNumber(item.tokens)} Tokens</span></div>
                    <div className="progress-track"><span style={{ width: `${String((item.requests / totalModelRequests) * 100)}%` }} /></div>
                  </div>
                  <div className="distribution-value"><strong>{formatCompactNumber(item.requests)}</strong><span>{formatCurrency(item.costCents)}</span></div>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card>
          <SectionTitle description="跨团队计量排行" title="团队用量" actions={<Badge tone="neutral">{String(dashboard.teamUsage.length)} 个团队</Badge>} />
          {dashboard.teamUsage.length === 0 ? (
            <EmptyState icon="teams" title="暂无团队用量" description="用量按团队归属后，这里会显示内部成本分布。" />
          ) : (
            <div className="team-usage-list">
              {dashboard.teamUsage.slice(0, 6).map(item => (
                <div key={item.teamId}>
                  <span>{item.teamName}</span>
                  <strong>{formatCompactNumber(item.requests)} <small>请求</small></strong>
                  <em>{formatCurrency(item.costCents)}</em>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <Card className="recent-audit-card">
        <SectionTitle description="最近的管理与安全事件" title="最新审计动态" actions={<a className="text-link" href="/enterprise/admin/audit">查看全部 <Icon name="arrow-right" size={13} /></a>} />
        {dashboard.recentAudit.length === 0 ? (
          <EmptyState icon="audit" title="暂无审计记录" description="管理员操作与登录事件会自动记录在这里。" />
        ) : (
          <div className="audit-feed">
            {dashboard.recentAudit.map(record => (
              <div className="audit-feed-row" key={record.id}>
                <span className="audit-feed-icon"><Icon name="audit" size={15} /></span>
                <div className="audit-feed-copy"><p>{record.summary}</p><span>{record.actorEmail} · {formatDate(record.createdAt)}</span></div>
                <Badge tone="neutral">{ACTION_LABELS[record.action] ?? record.action}</Badge>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}
