// @vitest-environment jsdom
import { webcrypto } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { InputTriggerSource } from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import { registerProductMentions } from '../src/client/mentions.ts'
import { workbenchProducts } from '../src/client/product-api.ts'
import { zh } from '../src/client/locales.ts'

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); sessionStorage.clear() })
const member = { user: { id: 'member', teamId: 'team' }, permissions: ['workspace.use'] }
const access = { planCode: 'team', planName: '团队版', agentLimit: 10, teams: false, unlocked: 1 }
const agent = { id: 'copy', title: '文案助手', description: '', category: '短视频', kind: 'agent' as const, members: [], teamUnlocked: true, output: 'text' as const, entitlement: { active: true, expiresAt: null } }

function fixture() {
  const sources: InputTriggerSource[] = []
  const execute = vi.fn(async () => ({ ok: true, value: { result: { kind: 'success' } } }))
  const actx = {}
  const context = {
    inputTriggers: { registerSource: (value: InputTriggerSource) => { sources.push(value); return vi.fn() } },
    remote: { commands: { execute } },
    conversation: { input: { for: () => ({ state: { getSnapshot: () => ({ occurrences: [] }) } }) } },
    sessions: { sessionOf: () => ({ sessionId: 'session-a' }), scope: () => actx,
      using: async (_id: string, _options: object, callback: () => Promise<unknown>) => callback() },
  }
  registerProductMentions(context as never, makeTranslate(zh))
  vi.spyOn(workbenchProducts, 'identity').mockResolvedValue(member)
  vi.spyOn(workbenchProducts, 'market').mockResolvedValue({ access, agents: [agent], jobs: [] })
  return { source: sources[0]!, execute, actx }
}

describe('@ agents', () => {
  it('offers only unlocked agents and never opens an inline menu', async () => {
    const { source } = fixture()
    const session = { sessionId: 'session-a' } as never
    const request = { query: '', position: 'leading', drilled: false, signal: new AbortController().signal } as const
    const rows = await source.candidates(session, request)
    expect(rows.map(row => row.name)).toEqual(['文案助手', '发现更多智能体'])
    expect(await source.candidates(session, { ...request, position: 'inline' })).toEqual([])
    vi.mocked(workbenchProducts.market).mockResolvedValue({
      access, agents: [{ ...agent, entitlement: { active: false, expiresAt: null } }], jobs: [],
    })
    const locked = await source.candidates(session, request)
    expect(locked.map(row => row.name)).toEqual(['发现更多智能体'])
  })

  it('retains the same run identity until both admission and history recording are confirmed', async () => {
    vi.stubGlobal('crypto', webcrypto)
    const { source, execute, actx } = fixture()
    execute.mockRejectedValueOnce(new TypeError('lost response'))
    const run = vi.spyOn(workbenchProducts, 'run').mockResolvedValue({ id: 'job-a' } as never)
    const outcome = await source.matchEnter!({ sessionId: 'session-a' } as never, '@文案助手 制作新品文案', new AbortController().signal, { attachments: 0 })
    if (!outcome || typeof outcome !== 'object' || !('claim' in outcome)) throw new Error('Expected a product claim')
    expect((await outcome.claim.submit('制作新品文案', actx as never, [])).kind).toBe('error')
    expect((await outcome.claim.submit('制作新品文案', actx as never, [])).kind).toBe('success')
    expect(run.mock.calls[0]?.[2]).toBe(run.mock.calls[1]?.[2])
    expect(execute).toHaveBeenLastCalledWith('session-a', '/enterprise-task {"kind":"agent","jobId":"job-a"}', [])
    expect(sessionStorage.length).toBe(0)
  })
})
