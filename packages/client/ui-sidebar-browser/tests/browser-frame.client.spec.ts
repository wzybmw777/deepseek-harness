import { afterEach, describe, expect, it, vi } from 'vitest'
import { IFRAME_LOAD_TIMEOUT_MS, IframeImpl } from '../src/client/browser/IframeImpl.ts'
import { IframePresentation } from '../src/client/view/IframePresentation.ts'

const frames: IframeImpl[] = []

afterEach(async () => {
  await Promise.all(frames.splice(0).map(frame => frame.dispose()))
  vi.useRealTimers()
})

describe('IframeImpl', () => {
  it('owns sandbox mode and revision-scoped load state', async () => {
    const persist = vi.fn()
    const presentation = new IframePresentation({ loaded: vi.fn(), failed: vi.fn(), remounted: vi.fn() })
    const frame = new IframeImpl({ initial: undefined, sandboxEnabled: false, persist, openRequested: vi.fn() }, presentation)
    frames.push(frame)
    const listener = vi.fn()
    const unsubscribe = frame.subscribe(listener)
    try {
      frame.handleLoaded(0)
      expect(frame.getSnapshot().address).toBe('empty')
      expect(frame.getSnapshot().sandboxEnabled).toBe(false)
      frame.sandbox.setEnabled(true)
      frame.sandbox.setEnabled(true)
      expect(frame.getSnapshot().sandboxEnabled).toBe(true)
      expect(frame.getSnapshot().target).toBeUndefined()

      const target = { kind: 'https' as const, url: 'https://example.test/', title: 'example.test' }
      frame.handleLoadFailed(1)
      expect(frame.getSnapshot().error).toBeUndefined()
      frame.loadUrl(target)
      frame.handleLoadFailed(0)
      expect(frame.getSnapshot().error).toBeUndefined()
      frame.handleLoadFailed(1)
      frame.handleLoadFailed(1)
      expect(frame.getSnapshot()).toMatchObject({ target, error: { code: undefined, description: undefined }, loading: false })
      frame.handleLoaded(1)
      expect(persist).toHaveBeenLastCalledWith(expect.objectContaining({ navigation: { status: 'known', revision: 1 } }))
      frame.reload()
      expect(frame.getSnapshot()).toMatchObject({ target, error: undefined, loading: true })
      frame.handleLoadFailed(1)
      expect(frame.getSnapshot().error).toBeUndefined()
      expect(listener).toHaveBeenCalled()

      await frame.dispose()
      const stopped = frame.getSnapshot()
      frame.handleLoadFailed(2)
      frame.handleLoaded(2)
      frame.reload()
      frame.loadUrl(target)
      frame.goBack()
      frame.goForward()
      frame.sandbox.setEnabled(false)
      expect(frame.getSnapshot()).toBe(stopped)
    } finally {
      unsubscribe()
    }
  })

  it('publishes a recoverable failure when a page never confirms load', () => {
    vi.useFakeTimers()
    const presentation = new IframePresentation({ loaded: vi.fn(), failed: vi.fn(), remounted: vi.fn() })
    const frame = new IframeImpl({ initial: undefined, sandboxEnabled: false, persist: vi.fn(), openRequested: vi.fn() }, presentation)
    frames.push(frame)
    const target = { kind: 'https' as const, url: 'https://example.test/', title: 'example.test' }

    frame.loadUrl(target)
    vi.advanceTimersByTime(IFRAME_LOAD_TIMEOUT_MS - 1)
    expect(frame.getSnapshot()).toMatchObject({ target, loading: true, error: undefined })
    vi.advanceTimersByTime(1)
    expect(frame.getSnapshot()).toMatchObject({ target, loading: false, error: { timedOut: true } })

    frame.handleLoaded(1)
    expect(frame.getSnapshot()).toMatchObject({ target, loading: false, error: undefined })
  })

  it('reports an unreadable address after a second load for the same document', () => {
    const presentation = new IframePresentation({ loaded: vi.fn(), failed: vi.fn(), remounted: vi.fn() })
    const frame = new IframeImpl({ initial: undefined, sandboxEnabled: false, persist: vi.fn(), openRequested: vi.fn() }, presentation)
    frames.push(frame)
    const target = { kind: 'https' as const, url: 'https://example.test/', title: 'example.test' }

    frame.loadUrl(target)
    frame.handleLoaded(1)
    frame.handleLoaded(1)
    expect(frame.getSnapshot()).toMatchObject({ target, address: 'unknown', loading: false })
  })

  it('ignores stale timer callbacks after navigation or load confirmation', () => {
    vi.useFakeTimers()
    const timeout = vi.spyOn(globalThis, 'setTimeout')
    const presentation = new IframePresentation({ loaded: vi.fn(), failed: vi.fn(), remounted: vi.fn() })
    const frame = new IframeImpl({ initial: undefined, sandboxEnabled: false, persist: vi.fn(), openRequested: vi.fn() }, presentation)
    frames.push(frame)
    const first = { kind: 'https' as const, url: 'https://example.test/one', title: 'one' }
    const second = { kind: 'https' as const, url: 'https://example.test/two', title: 'two' }

    frame.loadUrl(first)
    const stale = timeout.mock.calls[0]?.[0] as () => void
    frame.loadUrl(second)
    stale()
    expect(frame.getSnapshot()).toMatchObject({ target: second, loading: true, error: undefined })

    frame.handleLoaded(2)
    stale()
    expect(frame.getSnapshot()).toMatchObject({ target: second, loading: false, error: undefined })
  })

  it('clears an active confirmation timer on disposal', async () => {
    vi.useFakeTimers()
    const listener = vi.fn()
    const presentation = new IframePresentation({ loaded: vi.fn(), failed: vi.fn(), remounted: vi.fn() })
    const frame = new IframeImpl({ initial: undefined, sandboxEnabled: false, persist: vi.fn(), openRequested: vi.fn() }, presentation)
    frames.push(frame)
    frame.subscribe(listener)
    frame.loadUrl({ kind: 'https' as const, url: 'https://example.test/', title: 'example.test' })
    const calls = listener.mock.calls.length

    await frame.dispose()
    vi.advanceTimersByTime(IFRAME_LOAD_TIMEOUT_MS)
    expect(listener).toHaveBeenCalledTimes(calls)
    expect(frame.getSnapshot().error).toBeUndefined()
  })

  it('ignores a confirmation timer callback that was already queued when disposed', async () => {
    vi.useFakeTimers()
    const timeout = vi.spyOn(globalThis, 'setTimeout')
    const presentation = new IframePresentation({ loaded: vi.fn(), failed: vi.fn(), remounted: vi.fn() })
    const frame = new IframeImpl({ initial: undefined, sandboxEnabled: false, persist: vi.fn(), openRequested: vi.fn() }, presentation)
    frames.push(frame)

    frame.loadUrl({ kind: 'https' as const, url: 'https://example.test/', title: 'example.test' })
    const queued = timeout.mock.calls[0]?.[0] as () => void
    await frame.dispose()
    queued()
    expect(frame.getSnapshot().error).toBeUndefined()
  })
})
