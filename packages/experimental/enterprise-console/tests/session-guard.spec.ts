import { JSDOM } from 'jsdom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { HARNESS_SESSION_GUARD_SCRIPT, createHarnessSessionGuardScript } from '../src/session-guard.ts'

const OWNER_SESSION = {
  user: {
    name: '企业管理员',
    email: 'admin@echoai.best',
    roleName: '所有者',
  },
  permissions: ['workspace.use', 'dashboard.read', 'users.write'],
  settings: { supportEmail: 'support@echoai.best' },
  runtime: { tenant: { name: '默认团队' } },
}

const BILLING = {
  team: { id: 'team-default', name: '默认团队', slug: 'default', status: 'active', seatLimit: 10, memberCount: 3 },
  plan: { id: 'plan-starter', name: '团队版' },
  cycle: { startsAt: '2026-11-01T00:00:00.000Z', endsAt: '2026-12-01T00:00:00.000Z' },
  quota: {
    totalTokens: 5_000_000,
    usedTokens: 1_250_000,
    remainingTokens: 3_750_000,
    userTokens: 125_000,
    requests: 120,
    userRequests: 12,
    costCents: 3900,
    percentUsed: 25,
  },
  plans: [],
  orders: [],
  canPurchase: true,
}

const opened: JSDOM[] = []

afterEach(() => {
  for (const dom of opened.splice(0)) dom.window.close()
})

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input
  return input instanceof URL ? input.href : input.url
}

function harnessPage(session: unknown, billing: unknown = BILLING, publicPathPrefix = '') {
  const dom = new JSDOM(`<!doctype html><html><head><title>DSH Local Build</title></head><body>
    <div data-slot="sidebar.brand.mark"><svg data-whale="sidebar"></svg></div>
    <div data-slot="sidebar.brand.name"><span data-copy-version="true"><span class="localBuildTitle">DSH 本地构建</span><span class="buildVersion">0.2.2</span></span></div>
    <div data-slot="conversation.hero.brand.mark"><svg data-whale="hero"></svg></div>
    <nav class="panelList" aria-label="全局面板"><button type="button"><div data-slot="sidebar.panellist"></div></button></nav>
    <div class="heroOptions" data-hero-options>
      <span data-slot="conversation.hero.options"></span>
    </div>
    <div class="sessionHeader" data-session-header>
      <span data-slot="conversation.session.header.utilities"></span>
    </div>
    <div data-dsh-enterprise-settings-row>
      <div data-slot="settings.launcher">
        <button type="button" data-collapsed="false" aria-haspopup="menu">More</button>
      </div>
    </div>
  </body></html>`, { url: 'https://enterprise.test/t/acme/harness/', runScripts: 'outside-only' })
  opened.push(dom)
  const fetch = vi.fn(async (input: RequestInfo | URL) => new Response(
    JSON.stringify(requestUrl(input).includes('/billing') ? billing : session),
    {
      status: 200,
      headers: { 'content-type': 'application/json' },
    },
  ))
  dom.window.fetch = fetch
  dom.window.setInterval = vi.fn(() => 1) as typeof dom.window.setInterval
  dom.window.eval(publicPathPrefix === '' ? HARNESS_SESSION_GUARD_SCRIPT : createHarnessSessionGuardScript(publicPathPrefix))
  return { dom, fetch }
}

describe('enterprise session guard', () => {
  it('keeps session, billing, browser, and account links inside a public subpath', async () => {
    const { dom, fetch } = harnessPage(OWNER_SESSION, BILLING, '/preview')
    await vi.waitFor(() => {
      expect(dom.window.document.querySelector('[data-dsh-enterprise-account]')).not.toBeNull()
      expect(fetch).toHaveBeenCalledWith('/preview/enterprise/api/billing', expect.objectContaining({ credentials: 'same-origin' }))
    })
    expect(fetch).toHaveBeenCalledWith('/preview/enterprise/api/session', expect.objectContaining({ credentials: 'same-origin' }))
    expect(fetch).toHaveBeenCalledWith('/preview/enterprise/api/billing', expect.objectContaining({ credentials: 'same-origin' }))
    expect(dom.window).toHaveProperty('__DSH_SIDEBAR_BROWSER_REMOTE__', { endpoint: '/preview/enterprise/api/browser' })
    const links = [...dom.window.document.querySelectorAll<HTMLAnchorElement>('a[href]')]
    expect(links.length).toBeGreaterThan(0)
    expect(links.every(link => link.getAttribute('href')?.startsWith('/preview/'))).toBe(true)
  })

  it('renders the enterprise account card and its administration menu', async () => {
    const { dom, fetch } = harnessPage(OWNER_SESSION)
    const document = dom.window.document

    await vi.waitFor(() => {
      expect(document.querySelector<HTMLElement>('[data-dsh-enterprise-account]')?.hidden).toBe(false)
    })

    expect(fetch).toHaveBeenCalledWith('/enterprise/api/session', expect.objectContaining({ credentials: 'same-origin' }))
    expect(fetch).toHaveBeenCalledWith('/enterprise/api/billing', expect.objectContaining({ credentials: 'same-origin' }))
    expect(dom.window).toHaveProperty('__DSH_SIDEBAR_BROWSER_REMOTE__', { endpoint: '/enterprise/api/browser' })
    expect(document.title).toBe('织流')
    document.title = '问候 — DSH Local Build'
    await vi.waitFor(() => { expect(document.title).toBe('问候 — 织流') })
    expect(document.querySelector('[data-slot="sidebar.brand.name"]')?.textContent).toBe('织流0.2.2')
    const version = document.querySelector<HTMLElement>('[data-slot="sidebar.brand.name"] [class*="buildVersion"]')
    expect(version).not.toBeNull()
    expect(dom.window.getComputedStyle(version as HTMLElement).display).toBe('none')
    const brandName = document.querySelector<HTMLElement>('[data-slot="sidebar.brand.name"] [class*="localBuildTitle"]')
    expect(brandName).not.toBeNull()
    expect(dom.window.getComputedStyle(brandName as HTMLElement).fontSize).toBe('20px')
    expect(document.querySelector('[data-slot="sidebar.brand.mark"] [data-dsh-enterprise-brand-mark]')).not.toBeNull()
    expect(document.querySelector('[data-slot="conversation.hero.brand.mark"] [data-dsh-enterprise-brand-mark]')).not.toBeNull()
    expect(document.querySelector('[data-whale]')).toBeNull()
    expect(document.querySelector('link[rel="icon"]')?.getAttribute('href')).toBe('/enterprise/favicon.svg')
    const resources = document.querySelector<HTMLElement>('[data-dsh-enterprise-resources]')
    expect(resources).not.toBeNull()
    expect(resources?.parentElement).toBe(document.querySelector('[aria-label="全局面板"]'))
    expect(resources?.previousElementSibling?.tagName).toBe('BUTTON')
    expect([...resources?.querySelectorAll('[data-enterprise-resource]') ?? []].map(row => row.textContent)).toEqual([
      '文件',
      '知识库',
      '智能体',
    ])
    expect([...resources?.querySelectorAll('[data-enterprise-resource] use') ?? []].map(use => use.getAttribute('href'))).toEqual([
      '#dsw-icon-deliver-doc-regular',
      '#dsw-icon-database-outline-regular',
      '#dsw-icon-skill-outline-regular',
    ])
    expect([...resources?.querySelectorAll<HTMLButtonElement>('button[data-enterprise-resource]') ?? []].map(row => row.type)).toEqual([
      'button',
      'button',
      'button',
    ])
    expect(resources?.querySelectorAll('a[data-enterprise-resource]')).toHaveLength(0)
    expect(resources?.querySelector('[data-enterprise-resource="market"]')?.tagName).toBe('BUTTON')
    const opened: unknown[] = []
    dom.window.addEventListener('dsh-enterprise-resource-open', (event) => {
      opened.push((event as CustomEvent<unknown>).detail)
    })
    resources?.querySelectorAll<HTMLButtonElement>('[data-enterprise-resource]')[1]?.click()
    expect(opened).toEqual(['knowledge'])
    dom.window.dispatchEvent(new dom.window.CustomEvent('dsh-enterprise-resource-active', { detail: 'knowledge' }))
    expect([...resources?.querySelectorAll<HTMLElement>('[data-enterprise-resource]') ?? []].map(row => row.getAttribute('aria-current'))).toEqual([
      null,
      'page',
      null,
    ])
    dom.window.dispatchEvent(new dom.window.CustomEvent('dsh-enterprise-resource-active', { detail: null }))
    expect(resources?.querySelector('[data-enterprise-resource][aria-current="page"]')).toBeNull()
    expect(resources?.innerHTML).not.toContain('soiawork.cn')
    const quota = document.querySelector<HTMLAnchorElement>('[data-dsh-enterprise-quota]')
    await vi.waitFor(() => { expect(quota?.hidden).toBe(false) })
    expect(quota?.getAttribute('href')).toBeNull()
    expect(quota?.getAttribute('aria-haspopup')).toBe('dialog')
    expect(quota?.textContent).not.toContain('Tokens')
    expect(quota?.textContent).toContain('25%')
    expect(quota?.textContent).toContain('团队版')
    expect(quota?.textContent).not.toContain('375万')
    expect(quota?.querySelector<HTMLElement>('.dsh-ent-quota-track > span')?.style.width).toBe('25%')
    expect(quota?.parentElement?.hasAttribute('data-hero-options')).toBe(true)
    expect(quota?.getAttribute('aria-label')).toContain('本月已用 25%')
    expect(document.querySelector('[data-slot="sidebar.panellist"]')?.querySelector('[data-dsh-enterprise-quota]')).toBeNull()
    const resourceToggle = resources?.querySelector<HTMLButtonElement>('.dsh-ent-resource-toggle')
    expect(resources?.getAttribute('data-collapsed')).toBe('false')
    resourceToggle?.click()
    expect(resources?.getAttribute('data-collapsed')).toBe('true')
    expect(resourceToggle?.getAttribute('aria-expanded')).toBe('false')
    const trigger = document.querySelector<HTMLButtonElement>('[data-dsh-enterprise-account] button')
    expect(trigger?.getAttribute('aria-label')).toBe('企业账户：企业管理员，admin@echoai.best')
    expect(trigger?.textContent).toContain('企业管理员')
    expect(trigger?.textContent).not.toContain('admin@echoai.best')

    trigger?.click()
    const menu = document.querySelector<HTMLElement>('[data-dsh-enterprise-menu]')
    expect(menu?.hidden).toBe(false)
    expect(trigger?.getAttribute('aria-expanded')).toBe('true')
    expect(menu?.textContent).toContain('admin@echoai.best')
    expect([...document.querySelectorAll('[data-dsh-enterprise-menu] [role="menuitem"]')]
      .filter(item => !item.hasAttribute('hidden')).map(item => item.textContent)).toEqual([
      '套餐与积分',
      '管理控制台',
      '修改密码',
      '工作台设置',
      '退出登录',
    ])
    const billing = document.querySelector<HTMLButtonElement>('[data-enterprise-action="billing"]')
    expect(billing?.tagName).toBe('BUTTON')
    const usageOpened = vi.fn()
    dom.window.addEventListener('dsh-enterprise-usage-open', usageOpened)
    billing?.click()
    expect(usageOpened).toHaveBeenCalledOnce()
    expect(menu?.hidden).toBe(true)
    expect(document.querySelector('[data-enterprise-action="admin"]')?.getAttribute('href')).toBe('/enterprise/admin')
    expect(document.querySelector('[data-enterprise-action="password"]')?.getAttribute('href')).toBe('/enterprise/account')
    expect(menu?.textContent).not.toContain('企业后台')
    expect(menu?.textContent).not.toContain('所有者')
    expect(menu?.textContent).not.toContain('默认团队')
    expect(menu?.textContent).not.toContain('support@echoai.best')
    expect(menu?.textContent).not.toContain('企业会话已安全验证')
  }, 10000)

  it('keeps the quota pill in the Session header when the hero row is absent', async () => {
    const { dom } = harnessPage(OWNER_SESSION)
    const document = dom.window.document
    await vi.waitFor(() => {
      expect(document.querySelector<HTMLElement>('[data-dsh-enterprise-quota]')?.hidden).toBe(false)
    })

    document.querySelector('[data-hero-options]')?.remove()
    await vi.waitFor(() => {
      const quota = document.querySelector<HTMLAnchorElement>('[data-dsh-enterprise-quota]')
      expect(quota?.parentElement?.hasAttribute('data-session-header')).toBe(true)
    })
  })

  it('keeps administration out of the menu for a member role', async () => {
    const { dom } = harnessPage({
      ...OWNER_SESSION,
      user: { name: '团队成员', email: 'member@echoai.best', roleName: '成员' },
      permissions: ['workspace.use'],
    })
    const document = dom.window.document

    await vi.waitFor(() => {
      expect(document.querySelector<HTMLElement>('[data-dsh-enterprise-account]')?.hidden).toBe(false)
    })
    expect(document.querySelector<HTMLElement>('[data-enterprise-action="admin"]')?.hidden).toBe(true)
    expect(document.querySelector('[data-enterprise-action="password"]')?.getAttribute('href')).toBe('/enterprise/account')
  })
})
