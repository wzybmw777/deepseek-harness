export function formatCurrency(cents: number): string {
  return new Intl.NumberFormat('zh-CN', {
    style: 'currency',
    currency: 'CNY',
    maximumFractionDigits: 2,
  }).format(cents / 100)
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 0 }).format(value)
}

export function formatCompactNumber(value: number): string {
  return new Intl.NumberFormat('zh-CN', { notation: 'compact', maximumFractionDigits: 1 }).format(value)
}

export function formatDate(value: string | undefined, includeTime = true): string {
  if (value === undefined) return '—'
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return '—'
  return new Intl.DateTimeFormat('zh-CN', includeTime ? {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  } : {
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(date)
}

export function formatDay(value: string): string {
  const date = new Date(`${value}T00:00:00`)
  return new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit' }).format(date)
}

export function formatRelative(value: string | undefined): string {
  if (value === undefined) return '从未登录'
  const elapsed = Date.now() - Date.parse(value)
  if (!Number.isFinite(elapsed) || elapsed < 0) return formatDate(value)
  const minutes = Math.floor(elapsed / 60_000)
  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${String(minutes)} 分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${String(hours)} 小时前`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${String(days)} 天前`
  return formatDate(value, false)
}

export function formatPricePerMillion(cents: number): string {
  return `${formatCurrency(cents)} / 百万 Token`
}

export function initials(name: string): string {
  const trimmed = name.trim()
  if (trimmed === '') return '企'
  return /^[A-Za-z]/u.test(trimmed)
    ? [...trimmed].slice(0, 2).join('').toUpperCase()
    : ([...trimmed][0] ?? '企').toUpperCase()
}

export function downloadText(filename: string, contents: string, type = 'text/csv;charset=utf-8'): void {
  const blob = new Blob([contents], { type })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}
