import { publicPath } from './lib/public-path.ts'
import { useEffect, type ReactNode } from 'react'
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
import { FeilianPage } from './pages/FeilianPage.tsx'
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
    if (isLaunchGate) {
      window.location.replace(LAUNCH_URL)
      return
    }
    if (session === null) {
      const next = `${location.pathname}${location.search}`
      navigate(`/enterprise/login?next=${encodeURIComponent(next)}`, { replace: true })
    }
  }, [isLaunchGate, isLogin, loading, location.pathname, location.search, session])

  if (loading) return <BootScreen />
  if (isLogin) return <LoginPage />
  if (isLaunchGate) return <BootScreen />
  if (session === null) return <BootScreen />
  if (pathname === '/enterprise/feilian') return can('workspace.use') ? <FeilianPage /> : <AccessDenied />
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
