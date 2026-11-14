// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { InputTriggerCandidate, InputTriggerSource } from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import { registerFeilianMentions } from '../src/client/feilian-mentions.ts'
import { feilianKbRule } from '../src/client/feilian-reference.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

function fixture() {
  const sources: InputTriggerSource[] = []
  const selectPanel = vi.fn()
  const context = {
    inputTriggers: { registerSource: (value: InputTriggerSource) => { sources.push(value); return vi.fn() } },
    layout: { selectPanel },
    slots: { entries: () => [{ options: { key: 'feilian-kb' } }] },
  }
  registerFeilianMentions(context as never, makeTranslate(zh))
  const source = sources[0]
  if (source === undefined) throw new Error('expected the Feilian knowledge source')
  return { source, selectPanel }
}

function reply(body: unknown, ok = true) {
  return { ok, status: ok ? 200 : 404, json: async () => body }
}

function pick(candidate: InputTriggerCandidate) {
  return {
    candidate, session: { sessionId: 'session-a' } as never,
    position: 'leading' as const, via: 'menu' as const, action: 'pick' as const,
    span: { start: 0, end: 1, draftRev: 1 },
  }
}

const request = (query = '', position: 'leading' | 'inline' = 'leading') => ({
  query, position, drilled: false, signal: new AbortController().signal,
})

describe('@ Feilian knowledge bases', () => {
  it('offers the plugin page until the tenant signs in', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => reply({ signed_in: false })))
    const { source, selectPanel } = fixture()
    const rows = await source.candidates({ sessionId: 'session-a' } as never, request())
    expect(rows.map(row => row.name)).toEqual(['登录飞链知识库'])
    expect(rows[0]?.section).toBe('飞链知识库')
    expect(source.onPick(pick(rows[0]!))).toBe('handled')
    expect(selectPanel).toHaveBeenCalledWith('feilian-kb')
  })

  it('lists the readable bases and inserts a chip that names the base for the model', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => reply({
      signed_in: true,
      knowledge_bases: [{ id: 'kb-1', name: '杭州异拓波' }, { id: 'kb-2', name: '产品手册', status: 'ready' }],
    })))
    const { source } = fixture()
    const rows = await source.candidates({ sessionId: 'session-a' } as never, request())
    expect(rows.map(row => row.name)).toEqual(['杭州异拓波', '产品手册'])
    expect(await source.candidates({ sessionId: 'session-a' } as never, request('产品'))).toHaveLength(1)
    expect(await source.candidates({ sessionId: 'session-a' } as never, request('', 'inline'))).toHaveLength(2)

    const outcome = source.onPick(pick(rows[0]!))
    if (!outcome || typeof outcome !== 'object' || !('insert' in outcome)) throw new Error('Expected a reference insert')
    expect(outcome.insert).toEqual({
      source: 'feilian-knowledge',
      ref: 'feilian-kb:kb-1:%E6%9D%AD%E5%B7%9E%E5%BC%82%E6%8B%93%E6%B3%A2',
      label: '杭州异拓波',
      clipboardText: '@杭州异拓波',
    })
    expect(source.codec?.clipboardText(outcome.insert.ref)).toBe('@杭州异拓波')
    const serialized = await source.codec!.serialize(outcome.insert.ref, new AbortController().signal)
    expect(serialized).toBe('@杭州异拓波 [飞链知识库 id=kb-1]')
    expect(feilianKbRule.match(serialized, 0, { read: () => undefined })).toEqual({
      id: 'feilianKb', start: 0, end: serialized.length, data: { id: 'kb-1', name: '杭州异拓波' },
    })
    expect(feilianKbRule.match('@杭州异拓波 帮我总结', 0, { read: () => undefined })).toBeUndefined()
  })

  it('keeps the menu clean when the plugin route is absent and refetches only after the cache expires', async () => {
    const fetchMock = vi.fn(async () => reply({}, false))
    vi.stubGlobal('fetch', fetchMock)
    const { source } = fixture()
    expect(await source.candidates({ sessionId: 'session-a' } as never, request())).toEqual([])
    expect(await source.candidates({ sessionId: 'session-a' } as never, request())).toEqual([])
    expect(fetchMock).toHaveBeenCalledTimes(1)
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline') }))
    const offline = fixture()
    expect(await offline.source.candidates({ sessionId: 'session-a' } as never, request())).toEqual([])
  })
})
