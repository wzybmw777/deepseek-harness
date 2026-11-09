// @vitest-environment jsdom
import { webcrypto } from 'node:crypto'
import { createElement } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ResourcePanelProps } from '../src/client/common.tsx'
import { MarketPanel } from '../src/client/MarketPanel.tsx'
import { ProjectPicker } from '../src/client/ProjectPicker.tsx'
import { UsageSummary, USAGE_OPEN_EVENT } from '../src/client/UsageSummary.tsx'
import { zh } from '../src/client/locales.ts'

const t = makeTranslate(zh)
const wallet = { balance: 80, reserved: 20, canRun: true, canPurchase: true }
const identity = { user: { id: 'member', teamId: 'team-a' }, permissions: ['workspace.use'] }
const agents = [
  { id: 'ppt', title: '演示文稿助手', description: '整理汇报材料', category: '办公', output: 'pptx', price: 10, durationDays: 30, entitlement: null },
  { id: 'copy', title: '文案助手', description: '短视频文案', category: '短视频', output: 'text', price: 5, durationDays: null, entitlement: { active: true, expiresAt: null } },
]
const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const pathOf = (value: RequestInfo | URL): string => new URL(String(value), location.origin).pathname
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); sessionStorage.clear(); history.replaceState(null, '', '/') })

describe('workbench market and usage', () => {
  it('filters categories and unlocked agents without leaving the chat document', async () => {
    const start = location.href
    const useAgent = vi.fn(async () => {})
    vi.stubGlobal('fetch', vi.fn(async (url: RequestInfo | URL) => pathOf(url).endsWith('/session') ? json(identity) : json({ wallet, agents, jobs: [] })))
    render(createElement(MarketPanel, { t, useAgent } as ResourcePanelProps & { useAgent: typeof useAgent }))
    await screen.findByRole('heading', { name: '演示文稿助手' })
    fireEvent.click(screen.getByRole('button', { name: '短视频' }))
    expect(screen.queryByRole('heading', { name: '演示文稿助手' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '选择使用' }))
    expect(useAgent).toHaveBeenCalledWith('copy', '文案助手')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.queryByText('我的作品')).toBeNull()
    expect(location.href).toBe(start)
  })

  it('reuses the purchase identity after a lost response and refreshes the unlocked state', async () => {
    vi.stubGlobal('crypto', webcrypto)
    let purchased = false
    const keys: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const path = pathOf(url)
      if (path.endsWith('/session')) return json(identity)
      if (path.endsWith('/purchase')) {
        keys.push(JSON.parse(String(init?.body)).key)
        if (keys.length === 1) throw new TypeError('connection lost')
        purchased = true; return json({ ok: true })
      }
      return json({ wallet, agents: [{ ...agents[0], entitlement: purchased ? { active: true, expiresAt: null } : null }], jobs: [] })
    }))
    render(createElement(MarketPanel, { t, useAgent: vi.fn(async () => {}) } as ResourcePanelProps & { useAgent: () => Promise<void> }))
    fireEvent.click(await screen.findByRole('button', { name: '解锁使用' }))
    fireEvent.click(screen.getByRole('button', { name: '确认解锁' }))
    await screen.findByRole('alert')
    fireEvent.click(screen.getByRole('button', { name: '确认解锁' }))
    await screen.findByRole('button', { name: '选择使用' })
    expect(keys).toHaveLength(2); expect(keys[0]).toBe(keys[1])
  })

  it('shows plan progress and available points in an anchored summary and restores focus on Escape', async () => {
    history.replaceState(null, '', '/preview/t/team/harness/')
    const start = location.href
    vi.stubGlobal('fetch', vi.fn(async (url: RequestInfo | URL) => {
      const path = pathOf(url)
      if (path.endsWith('/session')) return json({ ...identity, permissions: ['workspace.use', 'billing.read'] })
      if (path.endsWith('/summary')) return json({ wallet })
      return json({ plan: { name: '团队版' }, quota: { percentUsed: 25 }, cycle: { startsAt: '2026-11-01T00:00:00Z', endsAt: '2026-12-01T00:00:00Z' } })
    }))
    const anchor = document.createElement('button'); anchor.setAttribute('data-dsh-enterprise-quota', ''); document.body.appendChild(anchor)
    try {
      render(createElement(UsageSummary, { t }))
      act(() => { window.dispatchEvent(new CustomEvent(USAGE_OPEN_EVENT, { detail: anchor })) })
      await screen.findByText('本月已用 25%')
      expect(screen.getByText('60')).toBeTruthy()
      expect(screen.getByRole('progressbar').getAttribute('value')).toBe('25')
      expect(screen.queryByRole('link', { name: '在管理网页查看详情' })).toBeNull()
      fireEvent.keyDown(document, { key: 'Escape' })
      expect(screen.queryByRole('dialog')).toBeNull()
      expect(document.activeElement).toBe(anchor)
      expect(location.href).toBe(start)
    } finally { anchor.remove() }
  })

  it('browses sandbox folders and adopts only the confirmed verified directory', async () => {
    const mutations: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const address = new URL(String(url), location.origin)
      if (init?.method === 'POST') mutations.push(address.pathname)
      if (address.pathname.endsWith('/access')) return json({ canWrite: true })
      if (address.pathname.endsWith('/location')) return json({ path: '/team/documents/project' })
      const directory = address.searchParams.get('path') ?? ''
      return json({ directory, parent: null, entries: directory === '' ? [{ name: '创作素材', path: '创作素材', kind: 'directory' }] : [] })
    }))
    const onPicked = vi.fn()
    render(createElement(ProjectPicker, { open: true, busy: false, onPicked, onCancel: vi.fn(), onError: vi.fn(), t }))
    fireEvent.click(await screen.findByRole('button', { name: '打开文件夹 创作素材' }))
    await screen.findByText('这里还没有子文件夹')
    expect(onPicked).not.toHaveBeenCalled()
    expect(mutations).toEqual([])
    expect(screen.queryByLabelText('选择电脑上的文件夹')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '在此创建项目' }))
    await waitFor(() => { expect(onPicked).toHaveBeenCalledWith('/team/documents/project') })
  })
})
