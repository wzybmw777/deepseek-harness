// @vitest-environment jsdom

import { webcrypto } from 'node:crypto'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import type { ILayout, MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import { SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import type { SessionBinding } from '@deepseek-ai/dsh-api-session-controller/client'
import type { InputTriggerSource } from '@deepseek-ai/dsh-client-ui-input-trigger/client'
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
import { openProductConversation } from '../src/client/mentions.ts'
import { workbenchProducts } from '../src/client/product-api.ts'

const runtimes = new Set<SlotTestRuntime>()

afterEach(async () => {
  try {
    for (const runtime of runtimes) await runtime.dispose()
  } finally {
    runtimes.clear()
    cleanup()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    sessionStorage.clear()
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
  const sources: InputTriggerSource[] = []
  runtime.ctx.provide('inputTriggers', {
    registerSource: (source: InputTriggerSource) => { sources.push(source); return vi.fn() }, sessionOf: vi.fn(),
  } as never)
  const initializeDraft = vi.fn((binding: SessionBinding) => {
    expect(runtime.sessions.binding(binding.sessionId)).toBe(binding)
    return 'applied' as const
  })
  runtime.ctx.provide('conversation', { input: {
    requestDraftInitialization: initializeDraft,
    for: () => ({ state: { getSnapshot: () => ({ occurrences: [] }) } }),
  } } as never)
  const startSession = vi.fn()
  runtime.ctx.provide('uiWorkspace', { startSession } as never)
  const workspace = await runtime.workspaces.create({ path: '/market-project' })
  await runtime.workspaces.update((state) => { state.items = [workspace] })
  const execute = vi.fn(async () => ({ ok: true, value: { result: { kind: 'success' } } }))
  runtime.remote.provideNamespaces({ commands: { execute } })
  runtime.ctx.slots.register({
    name: 'root',
    children: { main: { kind: 'keyed', scope: 'root' } },
  } as never, () => null)
  const mounted = await runtime.mount({ inject: [...inject], apply })
  return { runtime, locale, selectPanel, mounted, sources, initializeDraft, startSession, execute, workspace }
}

describe('enterprise resources browser half', () => {
  it('keeps the Host half inert', () => {
    expect(applyHost).not.toThrow()
  })

  it('declares the workbench and native composer services it binds', () => {
    expect(inject).toEqual([
      'slots', 'locale', 'layout', 'sessions', 'conversation', 'inputTriggers', 'uiWorkspace', 'workspaces', 'remote', 'remote.commands',
    ])
  })

  it('registers resource and marketplace panels with localized copy', async () => {
    const { runtime, locale } = await bench()
    const entries = runtime.ctx.slots.entries('main')
    expect(entries.map(entry => entry.options.key)).toEqual([
      RESOURCE_PANEL_IDS.files,
      RESOURCE_PANEL_IDS.knowledge,
      RESOURCE_PANEL_IDS.skills,
      RESOURCE_PANEL_IDS.market,
    ])
    expect(locale.bind(NS)('files.title')).toBe('文件')
    expect(locale.bind(NS)('knowledge.title')).toBe('知识库')
    expect(locale.bind(NS)('skills.title')).toBe('技能')
    expect(locale.bind(NS)('market.title')).toBe('智能体')
  })

  it('opens the chosen agent in a new chat with the mention prefilled', async () => {
    const { runtime, startSession, workspace } = await bench()
    await openProductConversation(runtime.ctx, { kind: 'agent', id: 'copy', title: '文案助手' })
    expect(startSession).toHaveBeenCalledWith(workspace.workspaceId, { prompt: '@文案助手 ', whenDraftExists: 'append' })
  })

  it('prepares the default project before creating a marketplace chat on first use', async () => {
    const { runtime, workspace, startSession } = await bench()
    await runtime.workspaces.update((state) => { state.items = [] })
    runtime.workspaces.stub('initializeDefault', async () => workspace)
    await openProductConversation(runtime.ctx, { kind: 'agent', id: 'copy', title: '文案助手' })
    expect(runtime.workspaces.calls.at(-1)?.method).toBe('initializeDefault')
    expect(startSession).toHaveBeenCalledWith(workspace.workspaceId, { prompt: '@文案助手 ', whenDraftExists: 'append' })
  })

  it('leaves creation and navigation untouched when no project is available', async () => {
    const { runtime, startSession } = await bench()
    await runtime.workspaces.update((state) => { state.items = [] })
    const create = vi.spyOn(runtime.sessions, 'create')
    await expect(openProductConversation(runtime.ctx, { kind: 'agent', id: 'copy', title: '文案助手' }))
      .rejects.toThrow('Choose a project')
    expect(create).not.toHaveBeenCalled()
    expect(startSession).not.toHaveBeenCalled()
  })

  it('records an agent interaction through the injected Remote in the mounted plugin', async () => {
    vi.stubGlobal('crypto', webcrypto)
    const { runtime, sources, execute } = await bench()
    const sessionId = await runtime.sessions.add({ id: 'agent-chat' })
    vi.spyOn(workbenchProducts, 'identity').mockResolvedValue({ user: { id: 'member' }, permissions: ['workspace.use'] })
    vi.spyOn(workbenchProducts, 'market').mockResolvedValue({
      access: { planCode: 'team', planName: '团队版', agentLimit: 10, teams: false, unlocked: 1 },
      agents: [{ id: 'copy', title: '文案助手', description: '', category: '文案', kind: 'agent', members: [], teamUnlocked: true, output: 'text',
        entitlement: { active: true, expiresAt: null } }], jobs: [] })
    vi.spyOn(workbenchProducts, 'run').mockResolvedValue({ id: 'job-a' } as never)
    await runtime.sessions.using(sessionId, { source: 'testOperation' }, async (reference) => {
      const outcome = await sources[0]!.matchEnter!(
        { sessionId }, '@文案助手 材料', new AbortController().signal, { attachments: 0 },
      )
      if (!outcome || typeof outcome !== 'object' || !('claim' in outcome)) throw new Error('Expected agent selection')
      expect((await outcome.claim.submit('材料', reference.binding.ctx, [])).kind).toBe('success')
    })
    expect(execute).toHaveBeenLastCalledWith(sessionId, '/enterprise-task {"kind":"agent","jobId":"job-a"}', [])
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
      window.dispatchEvent(new window.CustomEvent(RESOURCE_OPEN_EVENT, { detail: 'market' }))
      expect(selectPanel).toHaveBeenCalledWith(RESOURCE_PANEL_IDS.market)
      expect(active.at(-1)).toBe('market')

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
