import { publicPath } from './lib/public-path.ts'
import { useEffect, useState, type ReactNode } from 'react'
import { BrandMark } from './components/Brand.tsx'
import { Icon } from './components/Icon.tsx'
import { Button, Spinner } from './components/ui.tsx'
import { ToastProvider } from './components/Toast.tsx'
import { AdminLayout } from './layouts/AdminLayout.tsx'
import { AuthProvider, useAuth } from './lib/auth.tsx'
import { PreferencesProvider } from './lib/preferences.tsx'
import { Link, navigate, RouterProvider, useLocation } from './lib/router.tsx'
import { AccountPage } from './pages/AccountPage.tsx'
import { MarketPage } from './pages/MarketPage.tsx'
import { AgentAdminPage } from './pages/AgentAdminPage.tsx'
import { AuditPage } from './pages/AuditPage.tsx'
import { BillingPage } from './pages/BillingPage.tsx'
import { ChannelsPage } from './pages/ChannelsPage.tsx'
import { DashboardPage } from './pages/DashboardPage.tsx'
import { FilesPage } from './pages/FilesPage.tsx'
import { KnowledgePage } from './pages/KnowledgePage.tsx'
import { LoginPage } from './pages/LoginPage.tsx'
import { OrdersPage } from './pages/OrdersPage.tsx'
import { PlansPage } from './pages/PlansPage.tsx'
import { PluginsPage } from './pages/PluginsPage.tsx'
import { RolesPage } from './pages/RolesPage.tsx'
import { SettingsPage } from './pages/SettingsPage.tsx'
import { SkillsPage } from './pages/SkillsPage.tsx'
import { TeamsPage } from './pages/TeamsPage.tsx'
import { UsagePage } from './pages/UsagePage.tsx'
import { UsersPage } from './pages/UsersPage.tsx'

const LAUNCH_URL = publicPath('/enterprise/api/harness/launch')
const LAUNCH_STATUS_URL = publicPath('/enterprise/api/harness/status')

const ADMIN_PERMISSIONS: Record<string, string | readonly string[]> = {
  '/enterprise/admin': 'dashboard.read',
  '/enterprise/admin/agents': 'settings.write',
  '/enterprise/admin/users': 'users.read',
  '/enterprise/admin/teams': 'teams.read',
  '/enterprise/admin/roles': 'roles.read',
  '/enterprise/admin/plugins': ['plugins.builtin.write', 'plugins.enterprise.write'],
  '/enterprise/admin/plans': 'plans.read',
  '/enterprise/admin/orders': 'orders.read',
  '/enterprise/admin/channels': 'channels.read',
  '/enterprise/admin/models': 'models.read',
  '/enterprise/admin/usage': 'usage.read',
  '/enterprise/admin/audit': 'audit.read',
  '/enterprise/admin/settings': 'settings.read',
}

const RESOURCE_ROUTES = new Set([
  '/enterprise/resources/files',
  '/enterprise/resources/knowledge',
  '/enterprise/resources/skills',
])

function BootScreen(): ReactNode {
  return (
    <div className="boot-screen">
      <BrandMark size={32} />
      <div><Spinner size={18} /><span>正在进入 AI 工作台…</span></div>
    </div>
  )
}

interface LaunchStatus {
  readonly state: 'starting' | 'ready' | 'stopped' | 'failed'
  readonly elapsedMs?: number
  readonly message?: string
  readonly readyUrl?: string
}

const LAUNCH_POLL_MILLISECONDS = 1_200

function launchStage(elapsedMs: number): string {
  if (elapsedMs < 3_000) return '正在唤醒团队工作台…'
  if (elapsedMs < 12_000) return '正在加载插件与技能…'
  if (elapsedMs < 30_000) return '正在恢复工作区与知识库…'
  return '正在做最后的准备…'
}

function launchProgress(elapsedMs: number): number {
  const ratio = 1 - Math.exp(-elapsedMs / 9_000)
  return Math.min(92, Math.round(ratio * 100))
}

/** Progress screen shown while the team container boots, instead of a blank redirect. */
function LaunchScreen(): ReactNode {
  const [elapsedMs, setElapsedMs] = useState(0)
  const [failure, setFailure] = useState<string>()

  useEffect(() => {
    const controller = new AbortController()
    const { signal } = controller
    const stopped = (): boolean => signal.aborted
    let pollTimer: number | undefined
    const startedAt = Date.now()
    const clock = window.setInterval(() => { setElapsedMs(Date.now() - startedAt) }, 400)

    const kick = async (): Promise<void> => {
      try {
        const response = await fetch(`${LAUNCH_URL}?wait=0`, {
          credentials: 'same-origin',
          cache: 'no-store',
          headers: { accept: 'application/json' },
          signal,
        })
        if (stopped()) return
        if (response.status === 401) window.location.replace(publicPath('/enterprise/login?next=%2Fenterprise%2Fworkspace'))
      } catch { /* the poll loop retries */ }
    }

    const poll = async (): Promise<void> => {
      try {
        const response = await fetch(LAUNCH_STATUS_URL, {
          credentials: 'same-origin',
          cache: 'no-store',
          headers: { accept: 'application/json' },
          signal,
        })
        if (stopped()) return
        if (response.status === 401) {
          window.location.replace(publicPath('/enterprise/login?next=%2Fenterprise%2Fworkspace'))
          return
        }
        const status = await response.json() as LaunchStatus & { readonly error?: { readonly message?: string } }
        if (stopped()) return
        if (!response.ok) {
          setFailure(status.error?.message ?? '团队工作台启动失败，请稍后重试')
          return
        }
        if (status.state === 'ready' && status.readyUrl !== undefined) {
          window.location.replace(status.readyUrl)
          return
        }
        if (status.state === 'failed') {
          setFailure(status.message ?? '团队工作台启动失败，请稍后重试')
          return
        }
        if (status.state === 'stopped') await kick()
      } catch { /* transient network error or abort; keep polling */ }
      if (stopped()) return
      pollTimer = window.setTimeout(() => { void poll() }, LAUNCH_POLL_MILLISECONDS)
    }

    void (async () => {
      await kick()
      if (!stopped()) await poll()
    })()

    return () => {
      controller.abort()
      window.clearInterval(clock)
      if (pollTimer !== undefined) window.clearTimeout(pollTimer)
    }
  }, [])

  if (failure !== undefined) {
    return (
      <div className="boot-screen launch-screen" role="alert">
        <BrandMark size={32} />
        <div className="launch-copy">
          <strong>工作台暂时没有启动起来</strong>
          <p>{failure}</p>
        </div>
        <Button variant="primary" onClick={() => { window.location.reload() }}>重新加载</Button>
      </div>
    )
  }

  return (
    <div className="boot-screen launch-screen" role="status" aria-live="polite" aria-busy="true">
      <BrandMark size={32} />
      <div className="launch-copy">
        <strong>{launchStage(elapsedMs)}</strong>
        <p>
          已等待 {Math.floor(elapsedMs / 1000)} 秒 · 首次进入约需 20–60 秒，之后会快很多
          <br />请保持页面打开，不要刷新
        </p>
      </div>
      <div className="launch-track" aria-hidden="true">
        <span style={{ width: `${String(launchProgress(elapsedMs))}%` }} />
      </div>
    </div>
  )
}

function AccessDenied(): ReactNode {
  return (
    <div className="admin-page">
      <div className="access-denied">
        <span><Icon name="shield" size={26} /></span>
        <h1>当前角色无权访问</h1>
        <p>该页面需要额外的企业权限。请联系企业所有者调整你的角色。</p>
        <div><Link className="button button-secondary button-default" to="/enterprise/workspace"><Icon name="arrow-left" size={15} /><span>返回工作台</span></Link></div>
      </div>
    </div>
  )
}

function AdminPage({ pathname }: { pathname: string }): ReactNode {
  switch (pathname) {
    case '/enterprise/admin/agents': return <AgentAdminPage />
    case '/enterprise/admin': return <DashboardPage />
    case '/enterprise/admin/users': return <UsersPage />
    case '/enterprise/admin/teams': return <TeamsPage />
    case '/enterprise/admin/roles': return <RolesPage />
    case '/enterprise/admin/plugins': return <PluginsPage />
    case '/enterprise/admin/plans': return <PlansPage />
    case '/enterprise/admin/orders': return <OrdersPage />
    case '/enterprise/admin/channels': return <ChannelsPage initialTab="channels" />
    case '/enterprise/admin/models': return <ChannelsPage initialTab="models" />
    case '/enterprise/admin/usage': return <UsagePage />
    case '/enterprise/admin/audit': return <AuditPage />
    case '/enterprise/admin/settings': return <SettingsPage />
    default: return <AccessDenied />
  }
}

function ResourcePage({ pathname }: { pathname: string }): ReactNode {
  switch (pathname) {
    case '/enterprise/resources/files': return <FilesPage />
    case '/enterprise/resources/knowledge': return <KnowledgePage />
    case '/enterprise/resources/skills': return <SkillsPage />
    default: return <NotFound />
  }
}

function NotFound(): ReactNode {
  return (
    <div className="not-found">
      <span>404</span>
      <h1>页面不存在</h1>
      <p>链接可能已失效，或你没有进入当前模块。</p>
      <Button icon="arrow-left" onClick={() => { navigate('/enterprise/workspace', { replace: true }) }} variant="primary">返回工作台</Button>
    </div>
  )
}

function Routes(): ReactNode {
  const { session, loading, can, canAny } = useAuth()
  const location = useLocation()
  const isLogin = location.pathname === '/enterprise/login'
  const isLaunchGate = location.pathname === '/'
    || location.pathname === '/enterprise'
    || location.pathname === '/enterprise/'
    || location.pathname === '/enterprise/workspace'
  const pathname = location.pathname.replace(/\/$/u, '')
  const isAdmin = pathname === '/enterprise/admin' || pathname.startsWith('/enterprise/admin/')
  const isResource = RESOURCE_ROUTES.has(pathname)
  const isAccount = pathname === '/enterprise/account'
  const isBilling = pathname === '/enterprise/billing'

  useEffect(() => {
    if (loading || isLogin) return
    if (session === null) {
      const next = `${location.pathname}${location.search}`
      navigate(`/enterprise/login?next=${encodeURIComponent(next)}`, { replace: true })
    }
  }, [isLogin, loading, location.pathname, location.search, session])

  if (loading) return <BootScreen />
  if (isLogin) return <LoginPage />
  if (session === null) return <BootScreen />
  if (isLaunchGate) return <LaunchScreen />
  if (pathname === '/enterprise/agents') return can('workspace.use') ? <MarketPage /> : <AccessDenied />
  if (isAccount) return <AdminLayout><AccountPage /></AdminLayout>
  if (isBilling) {
    if (!can('workspace.use')) return <AdminLayout><AccessDenied /></AdminLayout>
    return <AdminLayout><BillingPage /></AdminLayout>
  }
  if (isAdmin) {
    const permission = ADMIN_PERMISSIONS[pathname]
    if (permission === undefined) return <NotFound />
    if (typeof permission === 'string' ? !can(permission) : !canAny(permission)) return <AdminLayout><AccessDenied /></AdminLayout>
    return <AdminLayout><AdminPage pathname={pathname} /></AdminLayout>
  }
  if (isResource) {
    if (!can('workspace.use')) return <AdminLayout><AccessDenied /></AdminLayout>
    return <AdminLayout><ResourcePage pathname={pathname} /></AdminLayout>
  }
  return <NotFound />
}

export function App(): ReactNode {
  return (
    <RouterProvider>
      <PreferencesProvider>
        <ToastProvider>
          <AuthProvider>
            <Routes />
          </AuthProvider>
        </ToastProvider>
      </PreferencesProvider>
    </RouterProvider>
  )
}
