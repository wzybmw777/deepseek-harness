import { useEffect, useState, type ReactNode } from 'react'
import { Icon } from '../components/Icon.tsx'
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorPanel,
  Input,
  PageHeader,
  PageLoader,
  SearchField,
  Select,
  TableFrame,
} from '../components/ui.tsx'
import { api } from '../lib/api.ts'
import { auditActionLabel, auditTone } from '../lib/audit.ts'
import { downloadText, formatDate } from '../lib/format.ts'
import type { Audit } from '../lib/types.ts'

export function AuditPage(): ReactNode {
  const [records, setRecords] = useState<Audit[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [action, setAction] = useState('all')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')

  const load = (): void => {
    setLoading(true)
    setError(null)
    void api.audit({ limit: 1000 }).then(setRecords).catch((caught: unknown) => {
      setError(caught instanceof Error ? caught.message : '无法读取审计日志')
    }).finally(() => { setLoading(false) })
  }

  useEffect(load, [])

  const filtered = records.filter((record) => {
    const term = search.trim().toLowerCase()
    const matchesSearch = term === '' || record.actorEmail.toLowerCase().includes(term) || record.summary.toLowerCase().includes(term) || record.ip.includes(term)
    const matchesAction = action === 'all' || record.action === action
    const time = Date.parse(record.createdAt)
    const after = fromDate === '' || time >= Date.parse(`${fromDate}T00:00:00`)
    const before = toDate === '' || time <= Date.parse(`${toDate}T23:59:59.999`)
    return matchesSearch && matchesAction && after && before
  })
  const actions = [...new Set(records.map(record => record.action))].sort()

  const exportCsv = (): void => {
    const rows = [
      ['时间', '操作者', '操作', '对象类型', '对象 ID', '摘要', 'IP', '元数据'],
      ...filtered.map(record => [
        record.createdAt,
        record.actorEmail,
        auditActionLabel(record.action),
        record.targetType,
        record.targetId ?? '',
        record.summary,
        record.ip,
        record.metadata === undefined ? '' : JSON.stringify(record.metadata),
      ]),
    ]
    const csv = rows.map(row => row.map(cell => `"${cell.replaceAll('"', '""')}"`).join(',')).join('\n')
    downloadText(`enterprise-audit-${new Date().toISOString().slice(0, 10)}.csv`, `\ufeff${csv}`)
  }

  if (loading) return <PageLoader label="正在加载审计日志…" />
  if (error !== null) return <ErrorPanel message={error} onRetry={load} />

  return (
    <div className="admin-page">
      <PageHeader
        description="追踪登录、权限变更、计费、模型供给与工作台访问。"
        group="安全与治理"
        title="审计日志"
        actions={<><Button icon="download" onClick={exportCsv} size="small">导出 CSV</Button><Button icon="activity" onClick={load} size="small">刷新</Button></>}
      />
      <div className="audit-summary-row">
        <div><span>日志总量</span><strong>{records.length}</strong></div>
        <div><span>登录事件</span><strong>{records.filter(record => record.action.startsWith('auth.')).length}</strong></div>
        <div><span>管理变更</span><strong>{records.filter(record => !record.action.startsWith('auth.') && record.action !== 'workspace.launch').length}</strong></div>
        <div><span>工作台访问</span><strong>{records.filter(record => record.action === 'workspace.launch').length}</strong></div>
      </div>
      <Card className="table-card" padded={false}>
        <div className="table-toolbar audit-toolbar">
          <div className="table-toolbar-leading">
            <SearchField onChange={setSearch} placeholder="搜索操作者、摘要或 IP" value={search} />
            <Select aria-label="按操作类型筛选" onChange={(event) => { setAction(event.target.value) }} value={action}>
              <option value="all">全部操作</option>
              {actions.map(item => <option key={item} value={item}>{auditActionLabel(item)}</option>)}
            </Select>
            <Input aria-label="开始日期" onChange={(event) => { setFromDate(event.target.value) }} type="date" value={fromDate} />
            <span className="date-separator">至</span>
            <Input aria-label="结束日期" onChange={(event) => { setToDate(event.target.value) }} type="date" value={toDate} />
          </div>
          <span className="table-count">{filtered.length} 条记录</span>
        </div>
        <TableFrame>
          {filtered.length === 0 ? (
            <EmptyState icon="audit" title="没有匹配的审计记录" description="尝试调整搜索条件或时间范围。" />
          ) : (
            <div className="table-scroll">
              <table className="data-table audit-table">
                <thead><tr><th>时间</th><th>操作者</th><th>操作</th><th>摘要</th><th>对象</th><th>来源 IP</th><th aria-label="详情" /></tr></thead>
                <tbody>
                  {filtered.map(record => (
                    <tr key={record.id}>
                      <td><span className="cell-secondary cell-nowrap">{formatDate(record.createdAt)}</span></td>
                      <td><div className="audit-actor"><span className="actor-dot" /><span>{record.actorEmail}</span></div></td>
                      <td><Badge tone={auditTone(record.action)}>{auditActionLabel(record.action)}</Badge></td>
                      <td><span className="audit-summary-cell">{record.summary}</span></td>
                      <td><div className="audit-target"><span>{record.targetType}</span>{record.targetId === undefined ? null : <code>{record.targetId.slice(0, 10)}</code>}</div></td>
                      <td><code className="ip-code">{record.ip}</code></td>
                      <td>{record.metadata === undefined ? <span className="muted">—</span> : <details className="metadata-details"><summary><Icon name="chevron-right" size={13} />详情</summary><pre>{JSON.stringify(record.metadata, null, 2)}</pre></details>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </TableFrame>
      </Card>
    </div>
  )
}
