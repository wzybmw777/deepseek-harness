// @vitest-environment jsdom

import { createElement } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { QuotaStatus, openExternalPurchase, type QuotaStatusProps } from '../src/client/QuotaStatus.tsx'
import { DesktopQuotaStore } from '../src/client/quota.ts'
import { zh } from '../src/client/quota-locales.ts'

const stores: DesktopQuotaStore[] = []

afterEach(() => {
  for (const store of stores.splice(0)) store.dispose()
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function billing(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    quota: {
      planName: '团队版',
      totalTokens: 5_000_000,
      usedTokens: 1_660,
      remainingTokens: 4_998_340,
      userTokens: 1_500,
      cycleStartsAt: '2026-11-01T00:00:00.000Z',
      cycleEndsAt: '2026-12-01T00:00:00.000Z',
      ...overrides,
    },
    planName: '团队版',
    updatedAt: '2026-11-04T00:00:00.000Z',
    purchaseUrl: 'https://cloud.example.com/enterprise/billing',
  }
}

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

function store(fetcher: typeof fetch): DesktopQuotaStore {
  const value = new DesktopQuotaStore({ fetch: fetcher })
  stores.push(value)
  return value
}

function props(quota: DesktopQuotaStore, openPurchase = openExternalPurchase): QuotaStatusProps {
  return { wide: true, store: quota, openPurchase, t: makeTranslate(zh) } as unknown as QuotaStatusProps
}

function renderQuota(quota: DesktopQuotaStore): void {
  render(createElement(QuotaStatus, props(quota)))
}

describe('enterprise Desktop quota', () => {
  it('shows the signed-in member usage and team remaining tokens', async () => {
    const quota = store(vi.fn(async () => response(billing())) as typeof fetch)
    void quota.refresh()
    renderQuota(quota)

    expect(await screen.findByText('本月剩余 4,998,340 Tokens')).toBeTruthy()
    expect(screen.getByText('我的用量 1,500')).toBeTruthy()
    expect(quota.getSnapshot()).toMatchObject({ status: 'available', refreshing: false })
  })

  it('renders a skeleton instead of a textual loading notice', () => {
    const quota = store(vi.fn(() => new Promise<Response>(() => {})) as typeof fetch)
    renderQuota(quota)

    expect(screen.getByRole('status').textContent).toBe('')
    expect(screen.queryByText('正在读取额度')).toBeNull()
  })

  it('turns quota_exhausted into the exhausted state', async () => {
    const quota = store(vi.fn(async () => response(billing())) as typeof fetch)
    void quota.refresh()
    renderQuota(quota)
    await screen.findByText('本月剩余 4,998,340 Tokens')

    act(() => { quota.noteGatewayError({ code: 'quota_exhausted' }) })

    expect(quota.getSnapshot().status).toBe('exhausted')
    expect(screen.getByText('额度已用完')).toBeTruthy()
    expect(screen.getByRole('button', { name: '购买套餐' })).toBeTruthy()
  })

  it('refreshes once after one coalesced gateway error', async () => {
    let reject!: (reason?: unknown) => void
    const fetcher = vi.fn(() => new Promise<Response>((_resolve, fail) => { reject = fail })) as typeof fetch
    const quota = store(fetcher)

    const first = quota.refresh()
    const second = quota.refresh()
    expect(second).toBe(first)
    reject(new Error('gateway unavailable'))

    await expect(Promise.all([first, second])).resolves.toEqual([undefined, undefined])
    expect(fetcher).toHaveBeenCalledOnce()
    expect(quota.getSnapshot()).toMatchObject({ status: 'unavailable', refreshing: false })
  })

  it('opens the purchase surface through the desktop external-browser bridge', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    const quota = store(vi.fn(async () => response(billing())) as typeof fetch)
    void quota.refresh()
    renderQuota(quota)
    await screen.findByText('本月剩余 4,998,340 Tokens')
    act(() => { quota.noteGatewayError({ code: 'quota_exhausted' }) })

    fireEvent.click(screen.getByRole('button', { name: '购买套餐' }))

    expect(open).toHaveBeenCalledOnce()
    expect(open).toHaveBeenCalledWith('https://cloud.example.com/enterprise/billing', '_blank', 'noopener,noreferrer')
    await waitFor(() => { expect(open).toHaveBeenCalledOnce() })
  })
})
