import { enterpriseApiPath } from './public-path.ts'
/** Browser-side reporting of completed-turn token usage to the enterprise ledger. */

import type { Context } from '@deepseek-ai/cordis'
import type { SessionBinding } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionEvent, SessionId } from '@deepseek-ai/dsh-session/types'
import { deriveTurnTokenUsage } from '@deepseek-ai/dsh-token-meter/client'
import type { MeteredUsageInput } from './api.ts'

/** Slice the durable events for one completed Turn out of a contiguous window. */
function turnEvents(events: readonly SessionEvent[], turn: number): readonly SessionEvent[] | undefined {
  const start = events.findLastIndex(event => event.type === 'turn/start' && event.data.turn === turn)
  if (start < 0) return undefined
  const end = events.findIndex((event, index) => index > start && event.type === 'turn/end' && event.data.turn === turn)
  return end < 0 ? undefined : events.slice(start, end + 1)
}

/** Build one metered payload from exact provider-reported usage, or omit it. */
function meteredUsage(sessionId: string, turn: number, events: readonly SessionEvent[]): MeteredUsageInput | undefined {
  const usage = deriveTurnTokenUsage(events)
  if (usage === undefined) return undefined
  const model = usage.routes?.length === 1 ? usage.routes[0]?.model : undefined
  return {
    sessionId,
    turn,
    inputTokens: usage.uncachedInputTokens + (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0),
    outputTokens: usage.outputTokens,
    ...(model === undefined || model === '' ? {} : { model }),
  }
}

/**
 * Subscribe to retained Session event windows and report each newly completed
 * Turn once. The server deduplicates retries by Session and Turn.
 * @param ctx - Client Context with the Session controller available.
 * @returns disposer that releases every list and event subscription.
 */
export function reportTurnUsage(ctx: Context): () => void {
  const subscriptions = new Map<SessionId, () => void>()
  const reported = new Set<string>()
  let disposed = false

  const subscribe = (binding: SessionBinding): void => {
    if (subscriptions.has(binding.sessionId)) return
    const stop = binding.eventSource.subscribe(() => {
      const { change, entries } = binding.eventSource.getSnapshot()
      if (change.kind !== 'append') return
      const durable = entries
        .filter(entry => entry.type === 'event')
        .map(entry => entry.event)
      for (const entry of change.entries) {
        if (entry.type !== 'event' || entry.event.type !== 'turn/end') continue
        const turn = entry.event.data.turn
        const key = `${binding.sessionId}:${String(turn)}`
        if (reported.has(key)) continue
        const events = turnEvents(durable, turn)
        if (events === undefined) continue
        const payload = meteredUsage(binding.sessionId, turn, events)
        if (payload === undefined) continue
        reported.add(key)
        void fetch(enterpriseApiPath('/billing/usage'), {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        }).then((response) => {
          if (response.status === 401) window.dispatchEvent(new Event('enterprise:unauthorized'))
        }).catch(() => {
          reported.delete(key)
        })
      }
    })
    subscriptions.set(binding.sessionId, stop)
  }

  const reconcile = (): void => {
    if (disposed) return
    const listed = new Set(ctx.sessions.list.getSnapshot().ids)
    for (const [sessionId, stop] of subscriptions) {
      if (listed.has(sessionId) && ctx.sessions.binding(sessionId) !== undefined) continue
      stop()
      subscriptions.delete(sessionId)
    }
    for (const sessionId of listed) {
      const binding = ctx.sessions.binding(sessionId)
      if (binding !== undefined) subscribe(binding)
    }
  }

  const stopList = ctx.sessions.list.subscribe(reconcile)
  reconcile()
  return () => {
    disposed = true
    stopList()
    for (const stop of subscriptions.values()) stop()
    subscriptions.clear()
  }
}
