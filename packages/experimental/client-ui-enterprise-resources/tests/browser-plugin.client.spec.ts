// @vitest-environment jsdom

import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import type { ILayout, MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import { SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import { cleanup } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  apply,
  inject,
  RESOURCE_ACTIVE_EVENT,
  RESOURCE_OPEN_EVENT,
  RESOURCE_PANEL_IDS,
} from '../src/client/index.ts'
import { NS } from '../src/client/locales.ts'
import { apply as applyHost } from '../src/index.ts'

const runtimes = new Set<SlotTestRuntime>()

afterEach(async () => {
  try {
    for (const runtime of runtimes) await runtime.dispose()
  } finally {
    runtimes.clear()
    cleanup()
  }
})

/** Boot the browser half over the production registry, locale, and panel store. */
async function bench() {
  const runtime = await SlotTestRuntime.create()
  runtimes.add(runtime)
  const locale = new LocaleRuntime(runtime.ctx)
  locale.setLocale('zh')
  runtime.ctx.provide('locale', locale)
  runtime.slots.installLocale(locale)
  const selectPanel = vi.fn((panelId: MainPanelId | null) => {
    runtime.panelInfo.set({ activePanelId: panelId })
  })
  const layout = {
    panelInfo: runtime.panelInfo,
    beginNavigation: vi.fn(() => new AbortController().signal),
    toggleSidebar: vi.fn(),
    selectPanel,
    openRightbar: vi.fn(),
    closeRightbar: vi.fn(),
  } satisfies ILayout
  runtime.ctx.provide('layout', layout)
  runtime.ctx.slots.register({
    name: 'root',
    children: { main: { kind: 'keyed', scope: 'root' } },
  } as never, () => null)
  const mounted = await runtime.mount({ inject: [...inject], apply })
  return { runtime, locale, selectPanel, mounted }
}

describe('enterprise resources browser half', () => {
  it('keeps the Host half inert', () => {
    expect(applyHost).not.toThrow()
  })

  it('declares the four workbench services it binds', () => {
    expect(inject).toEqual(['slots', 'locale', 'layout', 'sessions'])
  })

  it('registers the three main panels and both dictionaries', async () => {
    const { runtime, locale } = await bench()
    const entries = runtime.ctx.slots.entries('main')
    expect(entries.map(entry => entry.options.key)).toEqual([
      RESOURCE_PANEL_IDS.files,
      RESOURCE_PANEL_IDS.knowledge,
      RESOURCE_PANEL_IDS.skills,
    ])
    expect(locale.bind(NS)('files.title')).toBe('文件')
    expect(locale.bind(NS)('knowledge.title')).toBe('知识库')
    expect(locale.bind(NS)('skills.title')).toBe('技能')
  })

  it('opens resource panels in the workbench and publishes the active selection', async () => {
    const { runtime, selectPanel } = await bench()
    const active: unknown[] = []
    const listener = (event: Event): void => {
      active.push((event as CustomEvent<unknown>).detail)
    }
    window.addEventListener(RESOURCE_ACTIVE_EVENT, listener)
    try {
      window.dispatchEvent(new window.CustomEvent(RESOURCE_OPEN_EVENT, { detail: 'knowledge' }))
      expect(selectPanel).toHaveBeenCalledWith(RESOURCE_PANEL_IDS.knowledge)
      expect(runtime.panelInfo.getSnapshot().activePanelId).toBe(RESOURCE_PANEL_IDS.knowledge)
      expect(active.at(-1)).toBe('knowledge')

      window.dispatchEvent(new window.CustomEvent(RESOURCE_OPEN_EVENT, { detail: 'unknown' }))
      expect(selectPanel).toHaveBeenCalledTimes(1)

      runtime.panelInfo.set({ activePanelId: null })
      expect(active.at(-1)).toBeNull()
    } finally {
      window.removeEventListener(RESOURCE_ACTIVE_EVENT, listener)
    }
  })

  it('removes panels, dictionaries, and event subscriptions on teardown', async () => {
    const { runtime, locale, selectPanel, mounted } = await bench()
    await mounted.dispose()
    expect(runtime.ctx.slots.entries('main')).toEqual([])
    expect(locale.bind(NS)('files.title')).toBe('files.title')

    window.dispatchEvent(new window.CustomEvent(RESOURCE_OPEN_EVENT, { detail: 'files' }))
    expect(selectPanel).not.toHaveBeenCalled()

    const active = vi.fn()
    window.addEventListener(RESOURCE_ACTIVE_EVENT, active)
    try {
      runtime.panelInfo.set({ activePanelId: RESOURCE_PANEL_IDS.files })
      expect(active).not.toHaveBeenCalled()
    } finally {
      window.removeEventListener(RESOURCE_ACTIVE_EVENT, active)
    }
  })
})
