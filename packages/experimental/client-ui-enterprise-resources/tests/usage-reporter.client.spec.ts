// @vitest-environment jsdom

import type { Context } from '@deepseek-ai/cordis'
import { MutableSessionEventSource } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { reportTurnUsage } from '../src/client/usage-reporter.ts'

function event(seq: number, type: string, data: unknown): SessionEvent {
  return { seq, time: seq, type, data } as unknown as SessionEvent
}

function completedTurn(): SessionEvent[] {
  return [
    event(1, 'turn/start', { turn: 1 }),
    event(2, 'step/start', { turn: 1, step: 1 }),
    event(3, 'assistant/message', {
      turn: 1,
      step: 1,
      stream: [],
      message: {
        id: 'message-3',
        role: 'assistant',
        content: [{ type: 'text', text: 'done' }],
        source: { kind: 'model', provider: 'deepseek', model: 'deepseek-chat' },
      },
      usage: { inputTokens: 100, outputTokens: 20, totalTokens: 170, cacheReadTokens: 50 },
    }),
    event(4, 'step/end', { turn: 1, step: 1 }),
    event(5, 'turn/end', { turn: 1, reason: { kind: 'completed' } }),
  ]
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('enterprise turn usage reporter', () => {
  it('posts exact completed-turn usage once and releases its subscriptions', async () => {
    const source = new MutableSessionEventSource()
    const fetch = vi.fn(async () => new Response('{"recorded":true}', {
      status: 201,
      headers: { 'content-type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetch)
    const binding = { sessionId: 's1', eventSource: source }
    const ctx = {
      sessions: {
        list: {
          getSnapshot: () => ({ ids: ['s1'], byId: {}, phase: 'ready', projectionsBySession: {} }),
          subscribe: () => () => {},
        },
        binding: () => binding,
      },
    } as unknown as Context

    const dispose = reportTurnUsage(ctx)
    for (const entry of completedTurn()) source.append({ type: 'event', event: entry })

    await vi.waitFor(() => { expect(fetch).toHaveBeenCalledTimes(1) })
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/enterprise/api/billing/usage')
    if (typeof init.body !== 'string') throw new Error('expected a JSON request body')
    expect(JSON.parse(init.body)).toEqual({
      sessionId: 's1',
      turn: 1,
      inputTokens: 150,
      outputTokens: 20,
      model: 'deepseek-chat',
    })

    source.append({ type: 'event', event: event(5, 'turn/end', { turn: 1, reason: { kind: 'completed' } }) })
    await Promise.resolve()
    expect(fetch).toHaveBeenCalledTimes(1)

    dispose()
    source.append({ type: 'event', event: event(6, 'turn/end', { turn: 2, reason: { kind: 'completed' } }) })
    await Promise.resolve()
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})
