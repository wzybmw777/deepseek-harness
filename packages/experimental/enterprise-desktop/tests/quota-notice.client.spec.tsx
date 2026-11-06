// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import type { PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots'
import type { QuotaNoticeOwnerProps } from '@deepseek-ai/dsh-client-ui-chat/client'
import { apply, inject } from '../src/client/index.ts'

const runtimes = new Set<SlotTestRuntime>()

afterEach(async () => {
  try {
    for (const runtime of runtimes) await runtime.dispose()
  } finally {
    runtimes.clear()
    cleanup()
    vi.unstubAllGlobals()
  }
})

function notice(code: QuotaNoticeOwnerProps['code']): QuotaNoticeOwnerProps {
  return { code, message: '额度提示', dismiss: vi.fn(), keepOpen: () => () => {} }
}

async function bench(code: QuotaNoticeOwnerProps['code']) {
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})))
  const runtime = await SlotTestRuntime.create()
  runtimes.add(runtime)
  const locale = new LocaleRuntime(runtime.ctx)
  locale.setLocale('zh')
  runtime.ctx.provide('locale', locale)
  runtime.slots.installLocale(locale)
  const owner = notice(code)
  const Frame = ({ renderSlot, renderSlotChain }: PropsRenderSlots<'shell.quota-notice' | 'sidebar.footer.action'>) => (
    <>
      {renderSlotChain('shell.quota-notice', owner, { fallback: null })}
      {renderSlot('sidebar.footer.action', { wide: true })}
    </>
  )
  await runtime.root.declare({
    'shell.quota-notice': { kind: 'chain', scope: 'root' },
    'sidebar.footer.action': { kind: 'list', scope: 'root' },
  } as never, Frame as never)
  await runtime.mount({ inject, apply })
  const view = runtime.renderRoot()
  return { runtime, view }
}

describe('enterprise quota notice bridge', () => {
  it('turns gateway exhaustion into the quota state without a toast', async () => {
    const { view } = await bench('quota_exhausted')
    expect(view.container.textContent).toContain('额度已用完')
    expect(view.container.querySelector('[data-slot="shell.quota-notice"]')?.textContent).toBe('')
  })

  it.each(['QUOTA', 'ACCOUNT_QUOTA'] as const)('declines the unrelated %s code', async (code) => {
    const { view } = await bench(code)
    expect(view.container.textContent).not.toContain('额度已用完')
    expect(view.container.querySelector('[data-slot="shell.quota-notice"]')?.textContent).toBe('')
  })
})
