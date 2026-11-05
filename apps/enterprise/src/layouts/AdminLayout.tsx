import { useEffect, useRef, useState, type ReactNode } from 'react'
import { BrandLockup } from '../components/Brand.tsx'
import { Icon } from '../components/Icon.tsx'
import { Avatar, IconButton } from '../components/ui.tsx'
import { useAuth } from '../lib/auth.tsx'
import { ADMIN_NAVIGATION } from '../lib/navigation.ts'
import { usePreferences } from '../lib/preferences.tsx'
import { Link, navigate, useLocation } from '../lib/router.tsx'

export function AdminLayout({ children }: { children: ReactNode }): ReactNode {
  const { session, can, logout } = useAuth()
  const location = useLocation()
  const preferences = usePreferences()
  const [mobileOpen, setMobileOpen] = useState(false)
  const [userMenuOpen, setUserMenuOpen] = useState(false)
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => {
    const saved = window.localStorage.getItem('enterprise.navGroups')
    return new Set(saved === null ? [] : saved.split(',').filter(Boolean))
  })
  const userMenuRef = useRef<HTMLDivElement>(null)
  const brandName = session?.settings.brandName ?? '织流企业 AI 工作台'
  const resourceTeam = new URLSearchParams(location.search).get('team')

  useEffect(() => {
    setMobileOpen(false)
    setUserMenuOpen(false)
  }, [location.pathname])

  useEffect(() => {
    if (!userMenuOpen) return
    const close = (event: PointerEvent): void => {
      if (event.target instanceof Node && !userMenuRef.current?.contains(event.target)) setUserMenuOpen(false)
    }
    window.addEventListener('pointerdown', close)
    return () => { window.removeEventListener('pointerdown', close) }
  }, [userMenuOpen])

  const toggleGroup = (key: string): void => {
    setCollapsedGroups((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      window.localStorage.setItem('enterprise.navGroups', [...next].join(','))
      return next
    })
  }

  const signOut = async (): Promise<void> => {
    await logout()
    navigate('/enterprise/login', { replace: true })
  }

  const visibleGroups = ADMIN_NAVIGATION
    .map(group => ({
      ...group,
      items: group.items.filter(item => typeof item.permission === 'string'
        ? can(item.permission)
        : item.permission.some(permission => can(permission))),
    }))
    .filter(group => group.items.length > 0)

  return (
    <div className={`admin-shell ${preferences.sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
      {mobileOpen ? <button aria-label="关闭导航" className="mobile-nav-backdrop" onClick={() => { setMobileOpen(false) }} type="button" /> : null}
      <aside className={`admin-sidebar ${mobileOpen ? 'is-mobile-open' : ''}`} aria-label="企业导航">
        <div className="sidebar-brand-row">
          <Link aria-label="返回企业工作台" className="sidebar-brand" to="/enterprise/workspace">
            <BrandLockup name={brandName} />
          </Link>
          <button aria-label="关闭导航" className="sidebar-mobile-close" onClick={() => { setMobileOpen(false) }} type="button">
            <Icon name="close" size={17} />
          </button>
        </div>
        <nav className="admin-sidebar-nav">
          {visibleGroups.map((group) => {
            const groupCollapsed = collapsedGroups.has(group.key) && !preferences.sidebarCollapsed
            return (
              <div className={`nav-group ${groupCollapsed ? 'is-collapsed' : ''}`} key={group.key}>
                {preferences.sidebarCollapsed ? <div className="nav-group-separator" /> : (
                  <button className="nav-group-toggle" onClick={() => { toggleGroup(group.key) }} type="button">
                    <span>{group.label}</span>
                    <Icon className={groupCollapsed ? 'is-rotated' : ''} name="chevron-down" size={13} />
                  </button>
                )}
                {groupCollapsed ? null : (
                  <div className="nav-group-items">
                    {group.items.map((item) => {
                      const active = item.path === '/enterprise/admin'
                        ? location.pathname === item.path
                        : location.pathname === item.path || location.pathname.startsWith(`${item.path}/`)
                      const target = item.path.startsWith('/enterprise/resources/') && resourceTeam !== null
                        ? `${item.path}?team=${encodeURIComponent(resourceTeam)}`
                        : item.path
                      return (
                        <Link
                          aria-label={preferences.sidebarCollapsed ? item.label : undefined}
                          className={`admin-nav-link ${active ? 'is-active' : ''} ${preferences.sidebarCollapsed ? 'is-collapsed' : ''}`}
                          key={item.path}
                          title={preferences.sidebarCollapsed ? item.label : undefined}
                          to={target}
                        >
                          <Icon name={item.icon} size={16} />
                          {preferences.sidebarCollapsed ? <span className="nav-short-label">{item.shortLabel}</span> : <span>{item.label}</span>}
                        </Link>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </nav>
        <div className="sidebar-footer">
          <button
            aria-label={preferences.sidebarCollapsed ? '展开侧栏' : '收起侧栏'}
            className="collapse-button"
            onClick={() => { preferences.setSidebarCollapsed(!preferences.sidebarCollapsed) }}
            title={preferences.sidebarCollapsed ? '展开侧栏' : '收起侧栏'}
            type="button"
          >
            <Icon name={preferences.sidebarCollapsed ? 'panel-open' : 'panel-close'} size={16} />
            {preferences.sidebarCollapsed ? null : <span>收起侧栏</span>}
          </button>
        </div>
      </aside>

      <div className="admin-main">
        <header className="admin-topbar">
          <div className="topbar-leading">
            <button aria-label="打开导航" className="mobile-menu-button" onClick={() => { setMobileOpen(true) }} type="button">
              <Icon name="menu" size={18} />
            </button>
            <div className="topbar-context">
              <span className="topbar-context-label">企业控制台</span>
              <span className="runtime-pill"><span className="signal-dot" />租户隔离</span>
            </div>
          </div>
          <div className="topbar-actions">
            <IconButton
              icon={preferences.theme === 'dark' ? 'sun' : 'moon'}
              label={preferences.theme === 'dark' ? '切换浅色主题' : '切换深色主题'}
              onClick={preferences.toggleTheme}
            />
            <IconButton
              icon="activity"
              label={preferences.density === 'compact' ? '切换舒适密度' : '切换紧凑密度'}
              onClick={preferences.toggleDensity}
            />
            <div className="user-menu-wrap" ref={userMenuRef}>
              <button
                aria-expanded={userMenuOpen}
                className="user-menu-trigger"
                onClick={() => { setUserMenuOpen(current => !current) }}
                type="button"
              >
                <Avatar name={session?.user.name ?? '管理员'} presence size={24} />
                <span className="user-menu-copy">
                  <strong>{session?.user.name}</strong>
                  <small>{session?.user.roleName}</small>
                </span>
                <Icon name="chevron-down" size={13} />
              </button>
              {userMenuOpen ? (
                <div className="user-menu-popover">
                  <div className="user-menu-profile">
                    <Avatar name={session?.user.name ?? '管理员'} presence size={32} />
                    <div><strong>{session?.user.name}</strong><span>{session?.user.email}</span></div>
                  </div>
                  <div className="user-menu-separator" />
                  <Link className="user-menu-item" to="/enterprise/workspace"><Icon name="workspace" size={15} />AI 工作台</Link>
                  <Link className="user-menu-item" to="/enterprise/account"><Icon name="lock" size={15} />修改密码</Link>
                  {can('settings.read') ? <Link className="user-menu-item" to="/enterprise/admin/settings"><Icon name="settings" size={15} />系统设置</Link> : null}
                  <button className="user-menu-item is-danger" onClick={() => { void signOut() }} type="button"><Icon name="arrow-left" size={15} />退出登录</button>
                </div>
              ) : null}
            </div>
          </div>
        </header>
        <main className="admin-content">{children}</main>
      </div>
    </div>
  )
}
